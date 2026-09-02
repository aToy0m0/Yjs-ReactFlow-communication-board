import { mkdir, readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { validateCollaborationToken } from "./lib/auth-store.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dataDirectory = join(root, "data");
const port = Number(process.env.COLLAB_PORT ?? 1234);
const serviceToken = process.env.COLLAB_SERVICE_TOKEN?.trim() ?? "";

function isServiceToken(token) {
  if (!serviceToken || typeof token !== "string") return false;
  const actual = Buffer.from(token);
  const expected = Buffer.from(serviceToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

await mkdir(dataDirectory, { recursive: true });
const database = new DatabaseSync(join(dataDirectory, "mingleboard.sqlite"));
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
database.exec(`
  CREATE TABLE IF NOT EXISTS boards (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, yjs_state BLOB NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mini_databases (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    view_type TEXT NOT NULL CHECK(view_type IN ('table', 'kanban', 'gantt')),
    position_x REAL NOT NULL, position_y REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS mini_databases_board_id ON mini_databases(board_id);
  CREATE TABLE IF NOT EXISTS mini_database_fields (
    id TEXT NOT NULL,
    mini_database_id TEXT NOT NULL REFERENCES mini_databases(id) ON DELETE CASCADE,
    name TEXT NOT NULL, field_type TEXT NOT NULL, options_json TEXT NOT NULL DEFAULT '[]', option_colors_json TEXT NOT NULL DEFAULT '{}', table_visible INTEGER NOT NULL DEFAULT 1, date_format TEXT NOT NULL DEFAULT 'date', system_kind TEXT, sort_order INTEGER NOT NULL,
    PRIMARY KEY (mini_database_id, id)
  );
  CREATE TABLE IF NOT EXISTS mini_database_records (
    id TEXT NOT NULL,
    mini_database_id TEXT NOT NULL REFERENCES mini_databases(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY (mini_database_id, id)
  );
  CREATE TABLE IF NOT EXISTS mini_database_values (
    mini_database_id TEXT NOT NULL, record_id TEXT NOT NULL, field_id TEXT NOT NULL, value_json TEXT NOT NULL,
    PRIMARY KEY (mini_database_id, record_id, field_id),
    FOREIGN KEY (mini_database_id, record_id) REFERENCES mini_database_records(mini_database_id, id) ON DELETE CASCADE,
    FOREIGN KEY (mini_database_id, field_id) REFERENCES mini_database_fields(mini_database_id, id) ON DELETE CASCADE
  );
`);

const miniDatabaseSchema = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mini_databases'").get();
if (miniDatabaseSchema?.sql && !miniDatabaseSchema.sql.includes("'gantt'")) {
  database.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
  try {
    database.exec(`
      CREATE TABLE mini_databases_new (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        view_type TEXT NOT NULL CHECK(view_type IN ('table', 'kanban', 'gantt')),
        position_x REAL NOT NULL, position_y REAL NOT NULL
      );
      INSERT INTO mini_databases_new SELECT id, board_id, name, view_type, position_x, position_y FROM mini_databases;
      DROP TABLE mini_databases;
      ALTER TABLE mini_databases_new RENAME TO mini_databases;
      CREATE INDEX mini_databases_board_id ON mini_databases(board_id);
      COMMIT;
    `);
  } catch (error) {
    database.exec("ROLLBACK;"); throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON;");
  }
  const integrityErrors = database.prepare("PRAGMA foreign_key_check").all();
  if (integrityErrors.length > 0) throw new Error("データベースのスキーマ移行後に外部キー不整合を検出しました。");
}

const fieldColumns = database.prepare("PRAGMA table_info(mini_database_fields)").all();
if (!fieldColumns.some((column) => column.name === "options_json")) database.exec("ALTER TABLE mini_database_fields ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'");
if (!fieldColumns.some((column) => column.name === "option_colors_json")) database.exec("ALTER TABLE mini_database_fields ADD COLUMN option_colors_json TEXT NOT NULL DEFAULT '{}'");
if (!fieldColumns.some((column) => column.name === "table_visible")) {
  database.exec("ALTER TABLE mini_database_fields ADD COLUMN table_visible INTEGER NOT NULL DEFAULT 1");
  database.exec("UPDATE mini_database_fields SET table_visible = 0 WHERE system_kind = 'updatedAt'");
}
if (!fieldColumns.some((column) => column.name === "date_format")) database.exec("ALTER TABLE mini_database_fields ADD COLUMN date_format TEXT NOT NULL DEFAULT 'date'");
if (!fieldColumns.some((column) => column.name === "system_kind")) database.exec("ALTER TABLE mini_database_fields ADD COLUMN system_kind TEXT");

const selectBoard = database.prepare("SELECT title, yjs_state FROM boards WHERE id = ?");
const upsertBoard = database.prepare(`INSERT INTO boards (id, title, yjs_state, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET title = excluded.title, yjs_state = excluded.yjs_state, updated_at = excluded.updated_at`);
const deleteMiniDatabases = database.prepare("DELETE FROM mini_databases WHERE board_id = ?");
const insertMiniDatabase = database.prepare("INSERT INTO mini_databases (id, board_id, name, view_type, position_x, position_y) VALUES (?, ?, ?, ?, ?, ?)");
const insertField = database.prepare("INSERT INTO mini_database_fields (id, mini_database_id, name, field_type, options_json, option_colors_json, table_visible, date_format, system_kind, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const insertRecord = database.prepare("INSERT INTO mini_database_records (id, mini_database_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
const insertValue = database.prepare("INSERT INTO mini_database_values (mini_database_id, record_id, field_id, value_json) VALUES (?, ?, ?, ?)");
const selectRecordTimes = database.prepare(`SELECT r.id, r.mini_database_id, r.created_at
  FROM mini_database_records r JOIN mini_databases d ON d.id = r.mini_database_id WHERE d.board_id = ?`);

function legacyDocumentPath(documentName) {
  return join(dataDirectory, `${documentName.replace(/[^a-zA-Z0-9_-]/g, "_")}.bin`);
}

function textValue(value) {
  return value instanceof Y.Text ? value.toString() : String(value ?? "");
}

function persistDocument(document, boardId) {
  const now = new Date().toISOString();
  const nodes = document.getMap("nodes");
  const definitions = document.getMap("miniDatabases");
  const title = String(document.getMap("meta").get("title") ?? "Untitled board");
  database.exec("BEGIN IMMEDIATE");
  try {
    const existingCreatedAt = new Map(selectRecordTimes.all(boardId).map((record) => [`${record.mini_database_id}:${record.id}`, record.created_at]));
    upsertBoard.run(boardId, title, Y.encodeStateAsUpdate(document), now);
    deleteMiniDatabases.run(boardId);
    const databaseEntries = definitions.size > 0 ? Array.from(definitions.entries()) : Array.from(nodes.values()).filter((item) => item.get("kind") === "database" && item.get("databaseFields") instanceof Y.Array).map((item) => [String(item.get("id")), item]);
    for (const [databaseId, definition] of databaseEntries) {
      const fields = definition.get("fields") ?? definition.get("databaseFields");
      const records = definition.get("records") ?? definition.get("databaseRecords");
      if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error(`データベース ${databaseId} の形式が不正です。`);
      const name = definition.has("name") ? String(definition.get("name")) : textValue(definition.get("text"));
      insertMiniDatabase.run(databaseId, boardId, name, "table", 0, 0);
      const fieldList = fields.toArray();
      fieldList.forEach((field, index) => insertField.run(String(field.get("id")), databaseId, String(field.get("name")), String(field.get("type")), JSON.stringify(Array.isArray(field.get("options")) ? field.get("options") : []), JSON.stringify(field.get("optionColors") && typeof field.get("optionColors") === "object" && !Array.isArray(field.get("optionColors")) ? field.get("optionColors") : {}), field.has("tableVisible") ? Number(Boolean(field.get("tableVisible"))) : Number(field.get("system") !== "updatedAt"), String(field.get("dateFormat") ?? "date"), field.has("system") ? String(field.get("system")) : null, index));
      Array.from(records.entries()).forEach(([recordId, record], index) => {
        const updatedAt = String(record.get("__updatedAt") ?? now);
        insertRecord.run(recordId, databaseId, index, existingCreatedAt.get(`${databaseId}:${recordId}`) ?? now, updatedAt);
        fieldList.forEach((field) => {
          const fieldId = String(field.get("id"));
          insertValue.run(databaseId, recordId, fieldId, JSON.stringify(String(record.get(fieldId) ?? "")));
        });
      });
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK"); throw error;
  }
}

const server = new Server({
  port, debounce: 1000, maxDebounce: 5000,
  async onAuthenticate({ token }) {
    if (isServiceToken(token)) return { authenticationType: "service" };
    const user = validateCollaborationToken(typeof token === "string" ? token : "");
    if (!user) throw new Error("共同編集サーバーの認証に失敗しました。");
    return { authenticationType: "user", userAddress: user.address };
  },
  async onLoadDocument({ document, documentName }) {
    const row = selectBoard.get(documentName);
    if (row?.yjs_state) {
      Y.applyUpdate(document, new Uint8Array(row.yjs_state));
      document.getMap("meta").set("title", row.title);
    } else {
      try {
        Y.applyUpdate(document, await readFile(legacyDocumentPath(documentName)));
        persistDocument(document, documentName);
        console.log(`Migrated legacy Yjs document: ${documentName}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    return document;
  },
  async onStoreDocument({ document, documentName }) {
    persistDocument(document, documentName);
  },
});

await server.listen();
console.log(`Collaboration server: ws://localhost:${port}`);
console.log(`Fixed-schema database: ${join(dataDirectory, "mingleboard.sqlite")}`);

const stop = async () => { await server.destroy(); database.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
