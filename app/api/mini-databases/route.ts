import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth-store.mjs";
import { currentDatabaseTimestamp, normalizeDateValue, type DateDisplayFormat } from "@/lib/mini-database-date";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 1024 * 1024;
const MAX_ROWS = 500;
const MAX_COLUMNS = 30;
const MAX_CELL_LENGTH = 10_000;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const FORMULA_PREFIX = /^[\s\u0000]*[=+\-@＝＋－＠]/u;
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

type FieldRow = { id: string; mini_database_id: string; name: string; field_type: string; options_json: string; option_colors_json: string; table_visible: number; date_format: string; system_kind: string | null; sort_order: number };
type RecordRow = { id: string; mini_database_id: string; sort_order: number };
type ValueRow = { mini_database_id: string; record_id: string; field_id: string; value_json: string };

let database: DatabaseSync | undefined;

function getDatabase() {
  if (!database) {
    database = new DatabaseSync(join(process.cwd(), "data", "mingleboard.sqlite"), { readOnly: true });
    database.exec("PRAGMA foreign_keys = ON");
  }
  return database;
}

function requireId(value: string | null, label: string) {
  if (!value || !SAFE_ID.test(value)) throw new RequestError(400, `${label}が不正です。`);
  return value;
}

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function loadMiniDatabases(boardId: string, databaseId?: string) {
  const db = getDatabase();
  const databases = databaseId
    ? db.prepare("SELECT id, name, view_type FROM mini_databases WHERE board_id = ? AND id = ? ORDER BY name, id").all(boardId, databaseId)
    : db.prepare("SELECT id, name, view_type FROM mini_databases WHERE board_id = ? ORDER BY name, id").all(boardId);
  if (databaseId && databases.length === 0) throw new RequestError(404, "現在のボードに指定されたデータベースはありません。");
  const fields = db.prepare(`SELECT f.id, f.mini_database_id, f.name, f.field_type, f.options_json, f.option_colors_json, f.table_visible, f.date_format, f.system_kind, f.sort_order
    FROM mini_database_fields f JOIN mini_databases d ON d.id = f.mini_database_id
    WHERE d.board_id = ? ORDER BY f.mini_database_id, f.sort_order`).all(boardId) as unknown as FieldRow[];
  const records = db.prepare(`SELECT r.id, r.mini_database_id, r.sort_order
    FROM mini_database_records r JOIN mini_databases d ON d.id = r.mini_database_id
    WHERE d.board_id = ? ORDER BY r.mini_database_id, r.sort_order`).all(boardId) as unknown as RecordRow[];
  const values = db.prepare(`SELECT v.mini_database_id, v.record_id, v.field_id, v.value_json
    FROM mini_database_values v JOIN mini_databases d ON d.id = v.mini_database_id
    WHERE d.board_id = ?`).all(boardId) as unknown as ValueRow[];
  return databases.map((item) => {
    const definition = item as { id: string; name: string; view_type: string };
    const itemFields = fields.filter((field) => field.mini_database_id === definition.id);
    return {
      id: definition.id, name: definition.name, view: definition.view_type,
      fields: itemFields.map((field) => ({ id: field.id, name: field.name, type: field.field_type, options: JSON.parse(field.options_json) as string[], optionColors: JSON.parse(field.option_colors_json) as Record<string, string>, tableVisible: Boolean(field.table_visible), dateFormat: field.date_format as DateDisplayFormat, system: field.system_kind })),
      records: records.filter((record) => record.mini_database_id === definition.id).map((record) => ({
        id: record.id,
        values: Object.fromEntries(itemFields.map((field) => {
          const row = values.find((value) => value.mini_database_id === definition.id && value.record_id === record.id && value.field_id === field.id);
          return [field.id, row ? String(JSON.parse(row.value_json)) : ""];
        })),
      })),
    };
  });
}

function parseCsv(csv: string) {
  if (Buffer.byteLength(csv, "utf8") > MAX_CSV_BYTES) throw new RequestError(413, "CSVは1MB以下にしてください。");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += character;
    if (cell.length > MAX_CELL_LENGTH) throw new RequestError(400, "セルは10,000文字以下にしてください。");
  }
  if (quoted) throw new RequestError(400, "CSVの引用符が閉じられていません。");
  row.push(cell.replace(/\r$/, "")); if (row.some((value) => value.length > 0)) rows.push(row);
  if (rows.length < 2) throw new RequestError(400, "CSVにはヘッダーと1行以上のデータが必要です。");
  if (rows.length - 1 > MAX_ROWS) throw new RequestError(400, `CSVは${MAX_ROWS}行以下にしてください。`);
  if (rows[0].length > MAX_COLUMNS) throw new RequestError(400, `CSVは${MAX_COLUMNS}列以下にしてください。`);
  if (rows.some((entry) => entry.length !== rows[0].length)) throw new RequestError(400, "CSVの列数が行ごとに異なります。");
  if (rows.flat().some((value) => FORMULA_PREFIX.test(value))) throw new RequestError(400, "数式として実行される可能性があるセルを含むCSVは取り込めません。");
  return rows;
}

function csvCell(value: string) {
  const safe = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function errorResponse(error: unknown) {
  if (error instanceof RequestError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Mini database API error", error);
  return NextResponse.json({ error: "データベースの処理に失敗しました。" }, { status: 500 });
}

function authorizationError(request: Request) {
  const user = getRequestUser(request);
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "先に初回パスワードを変更してください。" }, { status: 403 });
  return null;
}

export async function GET(request: NextRequest) {
  const authError = authorizationError(request);
  if (authError) return authError;
  try {
    const boardId = requireId(request.nextUrl.searchParams.get("boardId"), "ボードID");
    const exportId = request.nextUrl.searchParams.get("export");
    if (!exportId) return NextResponse.json({ boardId, databases: loadMiniDatabases(boardId) });
    const databaseId = requireId(exportId, "データベースID");
    const item = loadMiniDatabases(boardId, databaseId)[0];
    const rows = [item.fields.map((field) => field.name), ...item.records.map((record) => item.fields.map((field) => record.values[field.id] ?? ""))];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mini-database-${databaseId}.csv"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: NextRequest) {
  const authError = authorizationError(request);
  if (authError) return authError;
  try {
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "Content-Typeはapplication/jsonを指定してください。");
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_CSV_BYTES * 1.1) throw new RequestError(413, "リクエストが大きすぎます。");
    const body = await request.json() as { boardId?: unknown; databaseId?: unknown; csv?: unknown };
    const boardId = requireId(typeof body.boardId === "string" ? body.boardId : null, "ボードID");
    const databaseId = requireId(typeof body.databaseId === "string" ? body.databaseId : null, "データベースID");
    if (typeof body.csv !== "string") throw new RequestError(400, "CSV本文が必要です。");
    const item = loadMiniDatabases(boardId, databaseId)[0];
    const rows = parseCsv(body.csv.replace(/^\uFEFF/, "")); const headers = rows[0];
    if (new Set(headers).size !== headers.length) throw new RequestError(400, "CSVのヘッダーが重複しています。");
    const fieldByHeader = new Map(item.fields.flatMap((field) => [[field.name, field], [field.id, field]]));
    const mappedFields = headers.map((header) => fieldByHeader.get(header));
    if (mappedFields.some((field) => !field)) throw new RequestError(400, "CSVのヘッダーがデータベースの列と一致しません。");
    const records = rows.slice(1).map((row) => ({ values: Object.fromEntries(row.map((value, index) => [mappedFields[index]!.id, value])) }));
    const dateFields = mappedFields.filter((field) => field?.type === "date");
    for (const field of dateFields) {
      if (!field || field.system) continue;
      for (const record of records) {
        const normalized = normalizeDateValue(record.values[field.id] ?? "", field.dateFormat ?? "date");
        if (normalized === null) throw new RequestError(400, `${field.name}列の日時形式が正しくありません。`);
        record.values[field.id] = normalized;
      }
    }
    const numberFields = mappedFields.filter((field) => field?.type === "number");
    if (numberFields.some((field) => records.some((record) => record.values[field!.id] !== "" && !DECIMAL_NUMBER.test(record.values[field!.id])))) {
      throw new RequestError(400, "数値列には整数または小数を指定してください。");
    }
    const updatedAtField = item.fields.find((field) => field.system === "updatedAt");
    if (updatedAtField) records.forEach((record) => { record.values[updatedAtField.id] = currentDatabaseTimestamp(); });
    return NextResponse.json({ databaseId, records });
  } catch (error) { return errorResponse(error); }
}
