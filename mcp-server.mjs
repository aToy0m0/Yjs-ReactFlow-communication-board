import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import * as z from "zod/v4";

const room = process.env.MINGLEBOARD_ROOM ?? "product-discovery";
const url = process.env.MINGLEBOARD_COLLAB_URL ?? "ws://localhost:1234";
const collaborationToken = process.env.MINGLEBOARD_COLLAB_TOKEN?.trim();
if (!collaborationToken) throw new Error("MINGLEBOARD_COLLAB_TOKENを設定してください。");
const agentName = process.env.MINGLEBOARD_AGENT_NAME ?? "AI Agent";
const agentOwner = process.env.MINGLEBOARD_AGENT_OWNER ?? "所有者未設定";
const agentColor = process.env.MINGLEBOARD_AGENT_COLOR ?? "#7c3aed";
const agentId = process.env.MINGLEBOARD_AGENT_ID ?? randomUUID();
const agentDisplayName = agentOwner === "所有者未設定" ? `${agentName} AI` : `${agentOwner}'s AI`;
const document = new Y.Doc();
let isSynced = false;

const provider = new HocuspocusProvider({
  url,
  name: room,
  document,
  token: collaborationToken,
  onSynced: () => { isSynced = true; },
  onDisconnect: () => { isSynced = false; },
});
provider.setAwarenessField("user", { name: agentDisplayName, color: agentColor, type: "agent", agentName, ownerName: agentOwner });
provider.setAwarenessField("cursor", null);

const nodes = document.getMap("nodes");
const databases = document.getMap("miniDatabases");
const UPDATED_AT_FIELD_ID = "__updatedAt";
const DEFAULT_EDGE_COLOR = "#2f2937";
const LEGACY_EDGE_COLOR = "#858092";
const DEFAULT_STATUS_OPTIONS = ["未着手", "進行中", "完了"];
const DEFAULT_STATUS_OPTION_COLORS = { "進行中": "#bde7ff", "完了": "#b9f5d8" };

function displayEdgeColor(value) {
  const color = String(value ?? "");
  return !color || color.toLowerCase() === LEGACY_EDGE_COLOR ? DEFAULT_EDGE_COLOR : color;
}

function databaseTimestamp(source = new Date()) {
  return `${String(source.getFullYear()).padStart(4, "0")}-${String(source.getMonth() + 1).padStart(2, "0")}-${String(source.getDate()).padStart(2, "0")}-${String(source.getHours()).padStart(2, "0")}${String(source.getMinutes()).padStart(2, "0")}`;
}

function databaseFieldMaps(fields) {
  const definitions = fields.filter((field) => field.id !== UPDATED_AT_FIELD_ID).map((field) => ({ ...field, dateFormat: field.type === "date" ? field.dateFormat ?? "date" : "date", options: field.type === "status" ? field.options ?? DEFAULT_STATUS_OPTIONS : field.type === "select" ? field.options ?? ["選択肢1", "選択肢2"] : [], optionColors: field.optionColors ?? (field.type === "status" ? DEFAULT_STATUS_OPTION_COLORS : {}), tableVisible: field.tableVisible ?? true }));
  definitions.push({ id: UPDATED_AT_FIELD_ID, name: "更新日時", type: "date", options: [], optionColors: {}, tableVisible: false, dateFormat: "datetime", system: "updatedAt" });
  return definitions.map((field) => { const value = new Y.Map(); Object.entries(field).forEach(([key, entry]) => { if (entry !== undefined) value.set(key, entry); }); return value; });
}
const edges = document.getMap("edges");
const comments = document.getMap("comments");
const meta = document.getMap("meta");
const events = document.getArray("agentEvents");
const permissions = document.getMap("mcpPermissions");
const readTools = new Set(["get_board_snapshot", "get_timer", "list_mini_databases", "get_mini_database", "render_board_svg"]);

function waitForSync() {
  if (isSynced) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      if (isSynced) resolve();
      else if (Date.now() >= deadline) reject(new Error(`共同編集サーバー ${url} に接続できません。npm run dev を起動してください。`));
      else setTimeout(check, 50);
    };
    check();
  });
}

async function authorize(toolName) {
  await waitForSync();
  const permission = String(permissions.get(toolName) ?? (readTools.has(toolName) ? "always_allow" : "require_approval"));
  if (permission === "deny") throw new Error(`ツール ${toolName} は、このボードのAI権限設定で拒否されています。`);
  if (!new Set(["always_allow", "require_approval"]).has(permission)) throw new Error(`ツール ${toolName} のAI権限設定 ${permission} は不正です。`);
}

function makeItem({ id = randomUUID(), kind, text, color, x, y, shape = "rectangle", status = "todo", locked = false, fontSize = kind === "text" ? 22 : 16, drawingPath = "", width, height, frameRows = 0, frameColumns = 0 }) {
  const item = new Y.Map();
  const yText = new Y.Text();
  yText.insert(0, text);
  Object.entries({ id, kind, color, x, y, shape, status, locked, fontSize, drawingPath, frameRows, frameColumns }).forEach(([key, value]) => item.set(key, value));
  if (width !== undefined) item.set("width", width); if (height !== undefined) item.set("height", height);
  item.set("text", yText);
  item.set("reactions", new Y.Map());
  return item;
}

function makeTable({ id = randomUUID(), name, x, y, fields, records, view = "table" }) {
  const item = makeItem({ id, kind: "database", text: name, color: "#ffffff", x, y });
  const databaseId = randomUUID(); const definition = new Y.Map(); definition.set("id", databaseId); definition.set("name", name);
  definition.set("sortOrder", databases.size);
  const yFields = new Y.Array();
  yFields.push(databaseFieldMaps(fields));
  const yRecords = new Y.Map();
  records.forEach((record) => { const value = new Y.Map(); Object.entries(record).forEach(([key, entry]) => { if (key !== UPDATED_AT_FIELD_ID) value.set(key, String(entry)); }); value.set(UPDATED_AT_FIELD_ID, databaseTimestamp()); yRecords.set(randomUUID(), value); });
  definition.set("fields", yFields); definition.set("records", yRecords); item.set("databaseId", databaseId); item.set("databaseView", view);
  return { item, definition, databaseId };
}

function itemText(item) {
  const text = item.get("text");
  return text instanceof Y.Text ? text.toString() : String(text ?? "");
}

function setItemText(item, value) {
  const text = item.get("text");
  if (!(text instanceof Y.Text)) throw new Error("アイテムのテキスト形式が不正です。");
  text.delete(0, text.length);
  text.insert(0, value);
}

function recordEvent(action, summary) {
  const event = new Y.Map();
  Object.entries({ id: randomUUID(), action, summary, actorType: "agent", agentId, agentName, ownerName: agentOwner, agentColor, createdAt: new Date().toISOString() })
    .forEach(([key, value]) => event.set(key, value));
  events.push([event]);
  if (events.length > 100) events.delete(0, events.length - 100);
}

async function whileEditing(nodeId, action) {
  const item = nodes.get(nodeId);
  const width = Number(item?.get("width") ?? (item?.get("kind") === "database" ? 780 : 220));
  const height = Number(item?.get("height") ?? (item?.get("kind") === "database" || item?.get("kind") === "frame" ? 400 : 156));
  provider.setAwarenessField("cursor", { x: Number(item?.get("x") ?? 0) + width / 2, y: Number(item?.get("y") ?? 0) + Math.min(48, height / 2) });
  provider.setAwarenessField("editing", { nodeId, user: { name: agentDisplayName, color: agentColor, type: "agent" } });
  try {
    const value = action();
    await new Promise((resolve) => setTimeout(resolve, 650));
    return value;
  } finally {
    provider.setAwarenessField("editing", null);
    provider.setAwarenessField("cursor", null);
  }
}

function tableData(item) {
  const databaseId = String(item.get("databaseId") ?? ""); const definition = databases.get(databaseId) ?? item;
  const fields = definition.get("fields") ?? definition.get("databaseFields"); const records = definition.get("records") ?? definition.get("databaseRecords");
  if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) return undefined;
  return {
    databaseId,
    view: String(item.get("databaseView") ?? "table"),
    fields: fields.toArray().map((field) => ({ id: String(field.get("id")), name: String(field.get("name")), type: String(field.get("type")), options: Array.isArray(field.get("options")) ? field.get("options") : [], optionColors: field.get("optionColors") ?? {}, tableVisible: field.has("tableVisible") ? Boolean(field.get("tableVisible")) : field.get("system") !== "updatedAt", dateFormat: String(field.get("dateFormat") ?? "date"), system: field.get("system") === "updatedAt" ? "updatedAt" : undefined })),
    records: Array.from(records.entries()).map(([id, record]) => ({ id, values: Object.fromEntries(record.entries()) })),
  };
}

function databaseData(databaseId, definition) {
  const fields = definition?.get("fields"); const records = definition?.get("records");
  if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error(`データベース ${databaseId} は存在しないか、形式が不正です。`);
  return {
    id: databaseId, name: String(definition.get("name") ?? "名称未設定"), sortOrder: Number(definition.get("sortOrder") ?? 0),
    fields: fields.toArray().map((field) => ({ id: String(field.get("id")), name: String(field.get("name")), type: String(field.get("type")), options: Array.isArray(field.get("options")) ? field.get("options") : [], optionColors: field.get("optionColors") ?? {}, tableVisible: field.has("tableVisible") ? Boolean(field.get("tableVisible")) : field.get("system") !== "updatedAt", dateFormat: String(field.get("dateFormat") ?? "date"), system: field.get("system") === "updatedAt" ? "updatedAt" : undefined })),
    records: Array.from(records.entries()).map(([id, record]) => ({ id, values: Object.fromEntries(record.entries()) })),
    viewIds: Array.from(nodes.entries()).filter(([, item]) => item.get("databaseId") === databaseId).map(([id]) => id),
  };
}

function databaseDefinition(databaseId) {
  const definition = databases.get(databaseId);
  const fields = definition?.get("fields");
  const records = definition?.get("records");
  if (!definition || !(fields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error(`データベース ${databaseId} は存在しないか、形式が不正です。`);
  return { definition, fields, records };
}

function storedFieldData(field) {
  return {
    id: String(field.get("id")),
    name: String(field.get("name")),
    type: String(field.get("type")),
    options: Array.isArray(field.get("options")) ? field.get("options") : [],
    optionColors: field.get("optionColors") ?? {},
    tableVisible: field.has("tableVisible") ? Boolean(field.get("tableVisible")) : field.get("system") !== "updatedAt",
    dateFormat: String(field.get("dateFormat") ?? "date"),
    system: field.get("system") === "updatedAt" ? "updatedAt" : undefined,
  };
}

function normalizeConnectedDatabaseViews(databaseId, fields) {
  const currentFields = fields.toArray();
  const hasStatus = currentFields.some((field) => ["status", "select"].includes(String(field.get("type"))) && Array.isArray(field.get("options")) && field.get("options").length > 0);
  const dateCount = currentFields.filter((field) => field.get("type") === "date" && !field.get("system") && ["date", "datetime"].includes(String(field.get("dateFormat") ?? "date"))).length;
  nodes.forEach((item) => {
    if (item.get("databaseId") !== databaseId) return;
    const view = String(item.get("databaseView") ?? "table");
    if ((view === "kanban" && !hasStatus) || (view === "gantt" && dateCount < 2) || (view === "calendar" && dateCount < 1)) item.set("databaseView", "table");
  });
}

function replaceDatabaseFields(fields, definitions) {
  fields.delete(0, fields.length);
  fields.push(databaseFieldMaps(definitions));
}

function databaseRecord(databaseId, recordId) {
  const { records } = databaseDefinition(databaseId);
  const record = records.get(recordId);
  if (!(record instanceof Y.Map)) throw new Error(`データベース ${databaseId} のレコード ${recordId} は存在しません。`);
  return { records, record };
}

function snapshot() {
  return {
    room,
    title: meta.get("title") ?? "Untitled board",
    timer: timerData(),
    items: Array.from(nodes.values()).map((item) => ({
      id: String(item.get("id")), kind: String(item.get("kind")), text: itemText(item),
      color: String(item.get("color")), x: Number(item.get("x")), y: Number(item.get("y")),
      shape: String(item.get("shape") ?? "rectangle"), status: String(item.get("status") ?? "todo"), locked: Boolean(item.get("locked")), fontSize: Number(item.get("fontSize") ?? 16), width: item.has("width") ? Number(item.get("width")) : null, height: item.has("height") ? Number(item.get("height")) : null, drawingPath: String(item.get("drawingPath") ?? ""), frameRows: Number(item.get("frameRows") ?? 0), frameColumns: Number(item.get("frameColumns") ?? 0), databaseId: String(item.get("databaseId") ?? ""),
      database: item.get("kind") === "database" ? tableData(item) : undefined,
    })),
    connectors: Array.from(edges.values()).map((edge) => ({
      id: String(edge.get("id")), source: String(edge.get("source")), target: String(edge.get("target")), label: String(edge.get("label") ?? ""),
    })),
    comments: Array.from(comments.values()).map((comment) => ({
      id: String(comment.get("id")), itemId: String(comment.get("nodeId") ?? ""), text: String(comment.get("text")),
      author: String(comment.get("author")), resolved: Boolean(comment.get("resolved")), createdAt: String(comment.get("createdAt")),
    })),
    agentActivity: events.toArray().slice(-30).map((event) => ({
      id: String(event.get("id")), action: String(event.get("action")), summary: String(event.get("summary")),
      ownerName: event.has("ownerName") ? String(event.get("ownerName")) : null,
      agentName: event.has("agentName") ? String(event.get("agentName")) : null,
      agentId: event.has("agentId") ? String(event.get("agentId")) : null,
      agentColor: event.has("agentColor") ? String(event.get("agentColor")) : null,
      createdAt: String(event.get("createdAt")),
    })),
  };
}

function timerData() {
  const end = Number(meta.get("timerEnd") ?? 0);
  const durationMinutes = Number(meta.get("timerDurationMinutes") ?? 5);
  const remainingSeconds = end > 0 ? Math.max(0, Math.ceil((end - Date.now()) / 1000)) : 0;
  return {
    status: end <= 0 ? "stopped" : remainingSeconds > 0 ? "running" : "finished",
    durationMinutes,
    endAt: end > 0 ? new Date(end).toISOString() : null,
    remainingSeconds,
    runId: String(meta.get("timerRunId") ?? ""),
  };
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function renderBoardSvg() {
  const items = Array.from(nodes.values());
  const bounds = items.map((item) => {
    const kind = String(item.get("kind"));
    const width = Number(item.get("width") ?? (kind === "database" ? 780 : kind === "frame" ? 620 : kind === "text" ? 240 : 220));
    const height = Number(item.get("height") ?? (kind === "database" || kind === "frame" ? 400 : kind === "text" ? 72 : 156));
    return { item, x: Number(item.get("x") ?? 0), y: Number(item.get("y") ?? 0), width, height };
  });
  const minX = Math.min(0, ...bounds.map((entry) => entry.x)) - 80; const minY = Math.min(0, ...bounds.map((entry) => entry.y)) - 80;
  const maxX = Math.max(960, ...bounds.map((entry) => entry.x + entry.width)) + 80; const maxY = Math.max(640, ...bounds.map((entry) => entry.y + entry.height)) + 80;
  const itemById = new Map(bounds.map((entry) => [String(entry.item.get("id")), entry]));
  const connectors = Array.from(edges.values()).map((edge) => {
    const source = itemById.get(String(edge.get("source"))); const target = itemById.get(String(edge.get("target"))); if (!source || !target) return "";
    const x1 = source.x + source.width / 2; const y1 = source.y + source.height / 2; const x2 = target.x + target.width / 2; const y2 = target.y + target.height / 2;
    return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="${escapeXml(displayEdgeColor(edge.get("color")))}" stroke-width="${Number(edge.get("strokeWidth") ?? 2)}" ${edge.get("dashed") ? 'stroke-dasharray="8 6"' : ""} marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-size="12" fill="#5f5a6d">${escapeXml(edge.get("label") ?? "")}</text>`;
  }).join("");
  const itemSvg = bounds.map(({ item, x, y, width, height }) => {
    const kind = String(item.get("kind")); const shape = String(item.get("shape") ?? "rectangle"); const color = escapeXml(item.get("color") ?? "#ffffff");
    const label = escapeXml(itemText(item)).replaceAll("\n", " ").slice(0, 120); const id = escapeXml(item.get("id"));
    const body = shape === "ellipse" ? `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}"/>` : shape === "diamond" ? `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}"/>` : `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${kind === "sticky" ? 4 : 14}"/>`;
    return `<g fill="${color}" stroke="#8176d8" stroke-width="1.5">${body}</g><text x="${x + 14}" y="${y + 25}" font-size="14" font-weight="700" fill="#292532">${label}</text><text x="${x + 14}" y="${y + height - 10}" font-size="8" fill="#777386">${kind} · ${id}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}" height="${maxY - minY}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}"><defs><pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dedbe6"/></pattern><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#2f2937"/></marker></defs><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="#fbfaff"/><rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="url(#dots)"/>${connectors}${itemSvg}</svg>`;
}

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function createServer() {
  const server = new McpServer(
    { name: "renraku-gakari", version: "1.0.0" },
    { instructions: `This agent is ${agentName}, owned by ${agentOwner}, instance ${agentId}. Call get_board_snapshot before updating existing items. Use item IDs returned by snapshot/create_item. Board changes are immediately visible to connected collaborators.` },
  );

  server.registerTool("get_board_snapshot", {
    description: "Get the current collaborative board title, items, connectors, and comments.",
    annotations: { readOnlyHint: true },
  }, async () => { await authorize("get_board_snapshot"); return result(snapshot()); });

  server.registerTool("get_timer", {
    description: "Get the shared board timer status, configured duration, end time, and remaining seconds.",
    annotations: { readOnlyHint: true },
  }, async () => { await authorize("get_timer"); return result(timerData()); });

  server.registerTool("set_timer", {
    description: "Configure, start, or stop the shared board timer. Starting or stopping is immediately visible to all collaborators.",
    inputSchema: {
      action: z.enum(["configure", "start", "stop"]),
      minutes: z.number().int().min(1).max(180).optional(),
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  }, async ({ action, minutes }) => {
    await authorize("set_timer");
    if (action === "configure" && minutes === undefined) throw new Error("configureにはminutesが必要です。");
    const durationMinutes = minutes ?? Number(meta.get("timerDurationMinutes") ?? 5);
    document.transact(() => {
      if (minutes !== undefined) meta.set("timerDurationMinutes", String(minutes));
      if (action === "start") {
        meta.set("timerRunId", randomUUID());
        meta.set("timerEnd", String(Date.now() + durationMinutes * 60_000));
        meta.set("timerNoticeId", "");
        meta.set("timerNoticeReason", "");
      } else if (action === "stop") {
        meta.set("timerEnd", "0");
        meta.set("timerNoticeId", randomUUID());
        meta.set("timerNoticeReason", "stopped");
      }
      recordEvent("set_timer", `${action}${minutes === undefined ? "" : ` ${minutes}分`}`);
    }, "mcp-agent");
    return result(timerData());
  });

  server.registerTool("render_board_svg", {
    description: "Render the complete board as an SVG image so a vision-capable agent can inspect the overall layout and appearance.",
    annotations: { readOnlyHint: true },
  }, async () => {
    await authorize("render_board_svg");
    const svg = renderBoardSvg();
    return { content: [{ type: "image", data: Buffer.from(svg, "utf8").toString("base64"), mimeType: "image/svg+xml" }] };
  });

  server.registerTool("list_mini_databases", {
    description: "List databases on the current board, including schema and connected view IDs.",
    annotations: { readOnlyHint: true },
  }, async () => {
    await authorize("list_mini_databases");
    return result({ databases: Array.from(databases.entries()).map(([id, definition]) => {
      const data = databaseData(id, definition);
      return { id: data.id, name: data.name, fields: data.fields, recordCount: data.records.length, viewIds: data.viewIds };
    }) });
  });

  server.registerTool("get_mini_database", {
    description: "Get one database schema, records, and connected view IDs.",
    inputSchema: z.object({ databaseId: z.string().min(1) }),
    annotations: { readOnlyHint: true },
  }, async ({ databaseId }) => {
    await authorize("get_mini_database");
    return result(databaseData(databaseId, databases.get(databaseId)));
  });

  server.registerTool("create_item", {
    description: "Create a sticky note, text, shape, task card, frame, freehand drawing, line, or URL link on the board.",
    inputSchema: z.object({
      kind: z.enum(["sticky", "text", "shape", "card", "frame", "drawing", "line", "link"]),
      text: z.string().min(1), color: z.string().default("#ffd972"), x: z.number().default(200), y: z.number().default(200),
      shape: z.enum(["rectangle", "ellipse", "diamond", "triangle"]).default("rectangle"),
      status: z.enum(["todo", "doing", "done"]).default("todo"),
      drawingPath: z.string().default(""), width: z.number().positive().optional(), height: z.number().positive().optional(), frameRows: z.number().int().min(0).max(12).default(0), frameColumns: z.number().int().min(0).max(12).default(0),
    }),
  }, async (input) => {
    await authorize("create_item");
    const id = randomUUID();
    document.transact(() => { nodes.set(id, makeItem({ ...input, id })); recordEvent("create_item", `${input.kind}: ${input.text}`); }, "mcp-agent");
    return result({ id, created: true });
  });

  server.registerTool("update_item", {
    description: "Update an existing board item. Omitted fields remain unchanged.",
    inputSchema: z.object({
      id: z.string(), text: z.string().optional(), color: z.string().optional(), x: z.number().optional(), y: z.number().optional(),
      shape: z.enum(["rectangle", "ellipse", "diamond", "triangle"]).optional(), status: z.enum(["todo", "doing", "done"]).optional(), locked: z.boolean().optional(), fontSize: z.number().int().min(10).max(48).optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), frameRows: z.number().int().min(0).max(12).optional(), frameColumns: z.number().int().min(0).max(12).optional(),
    }),
  }, async ({ id, text, ...fields }) => {
    await authorize("update_item");
    const item = nodes.get(id);
    if (!item) throw new Error(`アイテム ${id} は存在しません。`);
    await whileEditing(id, () => document.transact(() => {
      if (text !== undefined) setItemText(item, text);
      Object.entries(fields).forEach(([key, value]) => { if (value !== undefined) item.set(key, value); });
      recordEvent("update_item", `${id}: ${text ?? "プロパティ更新"}`);
    }, "mcp-agent"));
    return result({ id, updated: true });
  });

  server.registerTool("delete_item", {
    description: "Delete one board item and its attached connectors.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    await authorize("delete_item");
    if (!nodes.has(id)) throw new Error(`アイテム ${id} は存在しません。`);
    document.transact(() => {
      nodes.delete(id);
      Array.from(edges.entries()).forEach(([edgeId, edge]) => {
        if (edge.get("source") === id || edge.get("target") === id) edges.delete(edgeId);
      });
      recordEvent("delete_item", id);
    }, "mcp-agent");
    return result({ id, deleted: true });
  });

  server.registerTool("connect_items", {
    description: "Connect two existing board items with a labeled line.",
    inputSchema: z.object({ sourceId: z.string(), targetId: z.string(), label: z.string().default(""), sourceHandle: z.enum(["top", "bottom", "left", "right"]).default("right"), targetHandle: z.enum(["top", "bottom", "left", "right"]).default("left"), lineType: z.enum(["straight", "bezier", "smoothstep"]).default("bezier"), strokeWidth: z.number().min(1).max(12).default(2), dashed: z.boolean().default(false), startMarker: z.enum(["none", "open", "arrow"]).default("none"), endMarker: z.enum(["none", "open", "arrow"]).default("arrow") }),
  }, async ({ sourceId, targetId, label, sourceHandle, targetHandle, lineType, strokeWidth, dashed, startMarker, endMarker }) => {
    await authorize("connect_items");
    if (!nodes.has(sourceId) || !nodes.has(targetId)) throw new Error("接続元または接続先のアイテムが存在しません。");
    const id = randomUUID(); const edge = new Y.Map();
    Object.entries({ id, source: sourceId, target: targetId, sourceHandle, targetHandle, label, animated: false, lineType, strokeWidth, dashed, startMarker, endMarker, color: DEFAULT_EDGE_COLOR }).forEach(([key, value]) => edge.set(key, value));
    document.transact(() => { edges.set(id, edge); recordEvent("connect_items", `${sourceId} → ${targetId}`); }, "mcp-agent");
    return result({ id, connected: true });
  });

  server.registerTool("update_connector", {
    description: "Update an existing connector's endpoints, label, color, route, width, dash, or arrow markers.",
    inputSchema: z.object({ id: z.string(), sourceId: z.string().optional(), targetId: z.string().optional(), label: z.string().optional(), color: z.string().optional(), sourceHandle: z.enum(["top", "bottom", "left", "right"]).optional(), targetHandle: z.enum(["top", "bottom", "left", "right"]).optional(), lineType: z.enum(["straight", "bezier", "smoothstep"]).optional(), strokeWidth: z.number().min(1).max(12).optional(), dashed: z.boolean().optional(), startMarker: z.enum(["none", "open", "arrow"]).optional(), endMarker: z.enum(["none", "open", "arrow"]).optional(), locked: z.boolean().optional() }),
  }, async ({ id, sourceId, targetId, ...values }) => {
    await authorize("update_connector"); const edge = edges.get(id); if (!edge) throw new Error(`接続線 ${id} は存在しません。`);
    const source = sourceId ?? String(edge.get("source")); const target = targetId ?? String(edge.get("target"));
    if (!nodes.has(source) || !nodes.has(target)) throw new Error("接続元または接続先のアイテムが存在しません。");
    document.transact(() => { edge.set("source", source); edge.set("target", target); Object.entries(values).forEach(([key, value]) => { if (value !== undefined) edge.set(key, value); }); recordEvent("update_connector", id); }, "mcp-agent");
    return result({ id, updated: true });
  });

  server.registerTool("delete_connector", {
    description: "Delete one connector without deleting its endpoint items.",
    inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true },
  }, async ({ id }) => {
    await authorize("delete_connector"); if (!edges.has(id)) throw new Error(`接続線 ${id} は存在しません。`);
    document.transact(() => { edges.delete(id); recordEvent("delete_connector", id); }, "mcp-agent"); return result({ id, deleted: true });
  });

  server.registerTool("add_comment", {
    description: "Add a comment to the whole board or to one board item.",
    inputSchema: z.object({ text: z.string().min(1), itemId: z.string().default(""), author: z.string().default("AI Agent") }),
  }, async ({ text, itemId, author }) => {
    await authorize("add_comment");
    if (itemId && !nodes.has(itemId)) throw new Error(`アイテム ${itemId} は存在しません。`);
    const id = randomUUID(); const comment = new Y.Map();
    Object.entries({ id, nodeId: itemId, text, author, resolved: false, createdAt: new Date().toISOString() }).forEach(([key, value]) => comment.set(key, value));
    document.transact(() => { comments.set(id, comment); recordEvent("add_comment", text); }, "mcp-agent");
    return result({ id, created: true });
  });

  server.registerTool("resolve_comment", {
    description: "Mark a board or item comment as resolved or unresolved.",
    inputSchema: z.object({ id: z.string(), resolved: z.boolean().default(true) }),
  }, async ({ id, resolved }) => {
    await authorize("resolve_comment"); const comment = comments.get(id); if (!comment) throw new Error(`コメント ${id} は存在しません。`);
    document.transact(() => { comment.set("resolved", resolved); recordEvent("resolve_comment", `${id}: ${resolved}`); }, "mcp-agent"); return result({ id, resolved, updated: true });
  });

  server.registerTool("delete_comment", {
    description: "Delete one board or item comment.",
    inputSchema: z.object({ id: z.string().min(1) }),
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    await authorize("delete_comment");
    if (!comments.has(id)) throw new Error(`コメント ${id} は存在しません。`);
    document.transact(() => { comments.delete(id); recordEvent("delete_comment", id); }, "mcp-agent");
    return result({ id, deleted: true });
  });

  server.registerTool("add_reaction", {
    description: "Add one emoji reaction to an existing board item.",
    inputSchema: z.object({ itemId: z.string().min(1), emoji: z.string().min(1).max(16) }),
  }, async ({ itemId, emoji }) => {
    await authorize("add_reaction");
    const item = nodes.get(itemId);
    const reactions = item?.get("reactions");
    if (!item || !(reactions instanceof Y.Map)) throw new Error(`アイテム ${itemId} は存在しないか、リアクション形式が不正です。`);
    document.transact(() => { reactions.set(emoji, Number(reactions.get(emoji) ?? 0) + 1); recordEvent("add_reaction", `${itemId}: ${emoji}`); }, "mcp-agent");
    return result({ itemId, emoji, count: Number(reactions.get(emoji)), updated: true });
  });

  server.registerTool("set_board_title", {
    description: "Set the collaborative board title.",
    inputSchema: z.object({ title: z.string().min(1) }),
  }, async ({ title }) => {
    await authorize("set_board_title");
    document.transact(() => { meta.set("title", title); recordEvent("set_board_title", title); }, "mcp-agent");
    return result({ title, updated: true });
  });

  server.registerTool("apply_template", {
    description: "Place a brainstorm, kanban, or retrospective starter template.",
    inputSchema: z.object({ template: z.enum(["brainstorm", "kanban", "retro"]), x: z.number().default(100), y: z.number().default(100) }),
  }, async ({ template, x, y }) => {
    await authorize("apply_template");
    const createdIds = [];
    const add = (kind, text, color, offsetX, offsetY) => {
      const id = randomUUID(); createdIds.push(id); nodes.set(id, makeItem({ id, kind, text, color, x: x + offsetX, y: y + offsetY }));
    };
    document.transact(() => {
      add("frame", template === "brainstorm" ? "ブレインストーミング" : template === "kanban" ? "カンバン" : "振り返り", "#f5f2ff", 0, 0);
      const labels = template === "brainstorm" ? ["課題", "アイデア", "次の一歩"] : template === "kanban" ? ["未着手", "進行中", "完了"] : ["よかった", "課題", "次に試す"];
      labels.forEach((label, index) => add(template === "kanban" ? "card" : "sticky", label, ["#ffd972", "#bde7ff", "#b9f5d8"][index], 45 + index * 180, 125));
      recordEvent("apply_template", template);
    }, "mcp-agent");
    return result({ template, createdIds });
  });

  const fieldSchema = z.object({ id: z.string().min(1).refine((id) => id !== UPDATED_AT_FIELD_ID, "__updatedAtはシステム予約IDです。"), name: z.string().min(1), type: z.enum(["text", "textarea", "number", "status", "select", "person", "date"]), options: z.array(z.string().min(1)).optional(), optionColors: z.record(z.string(), z.string()).optional(), tableVisible: z.boolean().optional(), dateFormat: z.enum(["datetime", "date", "month", "hour", "time"]).optional() });
  const filterSchema = z.object({ id: z.string().min(1).default(() => randomUUID()), fieldId: z.string().min(1), operator: z.enum(["equals", "not_equals", "contains", "not_contains"]), value: z.string() });

  server.registerTool("create_mini_database", {
    description: "Create a database definition without placing a view object on the canvas.",
    inputSchema: z.object({
      name: z.string().min(1),
      fields: z.array(fieldSchema).default([{ id: "title", name: "タスク", type: "text" }, { id: "status", name: "状態", type: "status", options: DEFAULT_STATUS_OPTIONS, optionColors: DEFAULT_STATUS_OPTION_COLORS }, { id: "owner", name: "担当者", type: "person" }, { id: "startDate", name: "開始日", type: "date" }, { id: "endDate", name: "終了日", type: "date" }]),
    }),
  }, async ({ name, fields }) => {
    await authorize("create_mini_database");
    if (new Set(fields.map((field) => field.id)).size !== fields.length) throw new Error("列IDはデータベース内で一意にしてください。");
    const databaseId = randomUUID(); const definition = new Y.Map(); const yFields = new Y.Array();
    yFields.push(databaseFieldMaps(fields));
    definition.set("id", databaseId); definition.set("name", name); definition.set("sortOrder", databases.size); definition.set("fields", yFields); definition.set("records", new Y.Map());
    document.transact(() => { databases.set(databaseId, definition); recordEvent("create_mini_database", name); }, "mcp-agent");
    return result({ databaseId, created: true });
  });

  server.registerTool("rename_database", {
    description: "Rename one database without replacing its fields or records.",
    inputSchema: z.object({ databaseId: z.string().min(1), name: z.string().min(1) }),
  }, async ({ databaseId, name }) => {
    await authorize("rename_database");
    const { definition } = databaseDefinition(databaseId);
    document.transact(() => { definition.set("name", name); recordEvent("rename_database", `${databaseId}: ${name}`); }, "mcp-agent");
    return result({ databaseId, name, updated: true });
  });

  server.registerTool("reorder_databases", {
    description: "Move one or more databases as a contiguous block before or after another database.",
    inputSchema: z.object({ databaseIds: z.array(z.string().min(1)).min(1), targetDatabaseId: z.string().min(1), position: z.enum(["before", "after"]) }),
  }, async ({ databaseIds, targetDatabaseId, position }) => {
    await authorize("reorder_databases");
    const requestedIds = new Set(databaseIds);
    if (requestedIds.size !== databaseIds.length) throw new Error("移動するデータベースIDが重複しています。");
    if (requestedIds.has(targetDatabaseId)) throw new Error("移動対象を挿入先には指定できません。");
    const ordered = Array.from(databases.entries()).map(([id, definition], index) => ({ id, definition, sortOrder: Number(definition.get("sortOrder") ?? index) })).sort((a, b) => a.sortOrder - b.sortOrder);
    const moving = ordered.filter(({ id }) => requestedIds.has(id));
    if (moving.length !== requestedIds.size) throw new Error("移動するデータベースの一部が存在しません。");
    const remaining = ordered.filter(({ id }) => !requestedIds.has(id));
    const targetIndex = remaining.findIndex(({ id }) => id === targetDatabaseId);
    if (targetIndex < 0) throw new Error(`挿入先データベース ${targetDatabaseId} は存在しません。`);
    remaining.splice(position === "before" ? targetIndex : targetIndex + 1, 0, ...moving);
    document.transact(() => { remaining.forEach(({ definition }, index) => definition.set("sortOrder", index)); recordEvent("reorder_databases", databaseIds.join(",")); }, "mcp-agent");
    return result({ databaseIds, targetDatabaseId, position, updated: true });
  });

  server.registerTool("add_database_field", {
    description: "Add one column to a database. Omit beforeFieldId to append it before the system update timestamp column.",
    inputSchema: z.object({
      databaseId: z.string().min(1),
      field: fieldSchema,
      beforeFieldId: z.string().min(1).optional(),
    }),
  }, async ({ databaseId, field, beforeFieldId }) => {
    await authorize("add_database_field");
    const { fields } = databaseDefinition(databaseId);
    const current = fields.toArray().map(storedFieldData);
    if (current.some((entry) => entry.id === field.id)) throw new Error(`列ID ${field.id} は既に存在します。`);
    const definitions = current.filter((entry) => !entry.system);
    const insertionIndex = beforeFieldId === undefined || beforeFieldId === UPDATED_AT_FIELD_ID ? definitions.length : definitions.findIndex((entry) => entry.id === beforeFieldId);
    if (insertionIndex < 0) throw new Error(`挿入先の列 ${beforeFieldId} は存在しません。`);
    definitions.splice(insertionIndex, 0, field);
    document.transact(() => { replaceDatabaseFields(fields, definitions); normalizeConnectedDatabaseViews(databaseId, fields); recordEvent("add_database_field", `${databaseId}: ${field.id}`); }, "mcp-agent");
    return result({ databaseId, fieldId: field.id, created: true });
  });

  server.registerTool("update_database_field", {
    description: "Partially update one database column, including its name, type, options, option colors, date format, or table visibility.",
    inputSchema: z.object({
      databaseId: z.string().min(1), fieldId: z.string().min(1),
      name: z.string().min(1).optional(), type: z.enum(["text", "textarea", "number", "status", "select", "person", "date"]).optional(),
      options: z.array(z.string().min(1)).optional(), optionColors: z.record(z.string(), z.string()).optional(), tableVisible: z.boolean().optional(),
      dateFormat: z.enum(["datetime", "date", "month", "hour", "time"]).optional(),
    }),
  }, async ({ databaseId, fieldId, ...updates }) => {
    await authorize("update_database_field");
    if (Object.values(updates).every((value) => value === undefined)) throw new Error("変更する列設定を1つ以上指定してください。");
    const { fields } = databaseDefinition(databaseId);
    const current = fields.toArray().map(storedFieldData);
    const target = current.find((field) => field.id === fieldId);
    if (!target) throw new Error(`列 ${fieldId} は存在しません。`);
    if (target.system && Object.entries(updates).some(([key, value]) => value !== undefined && key !== "tableVisible")) throw new Error("システム列は表への表示・非表示だけ変更できます。");
    const next = { ...target, ...Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined)) };
    if (next.type === "status" && next.options.length === 0) { next.options = DEFAULT_STATUS_OPTIONS; next.optionColors = DEFAULT_STATUS_OPTION_COLORS; }
    if (next.type === "select" && next.options.length === 0) next.options = ["選択肢1", "選択肢2"];
    if (!["status", "select"].includes(next.type)) { next.options = []; next.optionColors = {}; }
    if (updates.options !== undefined && updates.optionColors === undefined) next.optionColors = Object.fromEntries(Object.entries(next.optionColors).filter(([option]) => next.options.includes(option)));
    if (next.type === "date" && updates.dateFormat === undefined && target.type !== "date") next.dateFormat = "date";
    const definitions = current.filter((field) => !field.system).map((field) => field.id === fieldId ? next : field);
    document.transact(() => {
      if (target.system) fields.toArray().find((field) => field.get("id") === fieldId)?.set("tableVisible", next.tableVisible);
      else replaceDatabaseFields(fields, definitions);
      normalizeConnectedDatabaseViews(databaseId, fields);
      recordEvent("update_database_field", `${databaseId}: ${fieldId}`);
    }, "mcp-agent");
    return result({ databaseId, fieldId, updated: true });
  });

  server.registerTool("delete_database_fields", {
    description: "Delete one or more database columns and remove their values from every record.",
    inputSchema: z.object({ databaseId: z.string().min(1), fieldIds: z.array(z.string().min(1)).min(1) }),
    annotations: { destructiveHint: true },
  }, async ({ databaseId, fieldIds }) => {
    await authorize("delete_database_fields");
    const requestedIds = new Set(fieldIds);
    if (requestedIds.size !== fieldIds.length) throw new Error("削除する列IDが重複しています。");
    const { fields, records } = databaseDefinition(databaseId);
    const current = fields.toArray().map(storedFieldData);
    const targets = current.filter((field) => requestedIds.has(field.id));
    if (targets.length !== requestedIds.size) throw new Error("削除する列の一部が存在しません。");
    if (targets.some((field) => field.system)) throw new Error("システム列は削除できません。");
    const definitions = current.filter((field) => !field.system && !requestedIds.has(field.id));
    document.transact(() => {
      replaceDatabaseFields(fields, definitions);
      records.forEach((record) => fieldIds.forEach((fieldId) => record.delete(fieldId)));
      normalizeConnectedDatabaseViews(databaseId, fields);
      recordEvent("delete_database_fields", `${databaseId}: ${fieldIds.join(",")}`);
    }, "mcp-agent");
    return result({ databaseId, fieldIds, deleted: true });
  });

  server.registerTool("reorder_database_fields", {
    description: "Move selected database columns as one contiguous block before or after another column.",
    inputSchema: z.object({ databaseId: z.string().min(1), fieldIds: z.array(z.string().min(1)).min(1), targetFieldId: z.string().min(1), position: z.enum(["before", "after"]) }),
  }, async ({ databaseId, fieldIds, targetFieldId, position }) => {
    await authorize("reorder_database_fields");
    const requestedIds = new Set(fieldIds);
    if (requestedIds.size !== fieldIds.length) throw new Error("移動する列IDが重複しています。");
    if (requestedIds.has(targetFieldId)) throw new Error("移動対象を挿入先には指定できません。");
    const { fields } = databaseDefinition(databaseId);
    const current = fields.toArray().map(storedFieldData);
    const moving = current.filter((field) => requestedIds.has(field.id));
    if (moving.length !== requestedIds.size) throw new Error("移動する列の一部が存在しません。");
    if (moving.some((field) => field.system)) throw new Error("システム列は移動できません。");
    const remaining = current.filter((field) => !field.system && !requestedIds.has(field.id));
    const targetIndex = targetFieldId === UPDATED_AT_FIELD_ID ? remaining.length : remaining.findIndex((field) => field.id === targetFieldId);
    if (targetIndex < 0) throw new Error(`挿入先の列 ${targetFieldId} は存在しません。`);
    if (targetFieldId === UPDATED_AT_FIELD_ID && position === "after") throw new Error("システム列の後ろには列を移動できません。");
    remaining.splice(position === "before" ? targetIndex : targetIndex + 1, 0, ...moving);
    document.transact(() => { replaceDatabaseFields(fields, remaining); recordEvent("reorder_database_fields", `${databaseId}: ${fieldIds.join(",")}`); }, "mcp-agent");
    return result({ databaseId, fieldIds, targetFieldId, position, updated: true });
  });

  server.registerTool("update_mini_database_schema", {
    description: "Rename a database and replace its column settings. Existing values for retained field IDs are preserved.",
    inputSchema: z.object({ databaseId: z.string().min(1), name: z.string().min(1).optional(), fields: z.array(fieldSchema).min(1) }),
  }, async ({ databaseId, name, fields }) => {
    await authorize("update_mini_database_schema");
    if (new Set(fields.map((field) => field.id)).size !== fields.length) throw new Error("列IDはデータベース内で一意にしてください。");
    const definition = databases.get(databaseId); const currentFields = definition?.get("fields"); const records = definition?.get("records");
    if (!definition || !(currentFields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error(`データベース ${databaseId} は存在しません。`);
    const nextIds = new Set([...fields.map((field) => field.id), UPDATED_AT_FIELD_ID]);
    document.transact(() => {
      if (name !== undefined) definition.set("name", name);
      currentFields.delete(0, currentFields.length);
      currentFields.push(databaseFieldMaps(fields));
      records.forEach((record) => Array.from(record.keys()).forEach((key) => { if (!nextIds.has(key)) record.delete(key); }));
      recordEvent("update_mini_database_schema", `${databaseId}: ${name ?? "列設定変更"}`);
    }, "mcp-agent");
    return result({ databaseId, updated: true });
  });

  server.registerTool("delete_mini_database", {
    description: "Delete a database definition and disconnect its canvas views.",
    inputSchema: z.object({ databaseId: z.string().min(1) }),
    annotations: { destructiveHint: true },
  }, async ({ databaseId }) => {
    await authorize("delete_mini_database");
    if (!databases.has(databaseId)) throw new Error(`データベース ${databaseId} は存在しません。`);
    document.transact(() => {
      nodes.forEach((item) => { if (item.get("databaseId") === databaseId) { item.set("databaseId", ""); item.set("databaseView", "table"); } });
      databases.delete(databaseId); recordEvent("delete_mini_database", databaseId);
    }, "mcp-agent");
    return result({ databaseId, deleted: true });
  });

  server.registerTool("create_table", {
    description: "Create a structured database with table, kanban, and dated Gantt views. The physical database schema stays unchanged.",
    inputSchema: z.object({
      name: z.string().min(1), x: z.number().default(200), y: z.number().default(200), view: z.enum(["table", "kanban", "gantt"]).default("table"),
      fields: z.array(fieldSchema).default([{ id: "title", name: "タスク", type: "text" }, { id: "status", name: "状態", type: "status" }, { id: "owner", name: "担当者", type: "person" }, { id: "startDate", name: "開始日", type: "date" }, { id: "endDate", name: "終了日", type: "date" }]),
      records: z.array(z.record(z.string(), z.string())).default([]),
    }),
  }, async (input) => {
    await authorize("create_table");
    const id = randomUUID();
    let databaseId;
    document.transact(() => { const created = makeTable({ ...input, id }); databaseId = created.databaseId; nodes.set(id, created.item); databases.set(created.databaseId, created.definition); recordEvent("create_table", input.name); }, "mcp-agent");
    return result({ id, tableId: id, databaseId, created: true });
  });

  server.registerTool("create_database_view", {
    description: "Place another table, kanban, Gantt, or calendar view connected to an existing database.",
    inputSchema: z.object({ databaseId: z.string(), x: z.number().default(200), y: z.number().default(200), view: z.enum(["table", "kanban", "gantt", "calendar"]).default("table"), width: z.number().positive().default(780), height: z.number().positive().default(400) }),
  }, async ({ databaseId, x, y, view, width, height }) => {
    await authorize("create_database_view"); const definition = databases.get(databaseId); if (!definition) throw new Error(`データベース ${databaseId} は存在しません。`);
    const id = randomUUID(); const item = makeItem({ id, kind: "database", text: String(definition.get("name") ?? "データベース"), color: "#ffffff", x, y, width, height });
    Object.entries({ databaseId, databaseView: view, tableVisibleFieldIds: [], tableColumnWidths: {}, tableRowHeight: 44, kanbanGroupFieldId: "", ganttStartFieldId: "", ganttEndFieldId: "", ganttScale: "week", ganttRangeMode: "auto", ganttFixedStart: "", ganttFixedEnd: "", ganttRelativeUnit: "month", ganttRelativeBefore: 2, ganttRelativeAfter: 1, calendarDateFieldId: "", calendarShowHolidays: true, calendarWeekStart: "monday", calendarScrollDirection: "vertical", calendarRangeMode: "relative", calendarFixedStart: "", calendarFixedEnd: "", calendarRelativeBefore: 0, calendarRelativeAfter: 2 }).forEach(([key, value]) => item.set(key, value));
    document.transact(() => { nodes.set(id, item); recordEvent("create_database_view", `${databaseId}: ${view}`); }, "mcp-agent"); return result({ id, databaseId, view, created: true });
  });

  server.registerTool("connect_database_view", {
    description: "Connect an existing database view object to a database, or disconnect it by passing an empty databaseId.",
    inputSchema: z.object({ viewId: z.string().min(1), databaseId: z.string() }),
  }, async ({ viewId, databaseId }) => {
    await authorize("connect_database_view");
    const item = nodes.get(viewId);
    if (!item || item.get("kind") !== "database") throw new Error(`データベース表示オブジェクト ${viewId} は存在しません。`);
    if (databaseId) databaseDefinition(databaseId);
    document.transact(() => {
      item.set("databaseId", databaseId); item.set("databaseView", "table");
      item.set("tableVisibleFieldIds", []); item.set("kanbanGroupFieldId", "");
      item.set("ganttStartFieldId", ""); item.set("ganttEndFieldId", "");
      recordEvent("connect_database_view", `${viewId}: ${databaseId || "disconnected"}`);
    }, "mcp-agent");
    return result({ viewId, databaseId, connected: Boolean(databaseId), updated: true });
  });

  server.registerTool("add_table_record", {
    description: "Add one record to an existing database through a canvas view.",
    inputSchema: z.object({ tableId: z.string(), values: z.record(z.string(), z.string()) }),
  }, async ({ tableId, values }) => {
    await authorize("add_table_record"); const item = nodes.get(tableId); const definition = item ? databases.get(String(item.get("databaseId") ?? "")) ?? item : undefined; const records = definition?.get("records") ?? definition?.get("databaseRecords");
    if (!item || item.get("kind") !== "database" || !(records instanceof Y.Map)) throw new Error(`データベース ${tableId} は存在しません。`);
    const recordId = randomUUID(); const record = new Y.Map(); Object.entries(values).forEach(([key, value]) => { if (key !== UPDATED_AT_FIELD_ID) record.set(key, value); }); record.set(UPDATED_AT_FIELD_ID, databaseTimestamp());
    await whileEditing(tableId, () => document.transact(() => { records.set(recordId, record); recordEvent("add_table_record", `${tableId}: ${recordId}`); }, "mcp-agent"));
    return result({ tableId, recordId, created: true });
  });

  server.registerTool("update_table_record", {
    description: "Update fields on one database record through a canvas view.",
    inputSchema: z.object({ tableId: z.string(), recordId: z.string(), values: z.record(z.string(), z.string()) }),
  }, async ({ tableId, recordId, values }) => {
    await authorize("update_table_record"); const item = nodes.get(tableId); const definition = item ? databases.get(String(item.get("databaseId") ?? "")) ?? item : undefined; const records = definition?.get("records") ?? definition?.get("databaseRecords"); const record = records instanceof Y.Map ? records.get(recordId) : undefined;
    if (!(record instanceof Y.Map)) throw new Error(`データベース ${tableId} のレコード ${recordId} は存在しません。`);
    await whileEditing(tableId, () => document.transact(() => { Object.entries(values).forEach(([key, value]) => { if (key !== UPDATED_AT_FIELD_ID) record.set(key, value); }); record.set(UPDATED_AT_FIELD_ID, databaseTimestamp()); recordEvent("update_table_record", `${tableId}: ${recordId}`); }, "mcp-agent"));
    return result({ tableId, recordId, updated: true });
  });

  server.registerTool("delete_table_record", {
    description: "Delete one database record through a canvas view.",
    inputSchema: z.object({ tableId: z.string(), recordId: z.string() }), annotations: { destructiveHint: true },
  }, async ({ tableId, recordId }) => {
    await authorize("delete_table_record"); const item = nodes.get(tableId); const definition = item ? databases.get(String(item.get("databaseId") ?? "")) ?? item : undefined; const records = definition?.get("records") ?? definition?.get("databaseRecords");
    if (!(records instanceof Y.Map) || !records.has(recordId)) throw new Error(`データベース ${tableId} のレコード ${recordId} は存在しません。`);
    await whileEditing(tableId, () => document.transact(() => { records.delete(recordId); recordEvent("delete_table_record", `${tableId}: ${recordId}`); }, "mcp-agent")); return result({ tableId, recordId, deleted: true });
  });

  server.registerTool("add_database_record", {
    description: "Add one record directly to a database definition, even when it has no canvas view.",
    inputSchema: z.object({ databaseId: z.string().min(1), values: z.record(z.string(), z.string()) }),
  }, async ({ databaseId, values }) => {
    await authorize("add_database_record");
    const { records } = databaseDefinition(databaseId);
    const recordId = randomUUID(); const record = new Y.Map();
    Object.entries(values).forEach(([key, value]) => { if (key !== UPDATED_AT_FIELD_ID) record.set(key, value); });
    record.set(UPDATED_AT_FIELD_ID, databaseTimestamp());
    document.transact(() => { records.set(recordId, record); recordEvent("add_database_record", `${databaseId}: ${recordId}`); }, "mcp-agent");
    return result({ databaseId, recordId, created: true });
  });

  server.registerTool("update_database_record", {
    description: "Update selected values on one database record without requiring a canvas view.",
    inputSchema: z.object({ databaseId: z.string().min(1), recordId: z.string().min(1), values: z.record(z.string(), z.string()) }),
  }, async ({ databaseId, recordId, values }) => {
    await authorize("update_database_record");
    const { record } = databaseRecord(databaseId, recordId);
    document.transact(() => {
      Object.entries(values).forEach(([key, value]) => { if (key !== UPDATED_AT_FIELD_ID) record.set(key, value); });
      record.set(UPDATED_AT_FIELD_ID, databaseTimestamp());
      recordEvent("update_database_record", `${databaseId}: ${recordId}`);
    }, "mcp-agent");
    return result({ databaseId, recordId, updated: true });
  });

  server.registerTool("delete_database_record", {
    description: "Delete one database record without requiring a canvas view.",
    inputSchema: z.object({ databaseId: z.string().min(1), recordId: z.string().min(1) }),
    annotations: { destructiveHint: true },
  }, async ({ databaseId, recordId }) => {
    await authorize("delete_database_record");
    const { records } = databaseRecord(databaseId, recordId);
    document.transact(() => { records.delete(recordId); recordEvent("delete_database_record", `${databaseId}: ${recordId}`); }, "mcp-agent");
    return result({ databaseId, recordId, deleted: true });
  });

  server.registerTool("set_table_view", {
    description: "Switch a database view between table, kanban, Gantt, and calendar without copying its records.",
    inputSchema: z.object({ tableId: z.string(), view: z.enum(["table", "kanban", "gantt", "calendar"]) }),
  }, async ({ tableId, view }) => {
    await authorize("set_table_view"); const item = nodes.get(tableId);
    if (!item || item.get("kind") !== "database") throw new Error(`データベース ${tableId} は存在しません。`);
    const definition = databases.get(String(item.get("databaseId") ?? "")); const fields = definition?.get("fields");
    if (!(fields instanceof Y.Array)) throw new Error(`表示オブジェクト ${tableId} はデータベースに接続されていません。`);
    if (view === "kanban" && !fields.toArray().some((field) => field.get("type") === "status" && Array.isArray(field.get("options")) && field.get("options").length > 0)) throw new Error("看板表示には選択肢のあるステータス列が必要です。");
    if (view === "gantt" && fields.toArray().filter((field) => field.get("type") === "date").length < 2) throw new Error("ガント表示には日付列が2列必要です。");
    if (view === "calendar" && !fields.toArray().some((field) => field.get("type") === "date")) throw new Error("カレンダー表示には日付列が必要です。");
    await whileEditing(tableId, () => document.transact(() => { item.set("databaseView", view); recordEvent("set_table_view", `${tableId}: ${view}`); }, "mcp-agent"));
    return result({ tableId, view, updated: true });
  });

  server.registerTool("update_database_view", {
    description: "Update view-specific settings for a table, kanban, Gantt, or calendar view object.",
    inputSchema: z.object({ tableId: z.string(), view: z.enum(["table", "kanban", "gantt", "calendar"]).optional(), tableVisibleFieldIds: z.array(z.string()).optional(), tableRowHeight: z.number().int().min(28).max(160).optional(), kanbanGroupFieldId: z.string().optional(), ganttStartFieldId: z.string().optional(), ganttEndFieldId: z.string().optional(), ganttScale: z.enum(["day", "week", "month"]).optional(), ganttRangeMode: z.enum(["auto", "fixed", "relative"]).optional(), ganttFixedStart: z.string().optional(), ganttFixedEnd: z.string().optional(), ganttRelativeUnit: z.enum(["week", "month"]).optional(), ganttRelativeBefore: z.number().int().min(0).max(24).optional(), ganttRelativeAfter: z.number().int().min(0).max(24).optional(), calendarDateFieldId: z.string().optional(), calendarShowHolidays: z.boolean().optional(), calendarWeekStart: z.enum(["sunday", "monday"]).optional(), calendarScrollDirection: z.enum(["vertical", "horizontal"]).optional(), calendarRangeMode: z.enum(["fixed", "relative"]).optional(), calendarFixedStart: z.string().optional(), calendarFixedEnd: z.string().optional(), calendarRelativeBefore: z.number().int().min(0).max(24).optional(), calendarRelativeAfter: z.number().int().min(0).max(24).optional() }),
  }, async ({ tableId, view, ...settings }) => {
    await authorize("update_database_view"); const item = nodes.get(tableId); if (!item || item.get("kind") !== "database") throw new Error(`表示オブジェクト ${tableId} は存在しません。`);
    await whileEditing(tableId, () => document.transact(() => { if (view !== undefined) item.set("databaseView", view); Object.entries(settings).forEach(([key, value]) => { if (value !== undefined) item.set(key, value); }); recordEvent("update_database_view", `${tableId}: ${view ?? "表示設定"}`); }, "mcp-agent")); return result({ tableId, updated: true });
  });

  server.registerTool("update_database_query", {
    description: "Replace shared sort and filter settings for one database.",
    inputSchema: z.object({ databaseId: z.string(), sortFieldId: z.string().default(""), sortDirection: z.enum(["asc", "desc"]).default("asc"), filters: z.array(filterSchema).default([]) }),
  }, async ({ databaseId, sortFieldId, sortDirection, filters }) => {
    await authorize("update_database_query"); const definition = databases.get(databaseId); const fields = definition?.get("fields"); if (!definition || !(fields instanceof Y.Array)) throw new Error(`データベース ${databaseId} は存在しません。`);
    const fieldIds = new Set(fields.toArray().map((field) => String(field.get("id")))); if (sortFieldId && !fieldIds.has(sortFieldId)) throw new Error(`並び替え列 ${sortFieldId} は存在しません。`); filters.forEach((filter) => { if (!fieldIds.has(filter.fieldId)) throw new Error(`フィルター列 ${filter.fieldId} は存在しません。`); });
    document.transact(() => { definition.set("sortFieldId", sortFieldId); definition.set("sortDirection", sortDirection); definition.set("filters", filters); recordEvent("update_database_query", databaseId); }, "mcp-agent"); return result({ databaseId, updated: true });
  });

  return server;
}

serveStdio(createServer);
console.error(`れんらくがかり MCP server: ${room} @ ${url}`);

process.on("SIGINT", () => { provider.destroy(); document.destroy(); process.exit(0); });
process.on("SIGTERM", () => { provider.destroy(); document.destroy(); process.exit(0); });
