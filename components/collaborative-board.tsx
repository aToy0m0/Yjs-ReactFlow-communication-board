"use client";

import {
  applyEdgeChanges, applyNodeChanges, Background, BackgroundVariant, Connection, ConnectionLineType, ConnectionMode,
  Edge, EdgeChange, EdgeTypes, MarkerType, MiniMap, Node, NodeChange, NodeTypes, ReactFlow, ReactFlowInstance,
} from "@xyflow/react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Bot, ChevronDown, CircleHelp, Copy, Diamond,
  Database, Download, Eraser, FileStack, Focus, ImagePlus, KanbanSquare, LayoutTemplate, Link2, Lock, MessageCircle, Minus, MousePointer2,
  CheckSquare2, Eye, EyeOff, GripVertical, KeyRound, LogOut, Menu, MoreHorizontal, PenLine, Pencil, Plus, Redo2, RefreshCw, Search, Settings2, Share2, ShieldCheck, Sparkles, Square, StickyNote, Table2, Timer, Trash2, Type, Undo2, UserCog,
  Send, TextAlignCenter, TextAlignEnd, TextAlignStart, Unlock, Upload, Users, X,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import BoardNode, { BoardItemKind, BoardNodeData, type DatabaseField } from "./board-node";
import UiSelect from "./ui-select";
import NumericStepper from "./numeric-stepper";
import BoardEdge from "./board-edge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { currentDatabaseTimestamp, normalizeDateValue, type DateDisplayFormat } from "@/lib/mini-database-date";

type BoardNodeType = Node<BoardNodeData>;
type Workspace = {
  doc: Y.Doc; provider: HocuspocusProvider; nodesMap: Y.Map<Y.Map<unknown>>;
  databasesMap: Y.Map<Y.Map<unknown>>;
  edgesMap: Y.Map<Y.Map<unknown>>; commentsMap: Y.Map<Y.Map<unknown>>; meta: Y.Map<string>;
  events: Y.Array<Y.Map<unknown>>; permissionsMap: Y.Map<string>; undoManager: Y.UndoManager;
};
type PresenceState = { clientId: number; user?: { name: string; address?: string; color: string; type?: "human" | "agent"; agentName?: string; ownerName?: string }; cursor?: { x: number; y: number } | null; editing?: EditingState };
type BoardComment = { id: string; nodeId: string; text: string; author: string; createdAt: string; resolved: boolean };
type AgentEvent = {
  id: string; action: string; summary: string; createdAt: string;
  ownerName: string | null; agentName: string | null; agentId: string | null; agentColor: string | null;
};
type EditingState = { nodeId: string; user: { name: string; color: string } };
type ManagedDatabase = {
  id: string; name: string; view: string; sortOrder: number;
  fields: DatabaseField[];
  records: Array<{ id: string; values: Record<string, string> }>;
};
type McpPermission = "always_allow" | "require_approval" | "deny";
type SerializedYValue =
  | { type: "text"; value: string }
  | { type: "map"; entries: Array<[string, SerializedYValue]> }
  | { type: "array"; values: SerializedYValue[] }
  | { type: "json"; value: unknown };
type SerializedYMap = Array<[string, SerializedYValue]>;
type BoardClipboard = {
  nodes: Array<{ sourceId: string; entries: SerializedYMap }>;
  edges: Array<{ sourceId: string; entries: SerializedYMap }>;
};

const safeBoardId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const UPDATED_AT_FIELD_ID = "__updatedAt";

async function collaborationToken() {
  const response = await fetch("/api/auth/collaboration-token", { method: "POST", cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.token !== "string") throw new Error(String(body.error ?? "共同編集の認証情報を取得できませんでした。"));
  return body.token;
}

function setDatabaseFieldDragImage(event: React.DragEvent<HTMLButtonElement>, row: HTMLElement | null, count: number) {
  if (count === 1 && row) {
    event.dataTransfer.setDragImage(row, 18, row.offsetHeight / 2);
    return;
  }
  const preview = document.createElement("div");
  preview.className = "schema-field-drag-preview";
  preview.textContent = `${count}列を移動`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 18, 18);
  window.setTimeout(() => preview.remove(), 0);
}

function boardIdFromReference(value: string) {
  const normalized = value.trim();
  if (safeBoardId.test(normalized)) return normalized;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new Error("ボードIDまたは共有URLを入力してください。"); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("共有URLはhttpまたはhttpsで入力してください。");
  const boardId = parsed.searchParams.get("room")?.trim() || "product-discovery";
  if (!safeBoardId.test(boardId)) throw new Error("共有URLに含まれるボードIDが不正です。");
  return boardId;
}

const mcpTools = [
  { name: "get_board_snapshot", label: "ボード全体を参照", access: "read" },
  { name: "get_timer", label: "共有タイマーを参照", access: "read" },
  { name: "list_mini_databases", label: "データベース一覧を参照", access: "read" },
  { name: "get_mini_database", label: "データベース詳細を参照", access: "read" },
  { name: "render_board_svg", label: "ボード全体を画像で参照", access: "read" },
  { name: "create_item", label: "オブジェクトを作成", access: "write" },
  { name: "update_item", label: "オブジェクトを更新", access: "write" },
  { name: "delete_item", label: "オブジェクトを削除", access: "write" },
  { name: "connect_items", label: "オブジェクトを接続", access: "write" },
  { name: "update_connector", label: "接続線を更新", access: "write" },
  { name: "delete_connector", label: "接続線を削除", access: "write" },
  { name: "add_comment", label: "コメントを追加", access: "write" },
  { name: "resolve_comment", label: "コメントの解決状態を更新", access: "write" },
  { name: "delete_comment", label: "コメントを削除", access: "write" },
  { name: "add_reaction", label: "リアクションを追加", access: "write" },
  { name: "set_board_title", label: "ボード名を変更", access: "write" },
  { name: "set_timer", label: "共有タイマーを設定", access: "write" },
  { name: "apply_template", label: "テンプレートを配置", access: "write" },
  { name: "create_mini_database", label: "データベースを作成", access: "write" },
  { name: "rename_database", label: "データベース名を変更", access: "write" },
  { name: "reorder_databases", label: "データベースを並び替え", access: "write" },
  { name: "update_mini_database_schema", label: "データベース設定を変更", access: "write" },
  { name: "add_database_field", label: "列を追加", access: "write" },
  { name: "update_database_field", label: "列設定を変更", access: "write" },
  { name: "delete_database_fields", label: "列を削除", access: "write" },
  { name: "reorder_database_fields", label: "列を並び替え", access: "write" },
  { name: "delete_mini_database", label: "データベースを削除", access: "write" },
  { name: "create_table", label: "データベースと表示を作成", access: "write" },
  { name: "create_database_view", label: "既存データベースの表示を作成", access: "write" },
  { name: "connect_database_view", label: "表示とデータベースを接続", access: "write" },
  { name: "add_table_record", label: "レコードを追加", access: "write" },
  { name: "update_table_record", label: "レコードを更新", access: "write" },
  { name: "delete_table_record", label: "レコードを削除", access: "write" },
  { name: "add_database_record", label: "データベースへレコードを追加", access: "write" },
  { name: "update_database_record", label: "データベースのレコードを更新", access: "write" },
  { name: "delete_database_record", label: "データベースのレコードを削除", access: "write" },
  { name: "set_table_view", label: "表示形式を変更", access: "write" },
  { name: "update_database_view", label: "データベース表示設定を更新", access: "write" },
  { name: "update_database_query", label: "ソート・フィルターを更新", access: "write" },
] as const;

const palette = ["#ffd972", "#ffb6a3", "#b9f5d8", "#bde7ff", "#d9ccff", "#ffffff"];
const DEFAULT_STATUS_OPTIONS = ["未着手", "進行中", "完了"];
const DEFAULT_STATUS_OPTION_COLORS: Record<string, string> = { "進行中": "#bde7ff", "完了": "#b9f5d8" };
const inkPalette = ["#2f2937", "#6c4df6", "#ef4444", "#0ea5e9", "#16a34a", "#f59e0b"];
const DEFAULT_EDGE_COLOR = "#2f2937";
const LEGACY_EDGE_COLOR = "#858092";
const linePalette = [DEFAULT_EDGE_COLOR, "#5e5868", "#ef4444", "#16a34a", "#0ea5e9", "#6c4df6"];
const edgeMarkerOptions = [
  { value: "none", label: "なし" },
  { value: "open", label: "開く" },
  { value: "arrow", label: "塗り" },
] as const;
const userColors = ["#ff7a59", "#8b5cf6", "#0ea5e9", "#10b981", "#ec4899", "#f59e0b"];
const nodeTypes: NodeTypes = { boardItem: BoardNode };
const edgeTypes: EdgeTypes = { boardEdge: BoardEdge };
const localOrigin = Symbol("local-board-change");
const migrationOrigin = Symbol("schema-migration");

function uniqueOptions(value: string) {
  return Array.from(new Set(value.split("\n").map((option) => option.trim()).filter(Boolean)));
}

function displayEdgeColor(value: unknown) {
  const color = String(value ?? "");
  return !color || color.toLowerCase() === LEGACY_EDGE_COLOR ? DEFAULT_EDGE_COLOR : color;
}

function EdgeMarkerPreview({ marker }: { marker: (typeof edgeMarkerOptions)[number]["value"] }) {
  return <svg className="marker-preview" viewBox="0 0 38 16" aria-hidden="true" focusable="false">
    {marker === "none" && <path d="M3 8H35" />}
    {marker === "open" && <><path d="M3 8H33" /><path d="m27 2 7 6-7 6" /></>}
    {marker === "arrow" && <><path d="M3 8H28" /><path className="marker-preview__fill" d="m26 2 9 6-9 6Z" /></>}
  </svg>;
}

function serializeYValue(value: unknown): SerializedYValue {
  if (value instanceof Y.Text) return { type: "text", value: value.toString() };
  if (value instanceof Y.Map) return { type: "map", entries: Array.from(value.entries()).map(([key, entry]) => [key, serializeYValue(entry)]) };
  if (value instanceof Y.Array) return { type: "array", values: value.toArray().map(serializeYValue) };
  if (value instanceof Y.AbstractType) throw new Error("未対応のYjsデータ形式が含まれているためコピーできません。");
  return { type: "json", value: typeof value === "object" && value !== null ? structuredClone(value) : value };
}

function deserializeYValue(value: SerializedYValue): unknown {
  if (value.type === "text") { const text = new Y.Text(); text.insert(0, value.value); return text; }
  if (value.type === "map") { const map = new Y.Map<unknown>(); value.entries.forEach(([key, entry]) => map.set(key, deserializeYValue(entry))); return map; }
  if (value.type === "array") { const array = new Y.Array<unknown>(); array.push(value.values.map(deserializeYValue)); return array; }
  return typeof value.value === "object" && value.value !== null ? structuredClone(value.value) : value.value;
}

function serializeYMap(map: Y.Map<unknown>): SerializedYMap {
  return Array.from(map.entries()).map(([key, value]) => [key, serializeYValue(value)]);
}

function deserializeYMap(entries: SerializedYMap) {
  const map = new Y.Map<unknown>();
  entries.forEach(([key, value]) => map.set(key, deserializeYValue(value)));
  return map;
}

function serializedMapValue(entries: SerializedYMap, key: string) {
  const entry = entries.find(([entryKey]) => entryKey === key)?.[1];
  if (!entry) return undefined;
  if (entry.type !== "json") throw new Error(`コピー対象の${key}は数値または文字列である必要があります。`);
  return entry.value;
}

function userColor(address: string) {
  let hash = 0;
  for (const character of address) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return userColors[hash % userColors.length];
}

function createYNode(id: string, kind: BoardItemKind, text: string, color: string, x: number, y: number) {
  const node = new Y.Map<unknown>();
  const yText = new Y.Text();
  yText.insert(0, text);
  Object.entries({
    id, kind, color, x, y, shape: "rectangle", status: "todo", locked: false,
    fontSize: kind === "text" ? 22 : 16,
    textAlign: kind === "shape" ? "center" : "left",
    verticalAlign: kind === "shape" ? "middle" : "top",
    drawingPath: "", drawingStrokeWidth: 4, drawingBrush: "pen", frameRows: 0, frameColumns: 0, frameGridColor: "#8f899b", frameImage: "", frameImageFit: "stretch",
    lineStartX: 0, lineStartY: 500, lineEndX: 1000, lineEndY: 500, lineStrokeWidth: 3, lineDashed: false, linkTitle: "",
  })
    .forEach(([key, value]) => node.set(key, value));
  node.set("text", yText);
  node.set("reactions", new Y.Map<number>());
  if (kind === "database") {
    node.set("databaseId", ""); node.set("databaseView", "table");
    node.set("tableVisibleFieldIds", []); node.set("tableColumnWidths", {}); node.set("tableRowHeight", 44);
    node.set("kanbanGroupFieldId", "");
    node.set("ganttStartFieldId", "");
    node.set("ganttEndFieldId", "");
    node.set("ganttScale", "week");
    node.set("ganttRangeMode", "auto");
    node.set("ganttFixedStart", isoDate(-30));
    node.set("ganttFixedEnd", isoDate(90));
    node.set("ganttRelativeUnit", "month");
    node.set("ganttRelativeBefore", 2);
    node.set("ganttRelativeAfter", 1);
    node.set("calendarDateFieldId", "");
    node.set("calendarShowHolidays", true);
    node.set("calendarWeekStart", "monday");
    node.set("calendarScrollDirection", "vertical");
    node.set("calendarRangeMode", "relative");
    node.set("calendarFixedStart", isoDate(-30)); node.set("calendarFixedEnd", isoDate(90));
    node.set("calendarRelativeBefore", 0); node.set("calendarRelativeAfter", 2);
  }
  return node;
}

function makeDatabaseField(id: string, name: string, type: string, options: string[] = [], dateFormat: DateDisplayFormat = "date", system?: "updatedAt", optionColors: Record<string, string> = type === "status" ? DEFAULT_STATUS_OPTION_COLORS : {}, tableVisible = system !== "updatedAt") {
  const field = new Y.Map<unknown>(); Object.entries({ id, name, type, options, optionColors: { ...optionColors }, tableVisible, dateFormat }).forEach(([key, value]) => field.set(key, value));
  if (type === "status") field.set("statusColorPresetVersion", 1);
  if (system) field.set("system", system);
  return field;
}

function databaseFieldState(field: Y.Map<unknown>): DatabaseField {
  const type = String(field.get("type")) as DatabaseField["type"];
  const savedColors = field.get("optionColors");
  const optionColors = savedColors && typeof savedColors === "object" && !Array.isArray(savedColors)
    ? Object.fromEntries(Object.entries(savedColors).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return {
    id: String(field.get("id")), name: String(field.get("name")), type,
    options: Array.isArray(field.get("options")) ? field.get("options") as string[] : [],
    optionColors: savedColors && typeof savedColors === "object" && !Array.isArray(savedColors) ? optionColors : type === "status" ? { ...DEFAULT_STATUS_OPTION_COLORS } : {},
    tableVisible: field.has("tableVisible") ? Boolean(field.get("tableVisible")) : field.get("system") !== "updatedAt",
    dateFormat: (field.get("dateFormat") ?? "date") as DateDisplayFormat,
    system: field.get("system") as "updatedAt" | undefined,
  };
}

function cloneDatabaseField(field: Y.Map<unknown>) {
  const clone = new Y.Map<unknown>();
  field.forEach((value, key) => clone.set(key, value));
  return clone;
}

function isoDate(offsetDays = 0) {
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + offsetDays); return date.toISOString().slice(0, 10);
}

function makeDatabaseDefinition(id: string, name = "新しいデータベース", sortOrder = 0) {
  const database = new Y.Map<unknown>();
  const fields = new Y.Array<Y.Map<unknown>>();
  fields.push([
    makeDatabaseField("title", "タスク", "text"),
    makeDatabaseField("status", "状態", "status", DEFAULT_STATUS_OPTIONS),
    makeDatabaseField("owner", "担当者", "person"),
    makeDatabaseField("startDate", "開始日", "date"),
    makeDatabaseField("endDate", "終了日", "date"),
    makeDatabaseField(UPDATED_AT_FIELD_ID, "更新日時", "date", [], "datetime", "updatedAt"),
  ]);
  Object.entries({ id, name, sortOrder, filters: [], sortFieldId: "", sortDirection: "asc" }).forEach(([key, value]) => database.set(key, value));
  database.set("fields", fields); database.set("records", new Y.Map<Y.Map<unknown>>());
  return database;
}

function databaseState(databasesMap: Y.Map<Y.Map<unknown>>): ManagedDatabase[] {
  return Array.from(databasesMap.entries()).map(([id, database], legacyIndex) => {
    const fields = database.get("fields"); const records = database.get("records");
    if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error(`データベース ${id} の形式が不正です。`);
    const savedSortOrder = Number(database.get("sortOrder"));
    return {
      id, name: String(database.get("name") ?? "名称未設定"), view: "table", sortOrder: Number.isFinite(savedSortOrder) ? savedSortOrder : legacyIndex,
      fields: fields.toArray().map(databaseFieldState),
      records: Array.from(records.entries()).map(([recordId, record]) => ({ id: recordId, values: Object.fromEntries(record.entries()) as Record<string, string> })),
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function itemSize(kind: BoardItemKind) {
  if (kind === "database") return { width: 780, height: 400 };
  if (kind === "frame") return { width: 620, height: 400 };
  if (kind === "card") return { width: 260, height: 170 };
  if (kind === "text") return { width: 240, height: 72 };
  if (kind === "link") return { width: 320, height: 84 };
  if (kind === "line") return { width: 260, height: 100 };
  if (kind === "drawing") return { width: 240, height: 160 };
  return { width: 220, height: kind === "shape" ? 140 : 156 };
}

function isFinitePoint(point: { x: number; y: number } | null | undefined): point is { x: number; y: number } {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function requireFiniteNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}が不正なためコピーできません。`);
  return number;
}

function requireFinitePoint(point: { x: number; y: number }, label: string) {
  if (!isFinitePoint(point)) throw new Error(`${label}を計算できないためコピーできません。`);
  return point;
}

function DeleteConfirmationDialog({ open, itemName, error = "", onOpenChange, onConfirm }: { open: boolean; itemName: string; error?: string; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>本当に削除してよろしいですか？</AlertDialogTitle><AlertDialogDescription>「{itemName}」を削除します。この操作は取り消せません。</AlertDialogDescription></AlertDialogHeader>{error && <p className="board-delete-error">{error}</p>}<AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><Button variant="destructive" className="delete-confirmation__confirm" onClick={onConfirm}>削除する</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

export function CollaborativeBoard({ user }: { user: { address: string; displayName: string; isAdmin: boolean } }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [nodes, setNodes] = useState<BoardNodeType[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentOwnerFilter, setAgentOwnerFilter] = useState("all");
  const [title, setTitle] = useState("Product discovery workshop");
  const [status, setStatus] = useState("connecting");
  const [synced, setSynced] = useState(false);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [remoteEditors, setRemoteEditors] = useState<Record<string, { name: string; color: string }>>({});
  const [flow, setFlow] = useState<ReactFlowInstance<BoardNodeType, Edge> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const selectedEdgeIdsRef = useRef<string[]>([]);
  const controlSelectionBaseRef = useRef<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [rightPanel, setRightPanel] = useState<"comments" | "agent" | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentComposerTargetId, setCommentComposerTargetId] = useState<string | null>(null);
  const [commentActionMenuId, setCommentActionMenuId] = useState<string | null>(null);
  const [commentDeleteDialog, setCommentDeleteDialog] = useState<{ id: string; author: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [timerEnd, setTimerEnd] = useState(0);
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerRunId, setTimerRunId] = useState("");
  const [timerNoticeId, setTimerNoticeId] = useState("");
  const [timerNoticeReason, setTimerNoticeReason] = useState<"stopped" | "">("");
  const [dismissedTimerNoticeIds, setDismissedTimerNoticeIds] = useState<string[]>([]);
  const [timerHasElapsed, setTimerHasElapsed] = useState(false);
  const [timerMenuOpen, setTimerMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectionHintVisible, setSelectionHintVisible] = useState(true);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [room, setRoom] = useState(() => typeof window === "undefined" ? "product-discovery" : new URLSearchParams(window.location.search).get("room")?.trim() || "product-discovery");
  const [dataManagerOpen, setDataManagerOpen] = useState(false);
  const [managedDatabases, setManagedDatabases] = useState<ManagedDatabase[]>([]);
  const [dataManagerLoading, setDataManagerLoading] = useState(false);
  const [dataManagerError, setDataManagerError] = useState("");
  const [openManagedDatabaseIds, setOpenManagedDatabaseIds] = useState<string[]>([]);
  const [databaseDeleteDialog, setDatabaseDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [databaseActionMenuId, setDatabaseActionMenuId] = useState<string | null>(null);
  const [importDatabaseId, setImportDatabaseId] = useState("");
  const [fieldOptionsEditor, setFieldOptionsEditor] = useState<{ databaseId: string; fieldId: string; fieldName: string; value: string; optionColors: Record<string, string>; activeOption: string | null } | null>(null);
  const [fieldDeleteDialog, setFieldDeleteDialog] = useState<{ databaseId: string; fieldIds: string[]; itemName: string } | null>(null);
  const [fieldActionMenuId, setFieldActionMenuId] = useState<string | null>(null);
  const [fieldSelectionModeDatabaseId, setFieldSelectionModeDatabaseId] = useState<string | null>(null);
  const [selectedDatabaseFieldIds, setSelectedDatabaseFieldIds] = useState<string[]>([]);
  const [draggedDatabaseField, setDraggedDatabaseField] = useState<{ databaseId: string; fieldIds: string[]; targetId?: string; position?: "before" | "after" } | null>(null);
  const [draggedManagedDatabase, setDraggedManagedDatabase] = useState<{ id: string; insertionIndex?: number } | null>(null);
  const [mcpPermissions, setMcpPermissions] = useState<Record<string, McpPermission>>({});
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [boardTitles, setBoardTitles] = useState<Record<string, string>>({});
  const [boardActionMenuId, setBoardActionMenuId] = useState<string | null>(null);
  const [boardDeleteCandidate, setBoardDeleteCandidate] = useState<string | null>(null);
  const [boardRenameDialog, setBoardRenameDialog] = useState<{ boardId: string; value: string } | null>(null);
  const [boardDeleteError, setBoardDeleteError] = useState("");
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [toolMode, setToolMode] = useState<"select" | "pen" | "eraser">("select");
  const [penColor, setPenColor] = useState("#2f2937");
  const [penWidth, setPenWidth] = useState(4);
  const [penBrush, setPenBrush] = useState<"pen" | "marker" | "highlighter">("pen");
  const [spaceSelecting, setSpaceSelecting] = useState(false);
  const [selectionToolActive, setSelectionToolActive] = useState(false);
  const [fullscreenDatabaseId, setFullscreenDatabaseId] = useState<string | null>(null);
  const [databaseQuerySheet, setDatabaseQuerySheet] = useState<{ nodeId: string; height: number } | null>(null);
  const [draftDrawing, setDraftDrawing] = useState<Array<{ x: number; y: number }>>([]);
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [lineMenu, setLineMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeLabelEditor, setEdgeLabelEditor] = useState<{ edgeId: string; value: string } | null>(null);
  const [nodeSettingsOpen, setNodeSettingsOpen] = useState(false);
  const [commentsVisible, setCommentsVisible] = useState(true);
  const [knownBoards, setKnownBoards] = useState<string[]>(() => {
    if (typeof window === "undefined") return [room];
    const stored = JSON.parse(window.localStorage.getItem("mingleboard:boards") ?? "[]") as unknown;
    if (!Array.isArray(stored) || stored.some((value) => typeof value !== "string")) throw new Error("保存済みボード一覧の形式が不正です。");
    return Array.from(new Set([room, ...stored]));
  });
  const [newBoardId, setNewBoardId] = useState("");
  const [boardJoinValue, setBoardJoinValue] = useState("");
  const [boardImportId, setBoardImportId] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
  const boardImportInputRef = useRef<HTMLInputElement>(null);
  const frameImageInputRef = useRef<HTMLInputElement>(null);
  const cursorFrameRef = useRef<number | null>(null);
  const resizingIdsRef = useRef(new Set<string>());
  const pendingCursorRef = useRef<{ x: number; y: number } | null>(null);
  const lastCanvasPointerRef = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLElement>(null);
  const leftToolsRef = useRef<HTMLElement>(null);
  const [toolScrollIndicator, setToolScrollIndicator] = useState<{
    visible: boolean;
    axis: "vertical" | "horizontal";
    offset: number;
    length: number;
  }>({ visible: false, axis: "vertical", offset: 0, length: 0 });
  const edgeMenuRef = useRef<HTMLDivElement>(null);
  const lineMenuRef = useRef<HTMLDivElement>(null);
  const nodeSettingsRef = useRef<HTMLDivElement>(null);
  const nodeSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const dragOriginsRef = useRef(new Map<string, { x: number; y: number }>());
  const dragAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const shiftPressedRef = useRef(false);
  const editorSignatureRef = useRef("");
  const boardClipboardRef = useRef<BoardClipboard | null>(null);
  const objectPastePendingRef = useRef(false);
  const currentUser = useMemo(() => ({ name: user.displayName, address: user.address, color: userColor(user.address), type: "human" as const }), [user.address, user.displayName]);
  const collaborationUiSuppressed = Boolean(fullscreenDatabaseId || dataManagerOpen);
  const updateDatabaseQuerySheet = useCallback((nodeId: string, open: boolean, height: number) => {
    setDatabaseQuerySheet((current) => {
      if (!open) return current?.nodeId === nodeId ? null : current;
      if (current?.nodeId === nodeId && current.height === height) return current;
      return { nodeId, height };
    });
  }, []);

  useEffect(() => {
    const doc = new Y.Doc();
    const nodesMap = doc.getMap<Y.Map<unknown>>("nodes");
    const databasesMap = doc.getMap<Y.Map<unknown>>("miniDatabases");
    const edgesMap = doc.getMap<Y.Map<unknown>>("edges");
    const commentsMap = doc.getMap<Y.Map<unknown>>("comments");
    const meta = doc.getMap<string>("meta");
    const events = doc.getArray<Y.Map<unknown>>("agentEvents");
    const permissionsMap = doc.getMap<string>("mcpPermissions");
    const undoManager = new Y.UndoManager([nodesMap, databasesMap, edgesMap, commentsMap, meta, permissionsMap], {
      trackedOrigins: new Set([localOrigin]),
      captureTimeout: 60_000,
    });
    const provider = new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234", name: room, document: doc,
      token: collaborationToken,
      onStatus: ({ status: nextStatus }) => setStatus(nextStatus), onSynced: () => setSynced(true),
      onAwarenessUpdate: ({ states }) => {
        const nextPresence = states as PresenceState[];
        setPresence(nextPresence);
        const editors = Object.fromEntries(nextPresence
          .filter((state) => state.clientId !== doc.clientID && state.editing?.nodeId && state.editing.user)
          .map((state) => [state.editing!.nodeId, state.editing!.user]));
        const signature = JSON.stringify(editors);
        if (signature !== editorSignatureRef.current) { editorSignatureRef.current = signature; setRemoteEditors(editors); }
      },
    });
    provider.setAwarenessField("user", currentUser);
    provider.setAwarenessField("cursor", null);
    // Collaboration objects are browser-only and become render state after setup.
    setWorkspace({ doc, provider, nodesMap, databasesMap, edgesMap, commentsMap, meta, events, permissionsMap, undoManager });
    return () => { if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current); provider.destroy(); undoManager.destroy(); doc.destroy(); };
  }, [currentUser, room]);

  useEffect(() => {
    if (!workspace || !flow) return;
    lastCanvasPointerRef.current = null;
    if (collaborationUiSuppressed) {
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null; pendingCursorRef.current = null;
      workspace.provider.setAwarenessField("cursor", null);
      workspace.provider.setAwarenessField("editing", null);
      return;
    }
    const clearCursor = () => {
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
      if (pendingCursorRef.current === null) return;
      pendingCursorRef.current = null;
      workspace.provider.setAwarenessField("cursor", null);
    };
    const trackPointer = (event: PointerEvent) => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds || event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        clearCursor();
        return;
      }
      const cursor = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      if (!isFinitePoint(cursor)) {
        lastCanvasPointerRef.current = null;
        clearCursor();
        return;
      }
      pendingCursorRef.current = cursor;
      lastCanvasPointerRef.current = cursor;
      if (cursorFrameRef.current !== null) return;
      cursorFrameRef.current = requestAnimationFrame(() => {
        workspace.provider.setAwarenessField("cursor", pendingCursorRef.current);
        cursorFrameRef.current = null;
      });
    };
    window.addEventListener("pointermove", trackPointer, true);
    window.addEventListener("blur", clearCursor);
    return () => {
      window.removeEventListener("pointermove", trackPointer, true);
      window.removeEventListener("blur", clearCursor);
      if (cursorFrameRef.current !== null) cancelAnimationFrame(cursorFrameRef.current);
      cursorFrameRef.current = null;
    };
  }, [collaborationUiSuppressed, flow, workspace]);

  useEffect(() => {
    window.localStorage.setItem("mingleboard:boards", JSON.stringify(knownBoards));
  }, [knownBoards]);

  useEffect(() => {
    let cancelled = false;
    const loadBoardTitles = async () => {
      const entries = await Promise.all(knownBoards.map(async (boardId) => {
        const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
        if (response.status === 404) return [boardId, "新しいボード"] as const;
        const payload = await response.json() as { title?: unknown; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `${boardId}のボード名を取得できませんでした。`);
        if (typeof payload.title !== "string" || !payload.title.trim()) throw new Error(`${boardId}のボード名が不正です。`);
        return [boardId, payload.title] as const;
      }));
      if (!cancelled) setBoardTitles(Object.fromEntries(entries));
    };
    void loadBoardTitles().catch((error) => { if (!cancelled) setBoardDeleteError(error instanceof Error ? error.message : "ボード名を取得できませんでした。"); });
    return () => { cancelled = true; };
  }, [knownBoards, room]);

  useEffect(() => {
    if (!edgeMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element) || !edgeMenuRef.current?.contains(event.target)) setEdgeMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [edgeMenu]);

  useEffect(() => {
    if (!lineMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element) || !lineMenuRef.current?.contains(event.target)) setLineMenu(null); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [lineMenu]);

  useEffect(() => {
    if (!nodeSettingsOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!nodeSettingsRef.current?.contains(event.target) && !nodeSettingsButtonRef.current?.contains(event.target)) setNodeSettingsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [nodeSettingsOpen]);

  const switchBoard = (boardId: string) => {
    const normalized = boardId.trim();
    if (!safeBoardId.test(normalized)) throw new Error("ボードIDは英数字・ハイフン・アンダースコアの64文字以内で入力してください。");
    const next = Array.from(new Set([normalized, ...knownBoards]));
    window.localStorage.setItem("mingleboard:boards", JSON.stringify(next));
    setKnownBoards(next); setBoardMenuOpen(false); setNewBoardId(""); setBoardJoinValue(""); setRoom(normalized);
    router.push(`/?room=${encodeURIComponent(normalized)}`);
  };

  const joinBoard = (reference: string) => {
    setBoardDeleteError("");
    try { switchBoard(boardIdFromReference(reference)); }
    catch (error) { setBoardDeleteError(error instanceof Error ? error.message : "ボードへ参加できませんでした。"); }
  };

  const deleteBoard = async (boardId: string) => {
    setBoardDeleteError("");
    if (boardId === room) workspace?.provider.destroy();
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      const body = await response.json() as { error?: string };
      setBoardDeleteError(body.error ?? "ボードを削除できませんでした。");
      return;
    }
    const remaining = knownBoards.filter((entry) => entry !== boardId);
    const nextBoard = remaining[0] ?? "new-board";
    const nextBoards = remaining.length > 0 ? remaining : [nextBoard];
    window.localStorage.setItem("mingleboard:boards", JSON.stringify(nextBoards));
    setKnownBoards(nextBoards); setBoardTitles((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== boardId))); setBoardDeleteCandidate(null); setBoardActionMenuId(null);
    if (boardId === room) { setBoardMenuOpen(false); setRoom(nextBoard); router.push(`/?room=${encodeURIComponent(nextBoard)}`); }
  };

  const setMcpPermission = (toolName: string, permission: McpPermission) => {
    if (!workspace) return;
    workspace.doc.transact(() => workspace.permissionsMap.set(toolName, permission), localOrigin);
  };

  const setMcpPermissionGroup = (access: "read" | "write", permission: McpPermission) => {
    if (!workspace) return;
    workspace.doc.transact(() => mcpTools.filter((tool) => tool.access === access).forEach((tool) => workspace.permissionsMap.set(tool.name, permission)), localOrigin);
  };

  useEffect(() => {
    const expectedTitle = `${title || "無題のボード"} | renraku.gakari`;
    const synchronizeTitle = () => {
      if (document.title !== expectedTitle) document.title = expectedTitle;
    };
    synchronizeTitle();
    const observer = new MutationObserver(synchronizeTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  useEffect(() => {
    const element = leftToolsRef.current;
    if (!element) return;
    const update = () => {
      const horizontal = element.scrollWidth > element.clientWidth + 1;
      const vertical = element.scrollHeight > element.clientHeight + 1;
      if (!horizontal && !vertical) {
        setToolScrollIndicator({ visible: false, axis: "vertical", offset: 0, length: 0 });
        return;
      }
      const axis = horizontal ? "horizontal" : "vertical";
      const viewport = horizontal ? element.clientWidth : element.clientHeight;
      const content = horizontal ? element.scrollWidth : element.scrollHeight;
      const position = horizontal ? element.scrollLeft : element.scrollTop;
      const length = Math.max(28, viewport * viewport / content);
      const available = Math.max(0, viewport - length);
      const offset = available * position / Math.max(1, content - viewport);
      setToolScrollIndicator({ visible: true, axis, offset, length });
    };
    const observer = new ResizeObserver(update);
    observer.observe(element); Array.from(element.children).forEach((child) => observer.observe(child));
    element.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update); update();
    return () => { observer.disconnect(); element.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [workspace]);

  const loadDataManager = useCallback(() => {
    setDataManagerError(""); setDataManagerLoading(false);
    if (workspace) setManagedDatabases(databaseState(workspace.databasesMap));
  }, [workspace]);

  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !workspace || !importDatabaseId) return;
    setDataManagerError("");
    if (!file.name.toLowerCase().endsWith(".csv") || (file.type && !["text/csv", "application/vnd.ms-excel", "text/plain"].includes(file.type))) {
      setDataManagerError("CSVファイルを選択してください。"); return;
    }
    if (file.size > 1024 * 1024) { setDataManagerError("CSVは1MB以下にしてください。"); return; }
    try {
      const response = await fetch("/api/mini-databases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ boardId: room, databaseId: importDatabaseId, csv: await file.text() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "CSVを取り込めませんでした。");
      const database = workspace.databasesMap.get(importDatabaseId); const records = database?.get("records");
      if (!database || !(records instanceof Y.Map)) throw new Error("現在のボードに対象のデータベースがありません。");
      workspace.doc.transact(() => payload.records.forEach((entry: { values: Record<string, string> }) => {
        const record = new Y.Map<unknown>(); Object.entries(entry.values).forEach(([key, value]) => record.set(key, value)); records.set(crypto.randomUUID(), record);
      }), localOrigin);
      window.setTimeout(loadDataManager, 1400);
    } catch (error) { setDataManagerError(error instanceof Error ? error.message : "CSVを取り込めませんでした。"); }
  };

  const updateText = useCallback((id: string, value: string) => {
    if (!workspace) return;
    const yText = workspace.nodesMap.get(id)?.get("text");
    if (!(yText instanceof Y.Text)) return;
    workspace.doc.transact(() => { yText.delete(0, yText.length); yText.insert(0, value); }, localOrigin);
  }, [workspace]);

  const resizeNode = useCallback((id: string, width: number, height: number, x: number, y: number) => {
    if (!workspace) return; const item = workspace.nodesMap.get(id); if (!item) return;
    if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error("オブジェクトのサイズまたは座標が不正です。");
    workspace.doc.transact(() => { item.set("width", width); item.set("height", height); item.set("x", x); item.set("y", y); }, localOrigin);
    resizingIdsRef.current.delete(id);
  }, [workspace]);
  const startResize = useCallback((id: string) => { resizingIdsRef.current.add(id); }, []);
  const updateLineGeometry = useCallback((id: string, values: { lineStartX: number; lineStartY: number; lineEndX: number; lineEndY: number }) => {
    if (!workspace) return;
    const item = workspace.nodesMap.get(id);
    if (!item || item.get("kind") !== "line") throw new Error(`線オブジェクト ${id} は存在しません。`);
    if (Object.values(values).some((value) => !Number.isFinite(value))) throw new Error("線オブジェクトの端点座標が不正です。");
    const positionX = Number(item.get("x"));
    const positionY = Number(item.get("y"));
    const currentWidth = Number(item.get("width") ?? itemSize("line").width);
    const currentHeight = Number(item.get("height") ?? itemSize("line").height);
    const startX = positionX + currentWidth * values.lineStartX / 1000;
    const startY = positionY + currentHeight * values.lineStartY / 1000;
    const endX = positionX + currentWidth * values.lineEndX / 1000;
    const endY = positionY + currentHeight * values.lineEndY / 1000;
    const width = Math.max(48, Math.abs(endX - startX));
    const height = Math.max(48, Math.abs(endY - startY));
    const x = (startX + endX - width) / 2;
    const y = (startY + endY - height) / 2;
    workspace.doc.transact(() => {
      item.set("x", x); item.set("y", y); item.set("width", width); item.set("height", height);
      item.set("lineStartX", (startX - x) / width * 1000);
      item.set("lineStartY", (startY - y) / height * 1000);
      item.set("lineEndX", (endX - x) / width * 1000);
      item.set("lineEndY", (endY - y) / height * 1000);
    }, localOrigin);
    workspace.undoManager.stopCapturing();
  }, [workspace]);

  const addReaction = useCallback((id: string, emoji: string) => {
    if (!workspace) return;
    const reactions = workspace.nodesMap.get(id)?.get("reactions");
    if (!(reactions instanceof Y.Map)) return;
    workspace.doc.transact(() => reactions.set(emoji, Number(reactions.get(emoji) ?? 0) + 1), localOrigin);
  }, [workspace]);

  const setEditing = useCallback((id: string, editing: boolean) => {
    if (collaborationUiSuppressed) { workspace?.provider.setAwarenessField("editing", null); return; }
    workspace?.provider.setAwarenessField("editing", editing ? { nodeId: id, user: currentUser } : null);
  }, [collaborationUiSuppressed, currentUser, workspace]);

  const connectedDatabase = useCallback((viewId: string) => {
    if (!workspace) return undefined;
    const databaseId = String(workspace.nodesMap.get(viewId)?.get("databaseId") ?? "");
    return databaseId ? workspace.databasesMap.get(databaseId) : undefined;
  }, [workspace]);

  const updateDatabaseCell = useCallback((id: string, recordId: string, fieldId: string, value: string) => {
    if (!workspace) return;
    const records = connectedDatabase(id)?.get("records");
    if (!(records instanceof Y.Map)) throw new Error(`データベース ${id} のレコード形式が不正です。`);
    const record = records.get(recordId);
    if (!(record instanceof Y.Map)) throw new Error(`レコード ${recordId} は存在しません。`);
    workspace.doc.transact(() => { record.set(fieldId, value); record.set(UPDATED_AT_FIELD_ID, currentDatabaseTimestamp()); }, localOrigin);
  }, [connectedDatabase, workspace]);

  const updateDatabaseRecord = useCallback((id: string, recordId: string, values: Record<string, string>) => {
    if (!workspace) return;
    const records = connectedDatabase(id)?.get("records");
    if (!(records instanceof Y.Map)) throw new Error(`データベース ${id} のレコード形式が不正です。`);
    const record = records.get(recordId);
    if (!(record instanceof Y.Map)) throw new Error(`レコード ${recordId} は存在しません。`);
    workspace.doc.transact(() => {
      Object.entries(values).forEach(([fieldId, value]) => { if (fieldId !== UPDATED_AT_FIELD_ID) record.set(fieldId, value); });
      record.set(UPDATED_AT_FIELD_ID, currentDatabaseTimestamp());
    }, localOrigin);
    workspace.undoManager.stopCapturing();
  }, [connectedDatabase, workspace]);

  const addDatabaseRecord = useCallback((id: string) => {
    if (!workspace) return;
    const database = connectedDatabase(id); const records = database?.get("records"); const fields = database?.get("fields");
    if (!(records instanceof Y.Map)) throw new Error(`データベース ${id} のレコード形式が不正です。`);
    if (!(fields instanceof Y.Array)) throw new Error(`データベース ${id} の列形式が不正です。`);
    workspace.doc.transact(() => {
      const record = new Y.Map<unknown>();
      fields.forEach((field) => {
        const fieldId = String(field.get("id")); const type = String(field.get("type")); const options = field.get("options");
        const dateFormat = (field.get("dateFormat") ?? "date") as DateDisplayFormat;
        const value = fieldId === UPDATED_AT_FIELD_ID ? currentDatabaseTimestamp()
          : type === "status" || type === "select" ? String(Array.isArray(options) ? options[0] ?? "" : "")
            : type === "person" ? "未担当"
              : type === "date" ? normalizeDateValue(isoDate(fieldId.toLowerCase().includes("end") ? 7 : 0), dateFormat) ?? ""
                : fieldId === "title" ? "新しいレコード" : "";
        record.set(fieldId, value);
      });
      records.set(crypto.randomUUID(), record);
    }, localOrigin);
  }, [connectedDatabase, workspace]);

  const connectDatabase = useCallback((viewId: string, databaseId: string) => {
    if (!workspace) return;
    if (databaseId && !workspace.databasesMap.has(databaseId)) throw new Error(`データベース ${databaseId} は存在しません。`);
    const item = workspace.nodesMap.get(viewId); if (!item) throw new Error(`表示オブジェクト ${viewId} は存在しません。`);
    workspace.doc.transact(() => {
      item.set("databaseId", databaseId); item.set("databaseView", "table");
      item.set("tableVisibleFieldIds", []); item.set("kanbanGroupFieldId", "");
      item.set("ganttStartFieldId", ""); item.set("ganttEndFieldId", "");
    }, localOrigin);
  }, [workspace]);

  const createDatabase = useCallback((viewId?: string) => {
    if (!workspace) return "";
    const databaseId = crypto.randomUUID();
    const sortOrder = databaseState(workspace.databasesMap).length;
    workspace.doc.transact(() => {
      workspace.databasesMap.set(databaseId, makeDatabaseDefinition(databaseId, "新しいデータベース", sortOrder));
      if (viewId) {
        const item = workspace.nodesMap.get(viewId);
        item?.set("databaseId", databaseId); item?.set("databaseView", "table");
        item?.set("tableVisibleFieldIds", []); item?.set("kanbanGroupFieldId", "");
        item?.set("ganttStartFieldId", ""); item?.set("ganttEndFieldId", "");
      }
    }, localOrigin);
    return databaseId;
  }, [workspace]);

  const updateDatabaseName = useCallback((databaseId: string, name: string) => {
    if (!workspace) return; const database = workspace.databasesMap.get(databaseId); if (!database) return;
    workspace.doc.transact(() => database.set("name", name), localOrigin);
  }, [workspace]);

  const reorderManagedDatabase = useCallback((sourceId: string, insertionIndex: number) => {
    if (!workspace) return;
    const orderedDatabases = databaseState(workspace.databasesMap);
    const sourceIndex = orderedDatabases.findIndex((database) => database.id === sourceId);
    if (sourceIndex < 0) throw new Error(`データベース ${sourceId} は存在しません。`);
    if (!Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > orderedDatabases.length) throw new Error("データベースの挿入位置が不正です。");
    const [sourceDatabase] = orderedDatabases.splice(sourceIndex, 1);
    const adjustedInsertionIndex = insertionIndex > sourceIndex ? insertionIndex - 1 : insertionIndex;
    if (adjustedInsertionIndex === sourceIndex) return;
    orderedDatabases.splice(adjustedInsertionIndex, 0, sourceDatabase);
    workspace.doc.transact(() => {
      orderedDatabases.forEach((database, index) => {
        const storedDatabase = workspace.databasesMap.get(database.id);
        if (!storedDatabase) throw new Error(`データベース ${database.id} は存在しません。`);
        storedDatabase.set("sortOrder", index);
      });
    }, localOrigin);
  }, [workspace]);

  const deleteManagedDatabase = useCallback((databaseId: string, expectedName: string) => {
    if (!workspace) return;
    const database = workspace.databasesMap.get(databaseId);
    if (!database) throw new Error(`データベース ${databaseId} は存在しません。`);
    if (String(database.get("name") ?? "") !== expectedName) throw new Error("データベース名が変更されています。削除をやり直してください。");
    workspace.doc.transact(() => {
      workspace.nodesMap.forEach((item) => {
        if (String(item.get("databaseId") ?? "") !== databaseId) return;
        item.set("databaseId", "");
        item.set("databaseView", "table");
      });
      workspace.databasesMap.delete(databaseId);
    }, localOrigin);
    setOpenManagedDatabaseIds((current) => current.filter((id) => id !== databaseId));
    setDatabaseDeleteDialog(null);
  }, [workspace]);

  const normalizeConnectedViews = useCallback((databaseId: string, fields: Y.Array<Y.Map<unknown>>) => {
    if (!workspace) return;
    const hasStatus = fields.toArray().some((field) => ["status", "select"].includes(String(field.get("type"))) && Array.isArray(field.get("options")) && (field.get("options") as string[]).length > 0);
    const dateCount = fields.toArray().filter((field) => field.get("type") === "date" && !field.get("system") && ["date", "datetime"].includes(String(field.get("dateFormat") ?? "date"))).length;
    workspace.nodesMap.forEach((item) => {
      if (item.get("databaseId") !== databaseId) return;
      if ((item.get("databaseView") === "kanban" && !hasStatus) || (item.get("databaseView") === "gantt" && dateCount < 2) || (item.get("databaseView") === "calendar" && dateCount < 1)) item.set("databaseView", "table");
    });
  }, [workspace]);

  const addDatabaseField = useCallback((databaseId: string) => {
    if (!workspace) return; const fields = workspace.databasesMap.get(databaseId)?.get("fields"); if (!(fields instanceof Y.Array)) return;
    const systemIndex = fields.toArray().findIndex((field) => Boolean(field.get("system")));
    workspace.doc.transact(() => fields.insert(systemIndex >= 0 ? systemIndex : fields.length, [makeDatabaseField(crypto.randomUUID(), "新しい列", "text")]), localOrigin);
  }, [workspace]);

  const scrollCreationTools = useCallback((event: React.WheelEvent<HTMLElement>) => {
    const element = event.currentTarget;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    event.preventDefault();
    element.scrollLeft += delta;
  }, []);

  const reorderDatabaseFields = useCallback((databaseId: string, fieldIds: string[], targetId: string, position: "before" | "after") => {
    if (!workspace) return;
    const fields = workspace.databasesMap.get(databaseId)?.get("fields");
    if (!(fields instanceof Y.Array)) return;
    const currentFields = fields.toArray();
    const requestedIds = new Set(fieldIds);
    const movingFields = currentFields.filter((field) => requestedIds.has(String(field.get("id"))));
    if (movingFields.length !== requestedIds.size) throw new Error("移動する列の一部が存在しません。");
    if (movingFields.some((field) => field.get("system"))) throw new Error("システム列は移動できません。");
    if (requestedIds.has(targetId)) return;
    const remainingFields = currentFields.filter((field) => !requestedIds.has(String(field.get("id"))));
    const targetIndex = remainingFields.findIndex((field) => field.get("id") === targetId);
    if (targetIndex < 0) throw new Error(`列 ${targetId} は存在しません。`);
    const systemIndex = remainingFields.findIndex((field) => Boolean(field.get("system")));
    let insertionIndex = remainingFields[targetIndex].get("system") || position === "before" ? targetIndex : targetIndex + 1;
    if (systemIndex >= 0) insertionIndex = Math.min(insertionIndex, systemIndex);
    const movingIndexes = currentFields.map((field, index) => requestedIds.has(String(field.get("id"))) ? index : -1).filter((index) => index >= 0);
    const movedFields = movingFields.map(cloneDatabaseField);
    workspace.doc.transact(() => {
      [...movingIndexes].reverse().forEach((index) => fields.delete(index, 1));
      fields.insert(insertionIndex, movedFields);
    }, localOrigin);
  }, [workspace]);

  const updateDatabaseField = useCallback((databaseId: string, fieldId: string, values: { name?: string; type?: string; options?: string[]; optionColors?: Record<string, string>; dateFormat?: DateDisplayFormat }) => {
    if (!workspace) return; const fields = workspace.databasesMap.get(databaseId)?.get("fields"); if (!(fields instanceof Y.Array)) return;
    const field = fields.toArray().find((entry) => entry.get("id") === fieldId); if (!field) return;
    if (field.get("system")) throw new Error("システム列は変更できません。");
    workspace.doc.transact(() => {
      Object.entries(values).forEach(([key, value]) => field.set(key, value));
      if (values.type === "status" && (!Array.isArray(field.get("options")) || (field.get("options") as string[]).length === 0)) {
        field.set("options", DEFAULT_STATUS_OPTIONS);
        field.set("optionColors", DEFAULT_STATUS_OPTION_COLORS);
      }
      if (values.type === "select" && (!Array.isArray(field.get("options")) || (field.get("options") as string[]).length === 0)) field.set("options", ["選択肢1", "選択肢2"]);
      if (values.type && values.type !== "status" && values.type !== "select") { field.set("options", []); field.set("optionColors", {}); }
      if (values.type === "date" && !field.has("dateFormat")) field.set("dateFormat", "date");
      normalizeConnectedViews(databaseId, fields);
    }, localOrigin);
  }, [normalizeConnectedViews, workspace]);

  const setDatabaseFieldTableVisible = useCallback((databaseId: string, fieldId: string, tableVisible: boolean) => {
    if (!workspace) return;
    const fields = workspace.databasesMap.get(databaseId)?.get("fields");
    if (!(fields instanceof Y.Array)) throw new Error(`データベース ${databaseId} の列形式が不正です。`);
    const field = fields.toArray().find((entry) => entry.get("id") === fieldId);
    if (!field) throw new Error(`列 ${fieldId} は存在しません。`);
    workspace.doc.transact(() => field.set("tableVisible", tableVisible), localOrigin);
  }, [workspace]);

  const deleteDatabaseFields = useCallback((databaseId: string, fieldIds: string[]) => {
    if (!workspace) return; const database = workspace.databasesMap.get(databaseId); const fields = database?.get("fields"); const records = database?.get("records");
    if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) return;
    const requestedIds = new Set(fieldIds);
    const currentFields = fields.toArray();
    const deleteIndexes = currentFields.map((field, index) => requestedIds.has(String(field.get("id"))) ? index : -1).filter((index) => index >= 0);
    if (deleteIndexes.length !== requestedIds.size) throw new Error("削除する列の一部が存在しません。");
    if (deleteIndexes.some((index) => fields.get(index)?.get("system"))) throw new Error("システム列は削除できません。");
    workspace.doc.transact(() => {
      [...deleteIndexes].reverse().forEach((index) => fields.delete(index, 1));
      records.forEach((record) => fieldIds.forEach((fieldId) => record.delete(fieldId)));
      normalizeConnectedViews(databaseId, fields);
    }, localOrigin);
    setSelectedDatabaseFieldIds((current) => current.filter((id) => !requestedIds.has(id)));
    setFieldDeleteDialog(null);
  }, [normalizeConnectedViews, workspace]);

  const changeDatabaseView = useCallback((id: string, view: "table" | "kanban" | "gantt" | "calendar") => {
    if (!workspace) return;
    const item = workspace.nodesMap.get(id);
    if (!item) throw new Error(`データベース ${id} は存在しません。`);
    const database = workspace.databasesMap.get(String(item.get("databaseId") ?? "")); const fields = database?.get("fields");
    if (!(fields instanceof Y.Array)) throw new Error("表示するデータベースを先に接続してください。");
    if (view === "kanban" && !fields.toArray().some((field) => ["status", "select"].includes(String(field.get("type"))) && Array.isArray(field.get("options")) && (field.get("options") as string[]).length > 0)) throw new Error("看板表示には選択肢のある列が必要です。");
    const timelineDateFields = fields.toArray().filter((field) => field.get("type") === "date" && !field.get("system") && ["date", "datetime"].includes(String(field.get("dateFormat") ?? "date")));
    if (view === "gantt" && timelineDateFields.length < 2) throw new Error("ガント表示には日または日時の列が2列必要です。");
    if (view === "calendar" && timelineDateFields.length < 1) throw new Error("カレンダー表示には日または日時の列が必要です。");
    workspace.doc.transact(() => item.set("databaseView", view), localOrigin);
  }, [workspace]);

  const updateDatabaseDisplaySettings = useCallback((id: string, values: Record<string, unknown>) => {
    if (!workspace) return;
    const item = workspace.nodesMap.get(id);
    if (!item || item.get("kind") !== "database") throw new Error(`データベース表示オブジェクト ${id} は存在しません。`);
    workspace.doc.transact(() => Object.entries(values).forEach(([key, value]) => item.set(key, value)), localOrigin);
  }, [workspace]);

  const updateDatabaseQuery = useCallback((id: string, values: Record<string, unknown>) => {
    if (!workspace) return;
    const item = workspace.nodesMap.get(id);
    const database = item ? workspace.databasesMap.get(String(item.get("databaseId") ?? "")) : undefined;
    if (!database) throw new Error("表示するデータベースを先に接続してください。");
    workspace.doc.transact(() => Object.entries(values).forEach(([key, value]) => database.set(key, value)), localOrigin);
  }, [workspace]);

  const refreshWorkspace = useCallback(() => {
    if (!workspace || !synced) return;
    const databases = databaseState(workspace.databasesMap);
    setManagedDatabases(databases);
    const currentComments = Array.from(workspace.commentsMap.values()).map((comment) => ({
      id: String(comment.get("id")), nodeId: String(comment.get("nodeId") ?? ""), text: String(comment.get("text")),
      author: String(comment.get("author")), createdAt: String(comment.get("createdAt")), resolved: Boolean(comment.get("resolved")),
    })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    setComments(currentComments);
    setNodes(Array.from(workspace.nodesMap.values()).map((item) => {
      const kind = (item.get("kind") ?? "sticky") as BoardItemKind;
      const reactions = item.get("reactions");
      const databaseId = kind === "database" ? String(item.get("databaseId") ?? "") : "";
      const database = databaseId ? workspace.databasesMap.get(databaseId) : undefined;
      const databaseFields = database?.get("fields"); const databaseRecords = database?.get("records");
      return {
        id: String(item.get("id")), type: "boardItem", position: { x: Number(item.get("x")), y: Number(item.get("y")) },
        selected: selectedIdsRef.current.includes(String(item.get("id"))),
        data: {
          text: kind === "database" && database ? String(database.get("name") ?? "名称未設定") : item.get("text") instanceof Y.Text ? (item.get("text") as Y.Text).toString() : String(item.get("text") ?? ""),
          color: String(item.get("color") ?? "#ffd972"), kind,
          fontSize: Number(item.get("fontSize") ?? (kind === "text" ? 22 : 16)),
          textAlign: (item.get("textAlign") ?? (kind === "shape" ? "center" : "left")) as BoardNodeData["textAlign"],
          verticalAlign: (item.get("verticalAlign") ?? (kind === "shape" ? "middle" : "top")) as BoardNodeData["verticalAlign"],
          shape: (item.get("shape") ?? "rectangle") as BoardNodeData["shape"],
          status: (item.get("status") ?? "todo") as BoardNodeData["status"], locked: Boolean(item.get("locked")),
          commentCount: currentComments.filter((comment) => comment.nodeId === String(item.get("id")) && !comment.resolved).length, commentsVisible,
          drawingPath: String(item.get("drawingPath") ?? ""), drawingStrokeWidth: Number(item.get("drawingStrokeWidth") ?? 4), drawingBrush: (item.get("drawingBrush") ?? "pen") as BoardNodeData["drawingBrush"], frameRows: Number(item.get("frameRows") ?? 0), frameColumns: Number(item.get("frameColumns") ?? 0),
          frameImage: String(item.get("frameImage") ?? ""), frameImageFit: (item.get("frameImageFit") ?? "stretch") as "height" | "width" | "stretch",
          frameGridColor: String(item.get("frameGridColor") ?? "#8f899b"),
          lineStartX: Number(item.get("lineStartX") ?? 0), lineStartY: Number(item.get("lineStartY") ?? 500), lineEndX: Number(item.get("lineEndX") ?? 1000), lineEndY: Number(item.get("lineEndY") ?? 500),
          lineStrokeWidth: Number(item.get("lineStrokeWidth") ?? 3), lineDashed: Boolean(item.get("lineDashed")),
          linkTitle: String(item.get("linkTitle") ?? ""),
          reactions: reactions instanceof Y.Map ? Object.fromEntries(reactions.entries()) as Record<string, number> : {},
          databaseId, availableDatabases: databases.map(({ id, name }) => ({ id, name })),
          databaseFields: databaseFields instanceof Y.Array ? databaseFields.toArray().map(databaseFieldState) : [],
          databaseRecords: databaseRecords instanceof Y.Map ? Array.from(databaseRecords.entries()).map(([id, record]) => ({ id, values: Object.fromEntries(record.entries()) as Record<string, string> })) : [],
          databaseView: (item.get("databaseView") ?? "table") as "table" | "kanban" | "gantt" | "calendar",
          tableVisibleFieldIds: Array.isArray(item.get("tableVisibleFieldIds")) ? item.get("tableVisibleFieldIds") as string[] : [],
          tableColumnWidths: (() => { const value = item.get("tableColumnWidths"); if (!value || typeof value !== "object" || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).map(([key, width]) => [key, Number(width)])); })(),
          tableRowHeight: Number(item.get("tableRowHeight") ?? 44),
          kanbanGroupFieldId: String(item.get("kanbanGroupFieldId") ?? ""),
          ganttStartFieldId: String(item.get("ganttStartFieldId") ?? ""),
          ganttEndFieldId: String(item.get("ganttEndFieldId") ?? ""),
          ganttScale: (item.get("ganttScale") ?? "week") as "day" | "week" | "month",
          ganttRangeMode: (item.get("ganttRangeMode") ?? "auto") as "auto" | "fixed" | "relative",
          ganttFixedStart: String(item.get("ganttFixedStart") ?? isoDate(-30)),
          ganttFixedEnd: String(item.get("ganttFixedEnd") ?? isoDate(90)),
          ganttRelativeUnit: (item.get("ganttRelativeUnit") ?? "month") as "week" | "month",
          ganttRelativeBefore: Number(item.get("ganttRelativeBefore") ?? 2),
          ganttRelativeAfter: Number(item.get("ganttRelativeAfter") ?? 1),
          calendarDateFieldId: String(item.get("calendarDateFieldId") ?? ""),
          calendarShowHolidays: Boolean(item.get("calendarShowHolidays") ?? true),
          calendarWeekStart: (item.get("calendarWeekStart") ?? "monday") as "sunday" | "monday",
          calendarScrollDirection: (item.get("calendarScrollDirection") ?? "vertical") as "vertical" | "horizontal",
          calendarRangeMode: (item.get("calendarRangeMode") ?? "relative") as "fixed" | "relative",
          calendarFixedStart: String(item.get("calendarFixedStart") ?? isoDate(-30)), calendarFixedEnd: String(item.get("calendarFixedEnd") ?? isoDate(90)),
          calendarRelativeBefore: Number(item.get("calendarRelativeBefore") ?? 0), calendarRelativeAfter: Number(item.get("calendarRelativeAfter") ?? 2),
          databaseFilters: (() => {
            const filters = database?.get("filters");
            if (filters === undefined) return [];
            if (!Array.isArray(filters)) throw new Error(`データベース ${databaseId} のフィルター形式が不正です。`);
            return filters.map((filter) => {
              if (!filter || typeof filter !== "object" || !("id" in filter) || !("fieldId" in filter) || !("operator" in filter) || !("value" in filter)) throw new Error(`データベース ${databaseId} のフィルター条件が不正です。`);
              return filter as BoardNodeData["databaseFilters"][number];
            });
          })(),
          databaseSortFieldId: String(database?.get("sortFieldId") ?? ""),
          databaseSortDirection: (database?.get("sortDirection") ?? "asc") as "asc" | "desc",
          onTextChange: updateText, onReaction: addReaction, onEditingChange: setEditing,
          onDatabaseCellChange: updateDatabaseCell, onDatabaseRecordChange: updateDatabaseRecord, onDatabaseRecordAdd: addDatabaseRecord, onDatabaseViewChange: changeDatabaseView,
          onDatabaseConnect: connectDatabase, onDatabaseCreate: createDatabase,
          onDatabaseDisplaySettingsChange: updateDatabaseDisplaySettings,
          onDatabaseQueryChange: updateDatabaseQuery,
          onQuerySheetChange: updateDatabaseQuerySheet,
          onResize: resizeNode,
          onResizeStart: startResize,
          onLineGeometryChange: updateLineGeometry,
          selectionOnly: false,
          fullscreen: false,
          onFullscreenChange: (id, fullscreen) => setFullscreenDatabaseId(fullscreen ? id : null),
        },
        draggable: !Boolean(item.get("locked")), dragHandle: kind === "database" ? ".node-drag-handle, .database-header" : ["frame", "shape", "text"].includes(kind) ? ".node-drag-handle" : undefined, zIndex: kind === "frame" ? -1 : 1,
        style: { width: Number(item.get("width") ?? itemSize(kind).width), height: Number(item.get("height") ?? itemSize(kind).height) },
      };
    }));
    setEdges(Array.from(workspace.edgesMap.values()).map((item) => ({
      id: String(item.get("id")), source: String(item.get("source")), target: String(item.get("target")),
      sourceHandle: String(item.get("sourceHandle") ?? "right"), targetHandle: String(item.get("targetHandle") ?? "left"),
      type: "boardEdge", selected: selectedEdgeIdsRef.current.includes(String(item.get("id"))), animated: Boolean(item.get("animated")), label: String(item.get("label") ?? ""),
      data: { lineType: String(item.get("lineType") ?? "bezier"), locked: Boolean(item.get("locked")) },
      reconnectable: !Boolean(item.get("locked")),
      style: { stroke: displayEdgeColor(item.get("color")), strokeWidth: Number(item.get("strokeWidth") ?? 2), strokeDasharray: item.get("dashed") ? "7 5" : undefined, opacity: item.get("locked") ? .72 : 1 },
      markerStart: item.get("startMarker") === "none" || !item.get("startMarker") ? undefined : { type: item.get("startMarker") === "open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: displayEdgeColor(item.get("color")) },
      markerEnd: item.get("endMarker") === "none" ? undefined : { type: item.get("endMarker") === "open" ? MarkerType.Arrow : MarkerType.ArrowClosed, color: displayEdgeColor(item.get("color")) },
      labelStyle: { fill: "#5f5a6d", fontSize: 11 },
    })));
    setTitle(workspace.meta.get("title") ?? "Product discovery workshop");
    const sharedTimerEnd = Number(workspace.meta.get("timerEnd") ?? 0);
    setTimerEnd(sharedTimerEnd);
    setTimerHasElapsed(sharedTimerEnd > 0 && Date.now() >= sharedTimerEnd);
    setTimerMinutes(Number(workspace.meta.get("timerDurationMinutes") ?? 5));
    setTimerRunId(String(workspace.meta.get("timerRunId") ?? ""));
    setTimerNoticeId(String(workspace.meta.get("timerNoticeId") ?? ""));
    setTimerNoticeReason(workspace.meta.get("timerNoticeReason") === "stopped" ? "stopped" : "");
    setMcpPermissions(Object.fromEntries(mcpTools.map((tool) => [tool.name, (workspace.permissionsMap.get(tool.name) ?? (tool.access === "read" ? "always_allow" : "require_approval")) as McpPermission])));
    setAgentEvents(workspace.events.toArray().slice(-30).reverse().map((event) => ({
      id: String(event.get("id")), action: String(event.get("action")), summary: String(event.get("summary")), createdAt: String(event.get("createdAt")),
      ownerName: event.has("ownerName") ? String(event.get("ownerName")) : null,
      agentName: event.has("agentName") ? String(event.get("agentName")) : null,
      agentId: event.has("agentId") ? String(event.get("agentId")) : null,
      agentColor: event.has("agentColor") ? String(event.get("agentColor")) : null,
    })));
  }, [addDatabaseRecord, addReaction, changeDatabaseView, commentsVisible, connectDatabase, createDatabase, resizeNode, setEditing, startResize, synced, updateDatabaseCell, updateDatabaseDisplaySettings, updateDatabaseQuery, updateDatabaseQuerySheet, updateDatabaseRecord, updateLineGeometry, updateText, workspace]);

  useEffect(() => {
    if (!workspace) return;
    workspace.nodesMap.observeDeep(refreshWorkspace); workspace.databasesMap.observeDeep(refreshWorkspace); workspace.edgesMap.observeDeep(refreshWorkspace);
    workspace.commentsMap.observeDeep(refreshWorkspace); workspace.meta.observe(refreshWorkspace); workspace.permissionsMap.observe(refreshWorkspace);
    workspace.events.observeDeep(refreshWorkspace);
    // Populate the React projection after subscribing to the external Yjs store.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshWorkspace();
    return () => {
      workspace.nodesMap.unobserveDeep(refreshWorkspace); workspace.databasesMap.unobserveDeep(refreshWorkspace); workspace.edgesMap.unobserveDeep(refreshWorkspace);
      workspace.commentsMap.unobserveDeep(refreshWorkspace); workspace.meta.unobserve(refreshWorkspace); workspace.permissionsMap.unobserve(refreshWorkspace);
      workspace.events.unobserveDeep(refreshWorkspace);
    };
  }, [refreshWorkspace, workspace]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      setRemainingSeconds(Math.max(0, Math.ceil((timerEnd - now) / 1000)));
      setTimerHasElapsed(timerEnd > 0 && now >= timerEnd);
    };
    tick(); const id = window.setInterval(tick, 250); return () => window.clearInterval(id);
  }, [timerEnd]);

  useEffect(() => {
    if (!workspace || !synced || workspace.nodesMap.size > 0) return;
    workspace.doc.transact(() => {
      workspace.meta.set("title", "Product discovery workshop");
      workspace.nodesMap.set("welcome", createYNode("welcome", "sticky", "アイデアをここに。\nそのまま編集できます。", "#ffd972", 20, 20));
      workspace.nodesMap.set("question", createYNode("question", "shape", "ユーザーが本当に\n困っていることは？", "#d9ccff", 360, 180));
      workspace.nodesMap.set("insight", createYNode("insight", "sticky", "付箋・図形・テキストを追加して\nチームで整理しましょう", "#b9f5d8", 720, 30));
    }, localOrigin);
  }, [synced, workspace]);

  useEffect(() => {
    if (!workspace || !synced || workspace.nodesMap.size === 0) return;
    workspace.doc.transact(() => {
      databaseState(workspace.databasesMap).forEach((database, index) => {
        const storedDatabase = workspace.databasesMap.get(database.id);
        if (!storedDatabase) throw new Error(`データベース ${database.id} は存在しません。`);
        if (Number(storedDatabase.get("sortOrder")) !== index) storedDatabase.set("sortOrder", index);
      });
      workspace.databasesMap.forEach((database) => {
        const fields = database.get("fields"); const records = database.get("records");
        if (!(fields instanceof Y.Array) || !(records instanceof Y.Map)) throw new Error("データベースの形式が不正です。");
        if (database.get("name") === "新しいミニデータベース") database.set("name", "新しいデータベース");
        fields.forEach((field) => {
          if (field.get("type") === "date" && !field.has("dateFormat")) field.set("dateFormat", "date");
          if (!field.has("tableVisible")) field.set("tableVisible", field.get("system") !== "updatedAt");
          const options = Array.isArray(field.get("options")) ? field.get("options") as string[] : [];
          if (field.get("type") === "status") {
            const hasLegacyDefaults = options.length === 3 && options[0] === "TODO" && options[1] === "進行中" && options[2] === "完了";
            const hasCurrentDefaults = options.length === 3 && options[0] === "未着手" && options[1] === "進行中" && options[2] === "完了";
            if (hasLegacyDefaults) {
              field.set("options", DEFAULT_STATUS_OPTIONS);
              records.forEach((record) => { if (record.get(String(field.get("id"))) === "TODO") record.set(String(field.get("id")), "未着手"); });
            }
            if (!field.has("statusColorPresetVersion")) {
              if (hasLegacyDefaults || hasCurrentDefaults) field.set("optionColors", DEFAULT_STATUS_OPTION_COLORS);
              field.set("statusColorPresetVersion", 1);
            }
          }
          if (!field.has("optionColors")) field.set("optionColors", field.get("type") === "status" ? DEFAULT_STATUS_OPTION_COLORS : {});
        });
        const updatedAtIndex = fields.toArray().findIndex((field) => field.get("id") === UPDATED_AT_FIELD_ID);
        if (updatedAtIndex < 0) {
          fields.push([makeDatabaseField(UPDATED_AT_FIELD_ID, "更新日時", "date", [], "datetime", "updatedAt")]);
        } else if (updatedAtIndex !== fields.length - 1) {
          const updatedAtField = cloneDatabaseField(fields.get(updatedAtIndex));
          fields.delete(updatedAtIndex, 1);
          fields.push([updatedAtField]);
        }
        records.forEach((record) => {
          fields.forEach((field) => {
            if (field.get("type") !== "date" || field.get("system")) return;
            const fieldId = String(field.get("id")); const current = String(record.get(fieldId) ?? "");
            const normalized = normalizeDateValue(current, (field.get("dateFormat") ?? "date") as DateDisplayFormat);
            if (normalized !== null && normalized !== current) record.set(fieldId, normalized);
          });
          if (!record.has(UPDATED_AT_FIELD_ID)) record.set(UPDATED_AT_FIELD_ID, currentDatabaseTimestamp());
        });
        if (database.has("filters")) return;
        const fieldId = String(database.get("filterFieldId") ?? ""); const value = String(database.get("filterValue") ?? "");
        const operator = String(database.get("filterOperator") ?? "contains");
        if (!["contains", "equals", "not_equals"].includes(operator)) throw new Error("既存フィルターの条件形式が不正です。");
        database.set("filters", fieldId && value ? [{ id: crypto.randomUUID(), fieldId, operator, value }] : []);
        database.delete("filterFieldId"); database.delete("filterOperator"); database.delete("filterValue");
      });
      workspace.nodesMap.forEach((item) => {
      const kind = String(item.get("kind") ?? "sticky") as BoardItemKind;
      if (!item.has("fontSize")) item.set("fontSize", kind === "text" ? 22 : 16);
      if (!item.has("textAlign")) item.set("textAlign", kind === "shape" ? "center" : "left");
      if (!item.has("verticalAlign")) item.set("verticalAlign", kind === "shape" ? "middle" : "top");
      if (kind === "frame" && !item.has("frameImage")) item.set("frameImage", "");
      if (kind === "frame" && !item.has("frameImageFit")) item.set("frameImageFit", "stretch");
      if (kind === "frame" && !item.has("frameGridColor")) item.set("frameGridColor", "#8f899b");
      if (kind !== "database") return;
      if (!item.has("tableVisibleFieldIds")) item.set("tableVisibleFieldIds", []);
      if (!item.has("tableColumnWidths")) item.set("tableColumnWidths", {});
      if (!item.has("tableRowHeight")) item.set("tableRowHeight", 44);
      if (!item.has("kanbanGroupFieldId")) item.set("kanbanGroupFieldId", "");
      if (!item.has("ganttStartFieldId")) item.set("ganttStartFieldId", "");
      if (!item.has("ganttEndFieldId")) item.set("ganttEndFieldId", "");
      if (!item.has("ganttScale")) item.set("ganttScale", "week");
      if (!item.has("ganttRangeMode")) item.set("ganttRangeMode", "auto");
      if (!item.has("ganttFixedStart")) item.set("ganttFixedStart", isoDate(-30));
      if (!item.has("ganttFixedEnd")) item.set("ganttFixedEnd", isoDate(90));
      if (!item.has("ganttRelativeUnit")) item.set("ganttRelativeUnit", "month");
      if (!item.has("ganttRelativeBefore")) item.set("ganttRelativeBefore", 2);
      if (!item.has("ganttRelativeAfter")) item.set("ganttRelativeAfter", 1);
      if (!item.has("calendarDateFieldId")) item.set("calendarDateFieldId", "");
      if (!item.has("calendarShowHolidays")) item.set("calendarShowHolidays", true);
      if (!item.has("calendarWeekStart")) item.set("calendarWeekStart", "monday");
      if (!item.has("calendarScrollDirection")) item.set("calendarScrollDirection", "vertical");
      if (!item.has("calendarRangeMode")) item.set("calendarRangeMode", "relative");
      if (!item.has("calendarFixedStart")) item.set("calendarFixedStart", isoDate(-30));
      if (!item.has("calendarFixedEnd")) item.set("calendarFixedEnd", isoDate(90));
      if (!item.has("calendarRelativeBefore")) item.set("calendarRelativeBefore", 0);
      if (!item.has("calendarRelativeAfter")) item.set("calendarRelativeAfter", 2);
      const connectedId = String(item.get("databaseId") ?? "");
      if (connectedId && workspace.databasesMap.has(connectedId)) return;
      const legacyFields = item.get("databaseFields"); const legacyRecords = item.get("databaseRecords");
      if (!(legacyFields instanceof Y.Array) || !(legacyRecords instanceof Y.Map)) { item.set("databaseId", ""); return; }
      const databaseId = String(item.get("id"));
      const definition = new Y.Map<unknown>(); const fields = new Y.Array<Y.Map<unknown>>(); const records = new Y.Map<Y.Map<unknown>>();
      const nameValue = item.get("text"); const name = nameValue instanceof Y.Text ? nameValue.toString() : String(nameValue ?? "名称未設定");
      definition.set("id", databaseId); definition.set("name", name);
      fields.push(legacyFields.toArray().map((field) => makeDatabaseField(String(field.get("id")), String(field.get("name")), String(field.get("type")), field.get("type") === "status" ? DEFAULT_STATUS_OPTIONS : [])));
      fields.push([makeDatabaseField(UPDATED_AT_FIELD_ID, "更新日時", "date", [], "datetime", "updatedAt")]);
      legacyRecords.forEach((legacyRecord, recordId) => { if (!(legacyRecord instanceof Y.Map)) throw new Error(`レコード ${recordId} の形式が不正です。`); const record = new Y.Map<unknown>(); legacyRecord.forEach((value: unknown, key: string) => record.set(key, value)); record.set(UPDATED_AT_FIELD_ID, currentDatabaseTimestamp()); records.set(recordId, record); });
      definition.set("fields", fields); definition.set("records", records); workspace.databasesMap.set(databaseId, definition);
      item.set("databaseId", databaseId); item.delete("databaseFields"); item.delete("databaseRecords");
      });
    }, migrationOrigin);
  }, [synced, workspace]);

  const addNode = useCallback((kind: BoardItemKind, position?: { x: number; y: number }, text?: string, color?: string) => {
    if (!workspace) return "";
    const id = crypto.randomUUID();
    const center = position ?? flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? { x: 300, y: 200 };
    const presets: Record<BoardItemKind, { text: string; color: string }> = {
      sticky: { text: "新しいアイデア", color: "#ffd972" }, shape: { text: "", color: "#d9ccff" },
      text: { text: "テキスト", color: "#ffffff" }, card: { text: "新しいタスク\n担当者: 未設定", color: "#ffffff" },
      frame: { text: "フレーム", color: "#f2f0f8" }, database: { text: "データベース", color: "#ffffff" },
      drawing: { text: "手書き", color: "#4b4357" }, line: { text: "線", color: "#5e5868" }, link: { text: "https://example.com", color: "#ffffff" },
    };
    workspace.doc.transact(() => workspace.nodesMap.set(id, createYNode(id, kind, text ?? presets[kind].text, color ?? presets[kind].color, center.x, center.y)), localOrigin);
    return id;
  }, [flow, workspace]);

  useEffect(() => {
    const pasteUrl = (event: ClipboardEvent) => {
      if (objectPastePendingRef.current) {
        objectPastePendingRef.current = false;
        event.preventDefault();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const value = event.clipboardData?.getData("text/plain").trim() ?? "";
      if (!/^https?:\/\/\S+$/i.test(value)) return;
      event.preventDefault();
      void (async () => {
        try {
          const parsed = new URL(value);
          let linkTitle = parsed.hostname;
          const isBoardUrl = parsed.pathname === "/" && (parsed.searchParams.has("room") || parsed.origin === window.location.origin);
          if (isBoardUrl) {
            const boardId = boardIdFromReference(value);
            if (boardId === room) linkTitle = title;
            else {
              const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
              const payload = await response.json() as { title?: string; error?: string };
              if (!response.ok || !payload.title) throw new Error(payload.error ?? "共有ボードのタイトルを取得できませんでした。");
              linkTitle = payload.title;
            }
          }
          const id = addNode("link", undefined, value, "#ffffff");
          const activeWorkspace = workspace;
          if (!activeWorkspace) throw new Error("共同編集ボードへ接続されていません。");
          const item = activeWorkspace.nodesMap.get(id);
          if (!item) throw new Error("リンクオブジェクトを作成できませんでした。");
          activeWorkspace.doc.transact(() => item.set("linkTitle", linkTitle), localOrigin);
        } catch (error) { window.alert(error instanceof Error ? error.message : "URLを貼り付けられませんでした。"); }
      })();
    };
    window.addEventListener("paste", pasteUrl); return () => window.removeEventListener("paste", pasteUrl);
  }, [addNode, room, title, workspace]);

  const beginToolDrag = (event: React.DragEvent<HTMLButtonElement>, kind: BoardItemKind) => {
    event.dataTransfer.setData("application/x-mingleboard-item", kind); event.dataTransfer.effectAllowed = "copy";
  };

  const dropTool = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData("application/x-mingleboard-item") as BoardItemKind;
    if (!kind || !flow) return;
    addNode(kind, flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  const updateItems = useCallback((ids: string[], values: Record<string, unknown>) => {
    if (!workspace) return;
    workspace.doc.transact(() => ids.forEach((id) => {
      const item = workspace.nodesMap.get(id);
      if (!item) return;
      const unlocking = Object.keys(values).length === 1 && values.locked === false;
      if (item.get("locked") && !unlocking) return;
      Object.entries(values).forEach(([key, value]) => item.set(key, value));
    }), localOrigin);
  }, [workspace]);

  const setFrameImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !selectedNode || selectedNode.data.kind !== "frame") return;
    if (!file.type.startsWith("image/")) throw new Error("画像ファイルを選択してください。");
    if (file.size > 2 * 1024 * 1024) throw new Error("フレーム背景画像は2MB以下にしてください。");
    const frameImage = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("画像を読み込めませんでした。")); reader.onerror = () => reject(new Error("画像を読み込めませんでした。")); reader.readAsDataURL(file);
    });
    updateItems([selectedNode.id], { frameImage });
  };

  const onNodesChange = useCallback((changes: NodeChange<BoardNodeType>[]) => {
    const finiteChanges = changes.filter((change) => {
      if (change.type === "position" && change.position) return isFinitePoint(change.position);
      if (change.type === "dimensions" && change.dimensions) return Number.isFinite(change.dimensions.width) && Number.isFinite(change.dimensions.height) && change.dimensions.width > 0 && change.dimensions.height > 0;
      return true;
    });
    const constrainedChanges = finiteChanges.map((change) => {
      if (change.type !== "position" || !change.position || !shiftPressedRef.current) return change;
      const origin = dragOriginsRef.current.get(change.id); if (!origin) return change;
      const deltaX = change.position.x - origin.x; const deltaY = change.position.y - origin.y;
      if (!dragAxisRef.current && (deltaX !== 0 || deltaY !== 0)) dragAxisRef.current = Math.abs(deltaX) >= Math.abs(deltaY) ? "horizontal" : "vertical";
      if (dragAxisRef.current === "horizontal") return { ...change, position: { x: change.position.x, y: origin.y } };
      if (dragAxisRef.current === "vertical") return { ...change, position: { x: origin.x, y: change.position.y } };
      return change;
    });
    setNodes((current) => applyNodeChanges(constrainedChanges, current));
    if (!workspace) return;
    workspace.doc.transact(() => constrainedChanges.forEach((change) => {
      if (change.type === "position" && change.position && !resizingIdsRef.current.has(change.id)) { const item = workspace.nodesMap.get(change.id); item?.set("x", change.position.x); item?.set("y", change.position.y); }
    }), localOrigin);
  }, [workspace]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onSelectionChange = useCallback(({ nodes: selected, edges: selectedEdges }: { nodes: BoardNodeType[]; edges: Edge[] }) => {
    const nextIds = selected.map((node) => node.id);
    const nextEdgeIds = selectedEdges.map((edge) => edge.id);
    selectedIdsRef.current = nextIds;
    selectedEdgeIdsRef.current = nextEdgeIds;
    setSelectedIds((current) => current.length === nextIds.length && current.every((id, index) => id === nextIds[index]) ? current : nextIds);
    setSelectedEdgeIds((current) => current.length === nextEdgeIds.length && current.every((id, index) => id === nextEdgeIds[index]) ? current : nextEdgeIds);
    if (nextIds.length !== 1) setNodeSettingsOpen(false);
  }, []);

  const toggleControlSelection = useCallback((id: string) => {
    const base = controlSelectionBaseRef.current ?? selectedIdsRef.current;
    const next = base.includes(id) ? base.filter((selectedId) => selectedId !== id) : [...base, id];
    controlSelectionBaseRef.current = null;
    window.setTimeout(() => {
      selectedIdsRef.current = next;
      setSelectedIds(next);
      setNodes((current) => current.map((node) => ({ ...node, selected: next.includes(node.id) })));
    });
  }, []);

  const deleteItems = useCallback((ids: string[]) => {
    if (!workspace) return;
    const deletableIds = ids.filter((id) => !workspace.nodesMap.get(id)?.get("locked"));
    if (deletableIds.length === 0) return;
    workspace.doc.transact(() => {
      deletableIds.forEach((id) => workspace.nodesMap.delete(id));
      Array.from(workspace.edgesMap.entries()).forEach(([id, edge]) => {
        if (deletableIds.includes(String(edge.get("source"))) || deletableIds.includes(String(edge.get("target")))) workspace.edgesMap.delete(id);
      });
    }, localOrigin);
    selectedIdsRef.current = [];
    setSelectedIds([]);
  }, [workspace]);

  const deleteEdges = useCallback((ids: string[]) => {
    if (!workspace) return;
    workspace.doc.transact(() => ids.forEach((id) => workspace.edgesMap.delete(id)), localOrigin);
    selectedEdgeIdsRef.current = []; setSelectedEdgeIds([]); setEdgeMenu(null);
  }, [workspace]);

  const runHistory = useCallback((direction: "undo" | "redo") => {
    if (!workspace) return;
    selectedIdsRef.current = [];
    setSelectedIds([]);
    if (direction === "undo") workspace.undoManager.undo();
    else workspace.undoManager.redo();
  }, [workspace]);

  const snapshotSelection = useCallback((nodeIds: string[], edgeIds: string[]) => {
    if (!workspace) return null;
    const selectedNodeIds = new Set(nodeIds);
    const includedEdgeIds = new Set(edgeIds);
    workspace.edgesMap.forEach((edge, edgeId) => {
      if (selectedNodeIds.has(String(edge.get("source"))) && selectedNodeIds.has(String(edge.get("target")))) includedEdgeIds.add(edgeId);
    });
    return {
      nodes: nodeIds.map((sourceId) => {
        const node = workspace.nodesMap.get(sourceId);
        if (!node) throw new Error(`コピー対象のオブジェクト ${sourceId} が存在しません。`);
        return { sourceId, entries: serializeYMap(node) };
      }),
      edges: Array.from(includedEdgeIds).map((sourceId) => {
        const edge = workspace.edgesMap.get(sourceId);
        if (!edge) throw new Error(`コピー対象の矢印 ${sourceId} が存在しません。`);
        return { sourceId, entries: serializeYMap(edge) };
      }),
    } satisfies BoardClipboard;
  }, [workspace]);

  const pasteSelection = useCallback((clipboard: BoardClipboard, target: { x: number; y: number }) => {
    if (!workspace || (clipboard.nodes.length === 0 && clipboard.edges.length === 0)) return;
    requireFinitePoint(target, "貼り付け先の座標");
    const nodeIdMap = new Map(clipboard.nodes.map(({ sourceId }) => [sourceId, crypto.randomUUID()]));
    const edgeIdMap = new Map(clipboard.edges.map(({ sourceId }) => [sourceId, crypto.randomUUID()]));
    const createdNodeIds = Array.from(nodeIdMap.values());
    const createdEdgeIds = Array.from(edgeIdMap.values());
    const clonedNodes = clipboard.nodes.map(({ sourceId, entries }) => {
      const kind = String(serializedMapValue(entries, "kind") ?? "sticky") as BoardItemKind;
      const size = itemSize(kind);
      const x = requireFiniteNumber(serializedMapValue(entries, "x"), `コピー元 ${sourceId} のX座標`);
      const y = requireFiniteNumber(serializedMapValue(entries, "y"), `コピー元 ${sourceId} のY座標`);
      const width = requireFiniteNumber(serializedMapValue(entries, "width") ?? size.width, `コピー元 ${sourceId} の幅`);
      const height = requireFiniteNumber(serializedMapValue(entries, "height") ?? size.height, `コピー元 ${sourceId} の高さ`);
      if (width <= 0 || height <= 0) throw new Error(`コピー元 ${sourceId} のサイズが不正なためコピーできません。`);
      return { sourceId, entries, x, y, width, height };
    });
    const bounds = clonedNodes.reduce((current, node) => {
      return {
        minX: Math.min(current.minX, node.x), minY: Math.min(current.minY, node.y),
        maxX: Math.max(current.maxX, node.x + node.width), maxY: Math.max(current.maxY, node.y + node.height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const delta = clonedNodes.length > 0
      ? { x: target.x - (bounds.minX + bounds.maxX) / 2, y: target.y - (bounds.minY + bounds.maxY) / 2 }
      : { x: 0, y: 0 };
    requireFinitePoint(delta, "コピー位置の差分");
    const positionedNodes = clonedNodes.map(({ sourceId, entries, x, y }) => ({
      sourceId, entries,
      x: x + delta.x,
      y: y + delta.y,
    }));
    positionedNodes.forEach(({ sourceId, x, y }) => requireFinitePoint({ x, y }, `コピー後 ${sourceId} の座標`));
    const clonedEdges = clipboard.edges.map(({ sourceId, entries }) => {
      const source = String(serializedMapValue(entries, "source") ?? "");
      const target = String(serializedMapValue(entries, "target") ?? "");
      if (!source || !target) throw new Error(`コピー元の矢印 ${sourceId} の接続先が不正です。`);
      return { sourceId, entries, source, target };
    });
    selectedIdsRef.current = createdNodeIds;
    selectedEdgeIdsRef.current = createdEdgeIds;
    workspace.undoManager.stopCapturing();
    workspace.doc.transact(() => {
      positionedNodes.forEach(({ sourceId, entries, x, y }) => {
        const id = nodeIdMap.get(sourceId)!;
        const node = deserializeYMap(entries);
        node.set("id", id); node.set("x", x); node.set("y", y);
        workspace.nodesMap.set(id, node);
      });
      clonedEdges.forEach(({ sourceId, entries, source, target }) => {
        const edge = deserializeYMap(entries); const id = edgeIdMap.get(sourceId)!;
        edge.set("id", id); edge.set("source", nodeIdMap.get(source) ?? source); edge.set("target", nodeIdMap.get(target) ?? target);
        workspace.edgesMap.set(id, edge);
      });
    }, localOrigin);
    workspace.undoManager.stopCapturing();
    setSelectedIds(createdNodeIds); setSelectedEdgeIds(createdEdgeIds);
  }, [workspace]);

  const copySelectedObjects = useCallback(() => {
    const clipboard = snapshotSelection(selectedIdsRef.current, selectedEdgeIdsRef.current);
    if (!clipboard || (clipboard.nodes.length === 0 && clipboard.edges.length === 0)) return;
    boardClipboardRef.current = clipboard;
  }, [snapshotSelection]);

  const pasteCopiedObjects = useCallback(() => {
    const clipboard = boardClipboardRef.current;
    if (!clipboard) return;
    const target = lastCanvasPointerRef.current
      ?? (flow ? requireFinitePoint(flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), "画面中央の座標") : null);
    if (!target) return;
    pasteSelection(clipboard, target);
  }, [flow, pasteSelection]);

  const alignSelectedNodes = useCallback((axis: "horizontal" | "vertical") => {
    if (!workspace || selectedIdsRef.current.length < 2) return;
    const selected = selectedIdsRef.current.map((id) => workspace.nodesMap.get(id)).filter((item): item is Y.Map<unknown> => Boolean(item));
    if (selected.length < 2) return;
    const coordinate = axis === "horizontal" ? "y" : "x";
    const alignedValue = selected.reduce((sum, item) => sum + Number(item.get(coordinate) ?? 0), 0) / selected.length;
    workspace.undoManager.stopCapturing();
    workspace.doc.transact(() => selected.forEach((item) => item.set(coordinate, alignedValue)), localOrigin);
    workspace.undoManager.stopCapturing();
  }, [workspace]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.matches("input, textarea, select") || target.isContentEditable);
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftPressedRef.current = true;
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        runHistory(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (isEditable(event.target)) return;
      if (command && event.altKey && selectedIdsRef.current.length > 1 && ["h", "v"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        alignSelectedNodes(event.key.toLowerCase() === "h" ? "horizontal" : "vertical");
        return;
      }
      if (command && event.shiftKey && event.key.toLowerCase() === "c") {
        const ids = [...selectedIdsRef.current, ...selectedEdgeIdsRef.current];
        if (ids.length === 0) return;
        event.preventDefault();
        void navigator.clipboard.writeText(ids.join("\n"));
        return;
      }
      if (command && !event.shiftKey && event.key.toLowerCase() === "c") {
        if (selectedIdsRef.current.length === 0 && selectedEdgeIdsRef.current.length === 0) return;
        event.preventDefault(); copySelectedObjects(); return;
      }
      if (command && !event.shiftKey && event.key.toLowerCase() === "v" && boardClipboardRef.current) {
        event.preventDefault();
        objectPastePendingRef.current = true;
        window.setTimeout(() => { objectPastePendingRef.current = false; }, 250);
        pasteCopiedObjects();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setSpaceSelecting(true);
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && selectedIdsRef.current.length > 0) {
        event.preventDefault();
        deleteItems([...selectedIdsRef.current]);
      } else if ((event.key === "Backspace" || event.key === "Delete") && selectedEdgeIdsRef.current.length > 0) {
        event.preventDefault();
        deleteEdges([...selectedEdgeIdsRef.current]);
      }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpaceSelecting(false); if (event.key === "Shift") { shiftPressedRef.current = false; dragAxisRef.current = null; } };
    const clearSpaceMode = () => { setSpaceSelecting(false); shiftPressedRef.current = false; dragAxisRef.current = null; };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", clearSpaceMode);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clearSpaceMode);
    };
  }, [alignSelectedNodes, copySelectedObjects, deleteEdges, deleteItems, pasteCopiedObjects, runHistory]);

  const connect = useCallback((connection: Connection) => {
    if (!workspace || !connection.source || !connection.target) return;
    const id = crypto.randomUUID(); const edge = new Y.Map<unknown>();
    Object.entries({ id, source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle ?? "right", targetHandle: connection.targetHandle ?? "left", animated: false, label: "", lineType: "bezier", strokeWidth: 2, dashed: false, startMarker: "none", endMarker: "arrow", color: DEFAULT_EDGE_COLOR, locked: false }).forEach(([key, value]) => edge.set(key, value));
    workspace.doc.transact(() => workspace.edgesMap.set(id, edge), localOrigin);
  }, [workspace]);

  const reconnect = useCallback((edge: Edge, connection: Connection) => {
    if (!workspace) return;
    const item = workspace.edgesMap.get(edge.id);
    if (!item) throw new Error(`矢印 ${edge.id} は存在しません。`);
    if (item.get("locked")) return;
    if (!connection.source || !connection.target) throw new Error("矢印の付け替え先が不正です。");
    if (!workspace.nodesMap.has(connection.source) || !workspace.nodesMap.has(connection.target)) throw new Error("矢印の付け替え先オブジェクトが存在しません。");
    const validHandles = new Set(["top", "right", "bottom", "left"]);
    const sourceHandle = connection.sourceHandle ?? "right";
    const targetHandle = connection.targetHandle ?? "left";
    if (!validHandles.has(sourceHandle) || !validHandles.has(targetHandle)) throw new Error("矢印はオブジェクトの上下左右の接続点へ付け替えてください。");
    workspace.doc.transact(() => {
      item.set("source", connection.source);
      item.set("target", connection.target);
      item.set("sourceHandle", sourceHandle);
      item.set("targetHandle", targetHandle);
    }, localOrigin);
    workspace.undoManager.stopCapturing();
  }, [workspace]);

  const updateEdge = (edgeId: string, values: Record<string, unknown>) => {
    if (!workspace) return; const edge = workspace.edgesMap.get(edgeId); if (!edge) return;
    workspace.doc.transact(() => Object.entries(values).forEach(([key, value]) => edge.set(key, value)), localOrigin);
  };

  const duplicateEdge = (edgeId: string) => {
    if (!workspace) return;
    const source = workspace.edgesMap.get(edgeId); if (!source) return;
    const id = crypto.randomUUID(); const copy = new Y.Map<unknown>();
    source.forEach((value, key) => copy.set(key, value)); copy.set("id", id); copy.set("label", source.get("label") ? `${String(source.get("label"))} コピー` : "");
    workspace.doc.transact(() => workspace.edgesMap.set(id, copy), localOrigin);
    selectedEdgeIdsRef.current = [id]; setSelectedEdgeIds([id]);
  };

  const finishDrawing = () => {
    if (!workspace || draftDrawing.length < 2) { setDraftDrawing([]); return; }
    const flowPoints = draftDrawing.map((point) => flow?.screenToFlowPosition(point) ?? point);
    const minX = Math.min(...flowPoints.map((point) => point.x)); const minY = Math.min(...flowPoints.map((point) => point.y));
    const maxX = Math.max(...flowPoints.map((point) => point.x)); const maxY = Math.max(...flowPoints.map((point) => point.y));
    const width = Math.max(20, maxX - minX); const height = Math.max(20, maxY - minY); const id = crypto.randomUUID();
    const path = flowPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${((point.x - minX) / width) * 1000} ${((point.y - minY) / height) * 1000}`).join(" ");
    const item = createYNode(id, "drawing", "手書き", penColor, minX, minY); item.set("drawingPath", path); item.set("drawingStrokeWidth", penWidth); item.set("drawingBrush", penBrush); item.set("width", width); item.set("height", height);
    workspace.doc.transact(() => workspace.nodesMap.set(id, item), localOrigin); setDraftDrawing([]);
  };

  const duplicateSelected = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    selectedIdsRef.current.forEach((id) => setEditing(id, false));
    setNodeSettingsOpen(false);
    const clipboard = snapshotSelection(selectedIds, selectedEdgeIds);
    const target = flow ? requireFinitePoint(flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }), "画面中央の座標") : null;
    if (clipboard && target) pasteSelection(clipboard, target);
  };

  const addComment = (targetId: string | null) => {
    if (!workspace || !targetId || !commentText.trim()) return;
    const id = crypto.randomUUID(); const comment = new Y.Map<unknown>();
    Object.entries({ id, nodeId: targetId, text: commentText.trim(), author: currentUser.name, createdAt: new Date().toISOString(), resolved: false })
      .forEach(([key, value]) => comment.set(key, value));
    workspace.doc.transact(() => workspace.commentsMap.set(id, comment), localOrigin);
    setCommentText("");
    setCommentComposerTargetId(null);
  };

  const resolveComment = (id: string) => {
    const comment = workspace?.commentsMap.get(id); if (!comment || !workspace) return;
    workspace.doc.transact(() => comment.set("resolved", !Boolean(comment.get("resolved"))), localOrigin);
  };

  const deleteComment = (id: string) => {
    if (!workspace || !workspace.commentsMap.has(id)) throw new Error(`コメント ${id} は存在しません。`);
    workspace.doc.transact(() => workspace.commentsMap.delete(id), localOrigin);
    setCommentActionMenuId(null);
    setCommentDeleteDialog(null);
  };

  const openCommentComposer = (targetId: string) => {
    setNodeSettingsOpen(false);
    setCommentText("");
    setCommentComposerTargetId((current) => current === targetId ? null : targetId);
  };

  const applyTemplate = (template: "brainstorm" | "kanban" | "retro") => {
    if (!workspace) return;
    const base = flow?.screenToFlowPosition({ x: window.innerWidth / 2 - 300, y: window.innerHeight / 2 - 180 }) ?? { x: 100, y: 100 };
    workspace.doc.transact(() => {
      if (template === "brainstorm") {
        addNode("frame", base, "ブレインストーミング", "#f5f2ff");
        ["課題", "アイデア", "次の一歩"].forEach((text, index) => addNode("sticky", { x: base.x + 55 + index * 175, y: base.y + 120 }, text, palette[index]));
      } else {
        const titles = template === "kanban" ? ["未着手", "進行中", "完了"] : ["よかった", "課題", "次に試す"];
        addNode("frame", base, template === "kanban" ? "カンバン" : "振り返り", "#f5f2ff");
        titles.forEach((text, index) => {
          addNode("text", { x: base.x + 50 + index * 180, y: base.y + 72 }, text, "#ffffff");
          addNode(template === "kanban" ? "card" : "sticky", { x: base.x + 50 + index * 180, y: base.y + 145 }, template === "kanban" ? "タスクを追加" : "メモを追加", palette[index + 1]);
        });
      }
    }, localOrigin);
    setTemplateOpen(false); window.setTimeout(() => flow?.fitView({ padding: 0.2, duration: 400 }), 100);
  };

  const changeTitle = (value: string) => { setTitle(value); workspace?.doc.transact(() => workspace.meta.set("title", value), localOrigin); };
  const setTimerDuration = (minutes: number) => {
    const normalized = Math.max(1, Math.min(180, Math.round(minutes)));
    setTimerMinutes(normalized);
    workspace?.doc.transact(() => workspace.meta.set("timerDurationMinutes", String(normalized)), localOrigin);
  };
  const startTimer = () => {
    if (!workspace) return;
    setTimerHasElapsed(false);
    workspace.doc.transact(() => {
      workspace.meta.set("timerRunId", crypto.randomUUID());
      workspace.meta.set("timerEnd", String(Date.now() + timerMinutes * 60000));
      workspace.meta.set("timerNoticeId", "");
      workspace.meta.set("timerNoticeReason", "");
    }, localOrigin);
  };
  const stopTimer = () => {
    if (!workspace || timerEnd <= 0) return;
    workspace.doc.transact(() => {
      workspace.meta.set("timerEnd", "0");
      workspace.meta.set("timerNoticeId", crypto.randomUUID());
      workspace.meta.set("timerNoticeReason", "stopped");
    }, localOrigin);
  };
  const share = async () => {
    const boardUrl = new URL("/", window.location.origin);
    boardUrl.searchParams.set("room", room);
    await navigator.clipboard.writeText(boardUrl.toString());
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };
  const exportBoard = async (boardId = room) => {
    let payload: unknown;
    let fileTitle: string;
    if (boardId === room) {
      if (!workspace) throw new Error("現在のボードを読み込めていません。");
      payload = {
      format: "renraku-gakari-board", formatVersion: 2, boardId: room, title,
      preview: { databases: managedDatabases, itemCount: nodes.length, connectorCount: edges.length, commentCount: comments.length },
      state: {
        nodes: Array.from(workspace.nodesMap.entries()).map(([id, item]) => [id, serializeYMap(item)]),
        databases: Array.from(workspace.databasesMap.entries()).map(([id, database]) => [id, serializeYMap(database)]),
        edges: Array.from(workspace.edgesMap.entries()).map(([id, edge]) => [id, serializeYMap(edge)]),
        comments: Array.from(workspace.commentsMap.entries()).map(([id, comment]) => [id, serializeYMap(comment)]),
        meta: Array.from(workspace.meta.entries()),
        permissions: Array.from(workspace.permissionsMap.entries()),
        events: workspace.events.toArray().map((event) => serializeYMap(event)),
      },
      };
      fileTitle = title;
    } else {
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}?download=1`);
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error ?? "ボードを書き出せませんでした。");
      }
      payload = await response.json();
      fileTitle = boardTitles[boardId] ?? "board";
    }
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.download = `${fileTitle || "board"}.json`; link.click(); URL.revokeObjectURL(link.href);
  };

  const renameBoard = async (boardId: string, value: string) => {
    const nextTitle = value.trim();
    if (!nextTitle || nextTitle.length > 80) { setBoardDeleteError("ボード名は1〜80文字で入力してください。"); return; }
    setBoardDeleteError("");
    if (boardId === room) changeTitle(nextTitle);
    else {
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nextTitle }) });
      const payload = await response.json() as { title?: string; error?: string };
      if (!response.ok) { setBoardDeleteError(payload.error ?? "ボード名を変更できませんでした。"); return; }
    }
    setBoardTitles((current) => ({ ...current, [boardId]: nextTitle }));
    setBoardRenameDialog(null);
    setBoardActionMenuId(null);
  };

  const closeActionsMenu = () => {
    setActionsMenuOpen(false);
    setTimerMenuOpen(false);
    setPeopleOpen(false);
  };

  const importBoard = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setBoardDeleteError("");
    const targetBoardId = boardImportId.trim();
    if (!safeBoardId.test(targetBoardId)) { setBoardDeleteError("インポート先のボードIDを英数字・ハイフン・アンダースコアの64文字以内で入力してください。"); return; }
    if (file.size > 10 * 1024 * 1024) { setBoardDeleteError("インポートファイルは10MB以下にしてください。"); return; }
    let payload: unknown;
    try { payload = JSON.parse(await file.text()); }
    catch { setBoardDeleteError("JSONファイルの形式が不正です。"); return; }
    if (!payload || typeof payload !== "object" || !("format" in payload) || payload.format !== "renraku-gakari-board" || !("formatVersion" in payload) || ![2, 3].includes(Number(payload.formatVersion))) {
      setBoardDeleteError("れんらくがかりのボード書き出しファイルを選択してください。"); return;
    }
    const formatVersion = Number(payload.formatVersion);
    const state = "state" in payload && payload.state && typeof payload.state === "object" ? payload.state as Record<string, unknown> : null;
    const mapEntries = (key: string) => {
      if (!state) throw new Error("ボード状態がありません。");
      const value = state[key];
      if (!Array.isArray(value) || value.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1]))) throw new Error(`${key}の形式が不正です。`);
      return value as Array<[string, SerializedYMap]>;
    };
    let nodesToImport: Array<[string, SerializedYMap]> = []; let databasesToImport: Array<[string, SerializedYMap]> = []; let edgesToImport: Array<[string, SerializedYMap]> = []; let commentsToImport: Array<[string, SerializedYMap]> = [];
    let stateUpdate = "";
    try {
      if (formatVersion === 2) {
        nodesToImport = mapEntries("nodes"); databasesToImport = mapEntries("databases"); edgesToImport = mapEntries("edges"); commentsToImport = mapEntries("comments");
        if (!state || !Array.isArray(state.meta) || !Array.isArray(state.permissions) || !Array.isArray(state.events)) throw new Error("共有設定の形式が不正です。");
      } else {
        stateUpdate = "stateUpdate" in payload && typeof payload.stateUpdate === "string" ? payload.stateUpdate : "";
        if (!stateUpdate || !/^[A-Za-z0-9+/]+={0,2}$/.test(stateUpdate)) throw new Error("ボード状態の形式が不正です。");
      }
    } catch (error) { setBoardDeleteError(error instanceof Error ? error.message : "インポートデータの形式が不正です。"); return; }

    const importedDoc = new Y.Doc();
    let markSynced: (() => void) | undefined;
    const syncedPromise = new Promise<void>((resolve) => { markSynced = resolve; });
    const importedProvider = new HocuspocusProvider({ url: process.env.NEXT_PUBLIC_COLLAB_URL ?? "ws://localhost:1234", name: targetBoardId, document: importedDoc, token: collaborationToken, onSynced: () => markSynced?.() });
    try {
      await Promise.race([syncedPromise, new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("共同編集サーバーへ接続できませんでした。")), 5000))]);
      const importedNodes = importedDoc.getMap<Y.Map<unknown>>("nodes"); const importedDatabases = importedDoc.getMap<Y.Map<unknown>>("miniDatabases"); const importedEdges = importedDoc.getMap<Y.Map<unknown>>("edges"); const importedComments = importedDoc.getMap<Y.Map<unknown>>("comments"); const importedMeta = importedDoc.getMap<string>("meta"); const importedPermissions = importedDoc.getMap<string>("mcpPermissions"); const importedEvents = importedDoc.getArray<Y.Map<unknown>>("agentEvents");
      if (importedNodes.size || importedDatabases.size || importedEdges.size || importedComments.size || importedMeta.size) throw new Error("インポート先のボードIDは既に使用されています。別のIDを入力してください。");
      if (formatVersion === 3) {
        const binary = window.atob(stateUpdate);
        Y.applyUpdate(importedDoc, Uint8Array.from(binary, (character) => character.charCodeAt(0)), localOrigin);
      } else importedDoc.transact(() => {
          nodesToImport.forEach(([id, entries]) => importedNodes.set(id, deserializeYMap(entries)));
          databasesToImport.forEach(([id, entries]) => importedDatabases.set(id, deserializeYMap(entries)));
          edgesToImport.forEach(([id, entries]) => importedEdges.set(id, deserializeYMap(entries)));
          commentsToImport.forEach(([id, entries]) => importedComments.set(id, deserializeYMap(entries)));
          (state?.meta as Array<[string, string]>).forEach(([key, value]) => { if (typeof key !== "string" || typeof value !== "string") throw new Error("metaの形式が不正です。"); importedMeta.set(key, value); });
          (state?.permissions as Array<[string, string]>).forEach(([key, value]) => { if (typeof key !== "string" || typeof value !== "string") throw new Error("permissionsの形式が不正です。"); importedPermissions.set(key, value); });
          (state?.events as SerializedYMap[]).forEach((entries) => { if (!Array.isArray(entries)) throw new Error("eventsの形式が不正です。"); importedEvents.push([deserializeYMap(entries)]); });
        }, localOrigin);
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const nextBoards = Array.from(new Set([targetBoardId, ...knownBoards]));
      window.localStorage.setItem("mingleboard:boards", JSON.stringify(nextBoards)); setKnownBoards(nextBoards); setBoardImportId("");
      switchBoard(targetBoardId);
    } catch (error) { setBoardDeleteError(error instanceof Error ? error.message : "ボードをインポートできませんでした。"); }
    finally { importedProvider.destroy(); importedDoc.destroy(); }
  };

  const remotePresence = useMemo(() => collaborationUiSuppressed ? [] : presence.filter((item) => item.clientId !== workspace?.doc.clientID && item.user), [collaborationUiSuppressed, presence, workspace]);
  const agentOwners = useMemo(() => Array.from(new Set(agentEvents.map((event) => event.ownerName ?? "所有者記録なし"))), [agentEvents]);
  const visibleAgentEvents = agentOwnerFilter === "all" ? agentEvents : agentEvents.filter((event) => (event.ownerName ?? "所有者記録なし") === agentOwnerFilter);
  const visibleComments = comments;
  const selectionOnlyMode = spaceSelecting || selectionToolActive;
  const displayedNodes = useMemo(() => nodes.map((node) => {
    const searchable = [node.data.text, ...node.data.databaseRecords.flatMap((record) => Object.values(record.values))].join(" ").toLowerCase();
    const editingBy = remoteEditors[node.id];
    return { ...node, draggable: !node.data.locked && !editingBy && !fullscreenDatabaseId, data: { ...node.data, editingBy, showCollaborationIndicators: !collaborationUiSuppressed, selectionOnly: selectionOnlyMode, fullscreen: fullscreenDatabaseId === node.id }, className: search && !searchable.includes(search.toLowerCase()) ? "search-dimmed" : "" };
  }), [collaborationUiSuppressed, fullscreenDatabaseId, nodes, remoteEditors, search, selectionOnlyMode]);
  const selectedNode = nodes.find((node) => node.id === selectedIds[0]);
  const selectedEdge = selectedEdgeIds.length === 1 ? workspace?.edgesMap.get(selectedEdgeIds[0]) : undefined;
  const textLayoutIds = nodes.filter((node) => selectedIds.includes(node.id) && ["sticky", "text", "shape"].includes(node.data.kind)).map((node) => node.id);
  const timerLabel = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
  const finishedTimerNoticeId = timerHasElapsed ? `finished:${timerRunId || timerEnd}` : "";
  const sharedTimerNoticeId = timerNoticeReason === "stopped" && timerNoticeId ? `stopped:${timerNoticeId}` : finishedTimerNoticeId;
  const activeTimerNotice = sharedTimerNoticeId && !dismissedTimerNoticeIds.includes(sharedTimerNoticeId)
    ? { id: sharedTimerNoticeId, reason: sharedTimerNoticeId.startsWith("stopped:") ? "stopped" as const : "finished" as const }
    : null;
  const permissionGroupValue = (access: "read" | "write") => {
    const values = new Set(mcpTools.filter((tool) => tool.access === access).map((tool) => mcpPermissions[tool.name] ?? (tool.access === "read" ? "always_allow" : "require_approval")));
    return values.size === 1 ? Array.from(values)[0] : "mixed";
  };

  if (!workspace) return <main className="loading-screen"><Sparkles size={28} /><span>ボードを準備しています…</span></main>;
  const editingEdge = edgeMenu ? workspace.edgesMap.get(edgeMenu.edgeId) : undefined;
  const edgeLineType = String(editingEdge?.get("lineType") ?? "bezier");
  const edgeStrokeWidth = Number(editingEdge?.get("strokeWidth") ?? 2);
  const edgeDashed = Boolean(editingEdge?.get("dashed"));
  const edgeStartMarker = String(editingEdge?.get("startMarker") ?? "none");
  const edgeEndMarker = String(editingEdge?.get("endMarker") ?? "arrow");
  const editingLine = lineMenu ? workspace.nodesMap.get(lineMenu.nodeId) : undefined;
  const lineStrokeWidth = Number(editingLine?.get("lineStrokeWidth") ?? 2);
  const lineDashed = Boolean(editingLine?.get("lineDashed"));
  const lineColor = String(editingLine?.get("color") ?? "#7466d9");
  const boardLabel = (boardId: string) => boardId === room ? title.trim() || "無題のボード" : boardTitles[boardId] ?? "読み込み中…";

  const renderManagedDatabaseDropZone = (insertionIndex: number) => <div
    className={`managed-database-drop-zone ${draggedManagedDatabase?.insertionIndex === insertionIndex ? "is-active" : ""}`}
    data-insertion-index={insertionIndex}
    aria-hidden="true"
    onDragOver={(event) => {
      if (!draggedManagedDatabase) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDraggedManagedDatabase((current) => current ? { ...current, insertionIndex } : current);
    }}
    onDrop={(event) => {
      event.preventDefault();
      if (!draggedManagedDatabase) return;
      reorderManagedDatabase(draggedManagedDatabase.id, insertionIndex);
      setDraggedManagedDatabase(null);
    }}
  />;

  return (
    <main
      className={`app-shell ${fullscreenDatabaseId ? "is-database-fullscreen" : ""} ${fullscreenDatabaseId && databaseQuerySheet?.nodeId === fullscreenDatabaseId ? "has-database-query-sheet" : ""}`}
      style={databaseQuerySheet ? { "--database-query-sheet-height": `${databaseQuerySheet.height}px` } as React.CSSProperties : undefined}
      onPointerDownCapture={() => workspace.undoManager.stopCapturing()}
      onPointerUpCapture={() => workspace.undoManager.stopCapturing()}
    >
      <header className={`topbar ${actionsMenuOpen || searchOpen || boardMenuOpen ? "topbar--popover-open" : ""}`}>
        <div className="topbar__identity">
          <Popover open={boardMenuOpen} onOpenChange={(open) => { setBoardMenuOpen(open); if (!open) setBoardActionMenuId(null); }}><PopoverTrigger render={<Button size="sm" variant="outline" className="board-switcher__trigger" title="ボードを切り替える" />}><span>{boardLabel(room)}</span><ChevronDown /></PopoverTrigger>
            <PopoverContent align="start" className="board-switcher__menu !relative !top-auto !left-auto w-80">
              <strong>ボードを切り替え</strong>
              <div className="board-switcher__list">{knownBoards.map((boardId) => <div className={`board-switcher__item ${boardId === room ? "is-active" : ""}`} key={boardId}>
                <Button variant="ghost" className="board-switcher__select" onClick={() => boardId === room ? setBoardMenuOpen(false) : switchBoard(boardId)}><span>{boardLabel(boardId)}</span></Button>
                <Popover open={boardActionMenuId === boardId} onOpenChange={(open) => setBoardActionMenuId(open ? boardId : null)}><PopoverTrigger render={<Button size="icon-sm" variant="ghost" className="board-switcher__more" aria-label={`${boardLabel(boardId)}のメニュー`} title="ボードの操作" />}><MoreHorizontal /></PopoverTrigger><PopoverContent side="right" align="start" className="board-item-menu w-52 p-1">
                  <Button variant="ghost" onClick={() => { setBoardDeleteError(""); setBoardRenameDialog({ boardId, value: boardLabel(boardId) }); setBoardActionMenuId(null); }}><Pencil />名前を変更</Button>
                  <Button variant="ghost" onClick={() => { setBoardActionMenuId(null); void exportBoard(boardId).catch((error) => setBoardDeleteError(error instanceof Error ? error.message : "ボードを書き出せませんでした。")); }}><Download />ファイルを書き出す</Button>
                  <Button variant="ghost" className="board-item-menu__delete" onClick={() => { setBoardDeleteError(""); setBoardActionMenuId(null); setBoardDeleteCandidate(boardId); }}><Trash2 />ボードを削除</Button>
                </PopoverContent></Popover>
              </div>)}</div>
              {boardDeleteError && <p className="board-delete-error">{boardDeleteError}</p>}
              <section className="board-add-section"><span>新規作成</span><form onSubmit={(event) => { event.preventDefault(); joinBoard(newBoardId); }}><Input aria-label="新しいボードID" value={newBoardId} onChange={(event) => setNewBoardId(event.target.value)} placeholder="new-board" /><Button type="submit" size="icon" disabled={!newBoardId.trim()} title="新しいボードを作成"><Plus /></Button></form></section>
              <section className="board-add-section"><span>ID・共有URLで参加</span><form onSubmit={(event) => { event.preventDefault(); joinBoard(boardJoinValue); }}><Input aria-label="参加するボードIDまたは共有URL" value={boardJoinValue} onChange={(event) => setBoardJoinValue(event.target.value)} placeholder="board-id または https://…" /><Button type="submit" size="icon" disabled={!boardJoinValue.trim()} title="ボードへ参加"><Link2 /></Button></form></section>
              <section className="board-add-section"><span>JSONから追加</span><form onSubmit={(event) => { event.preventDefault(); boardImportInputRef.current?.click(); }}><Input aria-label="インポート先のボードID" value={boardImportId} onChange={(event) => setBoardImportId(event.target.value)} placeholder="imported-board" /><Button type="submit" size="icon" disabled={!boardImportId.trim()} title="書き出しファイルを選択"><Upload /></Button></form><input ref={boardImportInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => void importBoard(event)} /></section>
            </PopoverContent>
          </Popover>
        </div>
        <div className="topbar__actions">
          <div className="avatars">{presence.slice(0, 4).map((item) => <span key={item.clientId} className="avatar" style={{ background: item.user?.color ?? "#999" }}>{item.user?.name?.slice(0, 1) ?? "?"}</span>)}</div>
          <Popover open={searchOpen} onOpenChange={setSearchOpen}><PopoverTrigger render={<Button size="icon" variant="ghost" aria-label="ボード内検索を開く" />}><Search /></PopoverTrigger><PopoverContent align="end" className="w-80"><div className="flex items-center gap-2"><Search className="size-4 text-muted-foreground" /><Input autoFocus aria-label="ボード内検索" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="オブジェクト・データベースを検索" />{search && <Button size="icon-sm" variant="ghost" onClick={() => setSearch("")} aria-label="検索を消去"><X /></Button>}</div></PopoverContent></Popover>
          <Popover open={actionsMenuOpen} onOpenChange={(open) => open ? setActionsMenuOpen(true) : closeActionsMenu()}><PopoverTrigger render={<Button size="icon" variant="ghost" aria-label="ボードメニューを開く" />}><Menu /></PopoverTrigger><PopoverContent align="end" className="header-actions-popover !relative !top-auto !right-auto w-80 p-2">
            <div className="timer-menu">
              <Button variant="ghost" className="header-menu-row" onClick={() => { const next = !timerMenuOpen; setTimerMenuOpen(next); if (next) setPeopleOpen(false); }} aria-expanded={timerMenuOpen}><Timer /><span><strong>タイマー</strong><small>{remainingSeconds ? `${timerLabel}・実行中` : `${String(timerMinutes).padStart(2, "0")}:00`}</small></span><ChevronDown /></Button>
              {timerMenuOpen && <div className="timer-popover"><header><strong>タイマー時間</strong></header><div className="timer-presets">{[1, 5, 10, 15, 25, 30, 60].map((minutes) => <Button size="sm" variant={timerMinutes === minutes ? "default" : "outline"} key={minutes} onClick={() => setTimerDuration(minutes)}>{minutes}分</Button>)}</div><label><span>カスタム</span><NumericStepper ariaLabel="タイマーの分数" min={1} max={180} value={timerMinutes} onChange={setTimerDuration} /><small>分</small></label><Button className="w-full" onClick={() => { startTimer(); closeActionsMenu(); }}>この時間で開始</Button>{remainingSeconds > 0 && <Button className="w-full" variant="destructive" onClick={() => { stopTimer(); setTimerMenuOpen(false); }}>タイマーを停止</Button>}</div>}
            </div>
            <div className="people-menu"><Button variant="ghost" className="header-menu-row" onClick={() => { const next = !peopleOpen; setPeopleOpen(next); if (next) setTimerMenuOpen(false); }} aria-expanded={peopleOpen}><Users /><span><strong>参加ユーザー</strong><small>{presence.length || 1}人が接続中</small></span><ChevronDown /></Button>{peopleOpen && <div className="people-popover"><header><strong>参加ユーザー</strong><span>{presence.length || 1}人が接続中</span></header>{(presence.length ? presence : [{ clientId: workspace.doc.clientID, user: currentUser }]).map((item) => <div key={item.clientId}><span className="participant-avatar" style={{ background: item.user?.color ?? "#999" }}>{item.user?.name?.slice(0, 1) ?? "?"}</span><span><strong>{item.user?.name ?? "名前未設定"}</strong><small>{item.user?.address ?? (item.user?.type === "agent" ? "AIエージェント" : item.clientId === workspace.doc.clientID ? "あなた" : "共同編集者")}</small></span><i /></div>)}</div>}</div>
            <Button variant="ghost" className="header-menu-row" onClick={() => { closeActionsMenu(); router.push("/account"); }}><KeyRound /><span><strong>アカウント設定</strong><small>パスワードを変更</small></span></Button>
            {user.isAdmin && <Button variant="ghost" className="header-menu-row" onClick={() => { closeActionsMenu(); router.push("/admin"); }}><UserCog /><span><strong>ユーザー管理</strong><small>{currentUser.address}</small></span></Button>}
            <Button variant="ghost" className="header-menu-row" onClick={() => { setRightPanel(rightPanel === "agent" ? null : "agent"); closeActionsMenu(); }}><Bot /><span><strong>AIエージェント設定</strong><small>MCPツールと権限</small></span></Button>
            <Button variant="ghost" className="header-menu-row" onClick={() => { setHelpOpen(true); closeActionsMenu(); }}><CircleHelp /><span><strong>使い方</strong><small>操作方法とショートカット</small></span></Button>
            <Button variant="ghost" className="header-menu-row" onClick={() => { void exportBoard().catch((error) => setBoardDeleteError(error instanceof Error ? error.message : "ボードを書き出せませんでした。")); closeActionsMenu(); }}><Download /><span><strong>ダウンロード</strong><small>ボードをJSONで書き出す</small></span></Button>
            <Button variant="ghost" className="header-menu-row" onClick={() => { void share(); closeActionsMenu(); }}><Share2 /><span><strong>共有</strong><small>現在のボードURLをコピー</small></span></Button>
            <Button variant="ghost" className="header-menu-row" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); }}><LogOut /><span><strong>ログアウト</strong><small>{currentUser.name}</small></span></Button>
            {copied && <span className="share-feedback share-feedback--menu">ボードURLをコピーしました</span>}
          </PopoverContent></Popover>
        </div>
      </header>
      <Dialog open={boardRenameDialog !== null} onOpenChange={(open) => { if (!open) setBoardRenameDialog(null); }}><DialogContent className="sm:max-w-md"><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (boardRenameDialog) void renameBoard(boardRenameDialog.boardId, boardRenameDialog.value); }}><DialogHeader><DialogTitle>ボード名を変更</DialogTitle><DialogDescription className="sr-only">ボード選択に表示する名前を変更します。</DialogDescription></DialogHeader><div className="grid gap-2"><Label htmlFor="board-rename">ボード名</Label><Input id="board-rename" autoFocus maxLength={80} value={boardRenameDialog?.value ?? ""} onChange={(event) => boardRenameDialog && setBoardRenameDialog({ ...boardRenameDialog, value: event.target.value })} /></div>{boardDeleteError && <p className="board-delete-error">{boardDeleteError}</p>}<DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>キャンセル</DialogClose><Button type="submit">変更</Button></DialogFooter></form></DialogContent></Dialog>
      <DeleteConfirmationDialog open={boardDeleteCandidate !== null} itemName={boardDeleteCandidate ? boardLabel(boardDeleteCandidate) : ""} error={boardDeleteError} onOpenChange={(open) => { if (!open) setBoardDeleteCandidate(null); }} onConfirm={() => boardDeleteCandidate && void deleteBoard(boardDeleteCandidate)} />
      {remainingSeconds > 0 && <Button className="running-timer" onClick={stopTimer} title="クリックしてタイマーを停止"><Timer /><span>{timerLabel}</span></Button>}
      <AlertDialog open={activeTimerNotice !== null}><AlertDialogContent><div className="flex items-center justify-between"><span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><Timer /></span><Button size="icon-sm" variant="ghost" aria-label="タイマー通知を閉じる" onClick={() => activeTimerNotice && setDismissedTimerNoticeIds((current) => [...current, activeTimerNotice.id])}><X /></Button></div><AlertDialogHeader><AlertDialogTitle>{activeTimerNotice?.reason === "finished" ? "時間です" : "タイマーを停止しました"}</AlertDialogTitle><AlertDialogDescription>{activeTimerNotice?.reason === "finished" ? "設定した時間が終了しました。次の進行へ移るか、同じ時間でもう一度開始できます。" : "ボードの共有タイマーが停止されました。同じ時間でもう一度開始できます。"}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><Button variant="outline" onClick={() => { if (!activeTimerNotice) return; startTimer(); setDismissedTimerNoticeIds((current) => [...current, activeTimerNotice.id]); }}><RefreshCw />同じ時間で再スタート</Button><Button onClick={() => activeTimerNotice && setDismissedTimerNoticeIds((current) => [...current, activeTimerNotice.id])}>了解</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <div className="left-tools-wrap"><aside ref={leftToolsRef} className="left-tools" aria-label="作成ツール" onWheel={scrollCreationTools}>
        <button className={`tool ${selectionToolActive ? "is-active" : ""}`} onClick={() => { setToolMode("select"); setSelectionToolActive((active) => !active); }} title={selectionToolActive ? "選択モードを終了" : "選択モード（Space長押しと同じ）"}><MousePointer2 /></button>
        <button className={`tool ${toolMode === "pen" ? "is-active" : ""}`} onClick={() => { setSelectionToolActive(false); setToolMode(toolMode === "pen" ? "select" : "pen"); }} title="ペン"><PenLine /></button>
        <button className={`tool ${toolMode === "eraser" ? "is-active" : ""}`} onClick={() => { setSelectionToolActive(false); setToolMode(toolMode === "eraser" ? "select" : "eraser"); }} title="消しゴム"><Eraser /></button><span className="tool-divider" />
        <button draggable className="tool tool--sticky" onDragStart={(event) => beginToolDrag(event, "sticky")} onClick={() => addNode("sticky")} title="付箋（ドラッグ配置対応）"><StickyNote /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "shape")} onClick={() => addNode("shape")} title="図形（ドラッグ配置対応）"><Diamond /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "line")} onClick={() => addNode("line")} title="線（ドラッグ配置対応）"><Minus /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "link")} onClick={() => addNode("link")} title="URLリンク（貼り付けにも対応）"><Link2 /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "text")} onClick={() => addNode("text")} title="テキスト（ドラッグ配置対応）"><Type /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "card")} onClick={() => addNode("card")} title="カード（ドラッグ配置対応）"><KanbanSquare /></button>
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "frame")} onClick={() => addNode("frame")} title="フレーム（ドラッグ配置対応）"><Square /></button>
        <span className="tool-divider" />
        <button draggable className="tool" onDragStart={(event) => beginToolDrag(event, "database")} onClick={() => addNode("database")} title="データベースオブジェクト（ドラッグ配置対応）"><Table2 /></button>
        <button className="tool" onClick={() => { setOpenManagedDatabaseIds([]); setDataManagerOpen(true); loadDataManager(); }} title="データベース管理" aria-label="データベース管理"><Database /></button>
        <span className="tool-divider" /><button className="tool" onClick={() => setTemplateOpen(true)} title="テンプレート"><LayoutTemplate /></button>
        <button className={`tool ${rightPanel === "comments" ? "is-active" : ""}`} onClick={() => { setCommentComposerTargetId(null); setRightPanel("comments"); }} title="コメント一覧" aria-label="コメント一覧を開く"><MessageCircle /></button>
      </aside>{toolScrollIndicator.visible && <span className={`left-tools-scroll-indicator is-${toolScrollIndicator.axis}`} aria-hidden="true"><i style={toolScrollIndicator.axis === "horizontal" ? { width: toolScrollIndicator.length, transform: `translateX(${toolScrollIndicator.offset}px)` } : { height: toolScrollIndicator.length, transform: `translateY(${toolScrollIndicator.offset}px)` }} /></span>}</div>

      <input ref={frameImageInputRef} className="visually-hidden" type="file" accept="image/*" onChange={setFrameImage} />

      {toolMode === "pen" ? <div className="context-toolbar pen-toolbar" aria-label="ペン設定" onPointerDown={(event) => event.stopPropagation()}>
        <PenLine aria-hidden="true" /><div className="color-picker">{inkPalette.map((color) => <button key={color} aria-label={`ペンの色 ${color}`} className={penColor === color ? "is-active" : ""} style={{ background: color }} onClick={() => setPenColor(color)} />)}</div><span className="toolbar-divider" />
        <div className="pen-width-options" role="group" aria-label="ペンの太さ">{[2, 4, 8, 16].map((width) => <button key={width} className={penWidth === width ? "is-active" : ""} aria-label={`ペンの太さ ${width}`} onClick={() => setPenWidth(width)}><i style={{ height: Math.min(width, 12) }} /></button>)}</div><span className="toolbar-divider" />
        <UiSelect ariaLabel="ブラシの種類" value={penBrush} onChange={(value) => setPenBrush(value as "pen" | "marker" | "highlighter")} options={[{ value: "pen", label: "ペン" }, { value: "marker", label: "マーカー" }, { value: "highlighter", label: "蛍光ペン" }]} />
      </div> : selectedIds.length > 1 ? <div className="context-toolbar context-toolbar--multiple" aria-label="複数選択メニュー" onPointerDown={(event) => event.stopPropagation()}>
        <Button size="icon" variant="ghost" title="複製" onClick={duplicateSelected}><Copy /></Button>
        <Button size="icon" variant="destructive" title="削除" className="danger" onClick={() => deleteItems(selectedIds)}><Trash2 /></Button>
      </div> : selectedIds.length === 1 && selectedNode && <div className="context-toolbar" onPointerDown={(event) => event.stopPropagation()}>
        {selectedNode.data.locked ? <Button size="icon" variant="ghost" title="ロック解除" aria-label="オブジェクトのロックを解除" onClick={() => updateItems(selectedIds, { locked: false })}><Unlock /></Button> : <>
          {selectedNode.data.kind !== "text" && <div className="color-picker">{palette.map((color) => <button key={color} aria-label={`色 ${color}`} className={selectedNode.data.color === color ? "is-active" : ""} style={{ background: color }} onClick={() => updateItems(selectedIds, { color })} />)}</div>}
          {selectedNode.data.kind === "frame" && <><span className="toolbar-divider" /><Button size="icon" variant="ghost" title="フレーム背景画像" aria-label="フレーム背景画像を選択" onClick={() => frameImageInputRef.current?.click()}><ImagePlus /></Button><span className="toolbar-divider" /></>}
          <Button size="icon" variant="ghost" ref={nodeSettingsButtonRef} title="その他の設定" aria-label="オブジェクトのその他の設定" className={nodeSettingsOpen || lineMenu?.nodeId === selectedNode.id ? "is-active" : ""} onClick={() => {
            if (selectedNode.data.kind === "line") {
              setNodeSettingsOpen(false);
              setEdgeMenu(null);
              setLineMenu((current) => current?.nodeId === selectedNode.id ? null : { nodeId: selectedNode.id, x: Math.max(12, window.innerWidth / 2 - 132), y: 126 });
              return;
            }
            setLineMenu(null);
            setNodeSettingsOpen((open) => !open);
          }}><Settings2 /></Button>
          <Button size="icon" variant="ghost" title="複製" onClick={duplicateSelected}><Copy /></Button><Button size="icon" variant="ghost" title="ロック" onClick={() => { setEditing(selectedNode.id, false); setNodeSettingsOpen(false); updateItems(selectedIds, { locked: true }); }}><Lock /></Button>
          <Button size="icon" variant="ghost" title="コメントを追加" aria-label="コメントを追加" className={commentComposerTargetId === selectedNode.id ? "is-active" : ""} onClick={() => openCommentComposer(selectedNode.id)}><MessageCircle /></Button><Button size="icon" variant="destructive" title="削除" className="danger" onClick={() => deleteItems(selectedIds)}><Trash2 /></Button>
        </>}
      </div>}
      {nodeSettingsOpen && selectedNode && <div ref={nodeSettingsRef} className="node-settings-popover" onPointerDown={(event) => event.stopPropagation()}><div className="node-settings-popover__title">オブジェクト設定</div><div className="node-settings-popover__body">
        {selectedNode.data.kind === "shape" && <fieldset className="shape-kind-setting"><legend>図形の種類</legend><div>{[{ value: "rectangle", label: "四角" }, { value: "ellipse", label: "円" }, { value: "triangle", label: "三角" }, { value: "diamond", label: "ひし形" }].map((option) => <label key={option.value}><input type="radio" name={`shape-kind-${selectedNode.id}`} value={option.value} checked={selectedNode.data.shape === option.value} onChange={() => updateItems(selectedIds, { shape: option.value })} /><span>{option.label}</span></label>)}</div></fieldset>}
        {selectedNode.data.kind === "card" && <label><span>状態</span><UiSelect ariaLabel="カードの状態" value={selectedNode.data.status} onChange={(status) => updateItems(selectedIds, { status })} options={[{ value: "todo", label: "未着手" }, { value: "doing", label: "進行中" }, { value: "done", label: "完了" }]} /></label>}
        {selectedNode.data.kind === "frame" && (selectedNode.data.frameImage ? <div className="frame-image-settings"><label><span>背景画像の表示方法</span><UiSelect ariaLabel="背景画像の表示方法" value={selectedNode.data.frameImageFit} onChange={(frameImageFit) => updateItems(selectedIds, { frameImageFit })} options={[{ value: "height", label: "縦幅合わせ" }, { value: "width", label: "横幅合わせ" }, { value: "stretch", label: "全面に引き伸ばす" }]} /></label><Button variant="destructive" onClick={() => updateItems(selectedIds, { frameImage: "" })}><Trash2 />背景画像を削除</Button></div> : <div className="frame-split-settings"><div className="frame-split-controls"><label><span>縦分割</span><NumericStepper ariaLabel="フレームの縦分割数" min={0} max={12} value={selectedNode.data.frameRows} onChange={(frameRows) => updateItems(selectedIds, { frameRows })} /></label><label><span>横分割</span><NumericStepper ariaLabel="フレームの横分割数" min={0} max={12} value={selectedNode.data.frameColumns} onChange={(frameColumns) => updateItems(selectedIds, { frameColumns })} /></label></div><label className="frame-grid-color"><span>分割線の色</span><input aria-label="フレーム分割線の色" type="color" value={selectedNode.data.frameGridColor} onChange={(event) => updateItems(selectedIds, { frameGridColor: event.target.value })} /></label></div>)}
        {selectedNode.data.kind !== "frame" && <div className="font-size-setting"><span>文字サイズ(Pt)</span><div><Input key={`${selectedNode.id}-${selectedNode.data.fontSize}`} aria-label="文字サイズを直接入力" type="number" inputMode="numeric" min={8} max={96} step={1} defaultValue={selectedNode.data.fontSize} onWheel={(event) => event.stopPropagation()} onBlur={(event) => { const fontSize = event.currentTarget.valueAsNumber; if (!Number.isInteger(fontSize) || fontSize < 8 || fontSize > 96) { event.currentTarget.setCustomValidity("文字サイズは8から96の整数で入力してください。"); event.currentTarget.reportValidity(); return; } event.currentTarget.setCustomValidity(""); updateItems(selectedIds, { fontSize }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><UiSelect className="font-size-setting__preset" ariaLabel="文字サイズの候補" value={selectedNode.data.fontSize} onChange={(fontSize) => updateItems(selectedIds, { fontSize: Number(fontSize) })} options={Array.from(new Set([12, 14, 16, 18, 20, 22, 24, 28, 32, selectedNode.data.fontSize])).sort((a, b) => a - b).map((size) => ({ value: String(size), label: String(size) }))} /></div></div>}
        {textLayoutIds.length > 0 && <div className="text-layout-settings"><label><span>横方向の文字配置</span><div className="text-alignment-tools" role="group" aria-label="横方向の文字配置"><Button size="icon" variant={selectedNode.data.textAlign === "left" ? "secondary" : "outline"} className={selectedNode.data.textAlign === "left" ? "is-active" : ""} title="左寄せ" onClick={() => updateItems(textLayoutIds, { textAlign: "left" })}><TextAlignStart /></Button><Button size="icon" variant={selectedNode.data.textAlign === "center" ? "secondary" : "outline"} className={selectedNode.data.textAlign === "center" ? "is-active" : ""} title="中央寄せ" onClick={() => updateItems(textLayoutIds, { textAlign: "center" })}><TextAlignCenter /></Button><Button size="icon" variant={selectedNode.data.textAlign === "right" ? "secondary" : "outline"} className={selectedNode.data.textAlign === "right" ? "is-active" : ""} title="右寄せ" onClick={() => updateItems(textLayoutIds, { textAlign: "right" })}><TextAlignEnd /></Button></div></label><label><span>縦方向の文字配置</span><div className="text-alignment-tools" role="group" aria-label="縦方向の文字配置"><Button size="icon" variant={selectedNode.data.verticalAlign === "top" ? "secondary" : "outline"} className={selectedNode.data.verticalAlign === "top" ? "is-active" : ""} title="上寄せ" onClick={() => updateItems(textLayoutIds, { verticalAlign: "top" })}><AlignVerticalJustifyStart /></Button><Button size="icon" variant={selectedNode.data.verticalAlign === "middle" ? "secondary" : "outline"} className={selectedNode.data.verticalAlign === "middle" ? "is-active" : ""} title="上下中央" onClick={() => updateItems(textLayoutIds, { verticalAlign: "middle" })}><AlignVerticalJustifyCenter /></Button><Button size="icon" variant={selectedNode.data.verticalAlign === "bottom" ? "secondary" : "outline"} className={selectedNode.data.verticalAlign === "bottom" ? "is-active" : ""} title="下寄せ" onClick={() => updateItems(textLayoutIds, { verticalAlign: "bottom" })}><AlignVerticalJustifyEnd /></Button></div></label></div>}
      </div></div>}
      {selectedIds.length === 0 && selectedEdge && <div className="context-toolbar" aria-label="矢印選択メニュー" onPointerDown={(event) => event.stopPropagation()}>
        <Button size="icon" variant="ghost" title="複製" onClick={() => duplicateEdge(selectedEdgeIds[0])}><Copy /></Button>
        <div className="color-picker">{linePalette.map((color) => <button key={color} aria-label={`矢印の色 ${color}`} className={displayEdgeColor(selectedEdge.get("color")) === color ? "is-active" : ""} style={{ background: color }} onClick={() => updateEdge(selectedEdgeIds[0], { color })} />)}</div>
        <Button size="icon" variant="ghost" title={selectedEdge.get("locked") ? "ロック解除" : "ロック"} onClick={() => updateEdge(selectedEdgeIds[0], { locked: !selectedEdge.get("locked") })}>{selectedEdge.get("locked") ? <Unlock /> : <Lock />}</Button>
        <Button size="icon" variant="ghost" title="矢印の設定" onClick={() => setEdgeMenu({ edgeId: selectedEdgeIds[0], x: Math.max(12, window.innerWidth / 2 - 140), y: 126 })}><Settings2 /></Button>
        <Button size="icon" variant="ghost" title="コメントを追加" aria-label="コメントを追加" className={commentComposerTargetId === selectedEdgeIds[0] ? "is-active" : ""} onClick={() => openCommentComposer(selectedEdgeIds[0])}><MessageCircle /></Button>
        <Button size="icon" variant="destructive" title="削除" className="danger" onClick={() => deleteEdges(selectedEdgeIds)}><Trash2 /></Button>
      </div>}

      {commentComposerTargetId && <form className="comment-bubble-composer" aria-label="コメントを追加" onPointerDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); addComment(commentComposerTargetId); }}>
        <MessageCircle aria-hidden="true" />
        <Textarea autoFocus aria-label="コメントを入力" placeholder="コメントを入力…" value={commentText} onChange={(event) => setCommentText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); addComment(commentComposerTargetId); } }} />
        <Button size="icon" type="submit" aria-label="コメントを送信" disabled={!commentText.trim()}><Send /></Button>
        <Button size="icon" type="button" variant="ghost" aria-label="コメント入力を閉じる" onClick={() => { setCommentComposerTargetId(null); setCommentText(""); }}><X /></Button>
      </form>}

      <section ref={canvasRef} className={`canvas canvas--${toolMode}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-mingleboard-item")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={dropTool}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          controlSelectionBaseRef.current = (event.ctrlKey || event.metaKey) && target.closest(".react-flow__node") ? [...selectedIdsRef.current] : null;
        }}
        onPointerDown={(event) => { if (toolMode === "pen" && event.button === 0) { event.preventDefault(); setDraftDrawing([{ x: event.clientX, y: event.clientY }]); } }}
        onPointerMove={(event) => { if (toolMode === "pen" && draftDrawing.length > 0) setDraftDrawing((points) => [...points, { x: event.clientX, y: event.clientY }]); }}
        onPointerUp={() => { if (toolMode === "pen") finishDrawing(); }}>
        <ReactFlow<BoardNodeType, Edge>
          nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={setFlow} onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={(deleted) => deleteItems(deleted.map((node) => node.id))}
          onEdgesDelete={(deleted) => deleteEdges(deleted.map((edge) => edge.id))}
          onConnect={connect} onReconnect={reconnect} reconnectRadius={18} edgesReconnectable={toolMode === "select" && !selectionOnlyMode} onSelectionChange={onSelectionChange} connectionMode={ConnectionMode.Loose} multiSelectionKeyCode={null}
          onNodeClick={(event, node) => {
            if (node.data.locked) {
              selectedIdsRef.current = []; selectedEdgeIdsRef.current = [];
              setSelectedIds([]); setSelectedEdgeIds([]); setNodeSettingsOpen(false);
              setNodes((current) => current.map((item) => ({ ...item, selected: false })));
              setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
              return;
            }
            if (toolMode === "eraser" && node.data.kind === "drawing") deleteItems([node.id]);
            else if (selectionToolActive || event.ctrlKey || event.metaKey) toggleControlSelection(node.id);
          }}
          onNodeDoubleClick={(event, node) => {
            if (!node.data.locked) return;
            event.preventDefault(); event.stopPropagation();
            window.setTimeout(() => {
              selectedIdsRef.current = [node.id]; selectedEdgeIdsRef.current = [];
              setSelectedIds([node.id]); setSelectedEdgeIds([]); setNodeSettingsOpen(false);
              setNodes((current) => current.map((item) => ({ ...item, selected: item.id === node.id })));
              setEdges((current) => current.map((edge) => ({ ...edge, selected: false })));
            });
          }}
          onNodeContextMenu={(event, node) => { if (node.data.locked) { event.preventDefault(); return; } if (node.data.kind !== "line") return; event.preventDefault(); setEdgeMenu(null); setLineMenu({ nodeId: node.id, x: Math.min(event.clientX, window.innerWidth - 282), y: Math.min(event.clientY, window.innerHeight - 300) }); }}
          onEdgeContextMenu={(event, edge) => { event.preventDefault(); setLineMenu(null); setEdgeMenu({ edgeId: edge.id, x: Math.min(event.clientX, window.innerWidth - 282), y: Math.min(event.clientY, window.innerHeight - 430) }); }}
          onEdgeDoubleClick={(event, edge) => { event.preventDefault(); setEdgeLabelEditor({ edgeId: edge.id, value: String(workspace.edgesMap.get(edge.id)?.get("label") ?? "") }); }}
          onNodeDragStart={(_, draggedNode) => {
            workspace.undoManager.stopCapturing(); dragAxisRef.current = null;
            const movingIds = selectedIdsRef.current.includes(draggedNode.id) ? selectedIdsRef.current : [draggedNode.id];
            dragOriginsRef.current = new Map(nodes.filter((node) => movingIds.includes(node.id)).map((node) => [node.id, { ...node.position }]));
          }}
          onNodeDragStop={(_, draggedNode, draggedNodes) => {
            const finalNodes = new Map([...draggedNodes, draggedNode].map((node) => [node.id, node]));
            workspace.doc.transact(() => finalNodes.forEach((node, id) => {
              requireFinitePoint(node.position, `移動後のオブジェクト ${id} の座標`);
              const item = workspace.nodesMap.get(id);
              if (!item) throw new Error(`移動したオブジェクト ${id} が存在しません。`);
              item.set("x", node.position.x); item.set("y", node.position.y);
            }), localOrigin);
            dragOriginsRef.current.clear(); dragAxisRef.current = null; workspace.undoManager.stopCapturing();
          }}
          nodesDraggable={toolMode === "select"} nodesConnectable={toolMode === "select" && !selectionOnlyMode} elementsSelectable={toolMode !== "pen"}
          selectionOnDrag={selectionOnlyMode}
          panOnDrag={toolMode === "select" && !selectionOnlyMode ? [0, 1] : [1]}
          panActivationKeyCode={null}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          connectionLineType={ConnectionLineType.Bezier} connectionLineStyle={{ stroke: DEFAULT_EDGE_COLOR, strokeWidth: 2 }}
          fitView fitViewOptions={{ padding: 0.3 }} minZoom={0.2} maxZoom={2.4} deleteKeyCode={null}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#d6d4df" />
          <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => String(node.data.color)} maskColor="rgba(246,245,249,.72)" />
        </ReactFlow>
        {draftDrawing.length > 1 && <svg className="drawing-overlay" viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}><path d={draftDrawing.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")} style={{ stroke: penColor, strokeWidth: penWidth, strokeLinecap: penBrush === "pen" ? "round" : "square", strokeLinejoin: penBrush === "marker" ? "bevel" : "round", opacity: penBrush === "highlighter" ? .35 : penBrush === "marker" ? .86 : 1, mixBlendMode: penBrush === "highlighter" ? "multiply" : "normal" }} /></svg>}
        {flow && remotePresence.map((item) => { if (!item.cursor || !item.user || item.editing?.nodeId) return null; const point = flow.flowToScreenPosition(item.cursor); return <div key={item.clientId} className={`remote-cursor ${item.user.type === "agent" ? "remote-cursor--agent" : ""}`} aria-label={`${item.user.name}のカーソル`} style={{ left: point.x, top: point.y, color: item.user.color }}><MousePointer2 fill="currentColor" size={18} /><span style={{ background: item.user.color }}>{item.user.type === "agent" && <Bot size={11} />}{item.user.name}</span></div>; })}
      </section>

      {edgeMenu && <div ref={edgeMenuRef} className="edge-context-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} onContextMenu={(event) => event.preventDefault()}>
        <header><span><strong>コネクター</strong><small>線と矢印のスタイル</small></span><Button size="icon-sm" variant="ghost" onClick={() => setEdgeMenu(null)} aria-label="矢印設定を閉じる"><X /></Button></header>
        <section><span className="edge-menu-label">線の形</span><div className="edge-segments edge-segments--line">{[["straight", "直線"], ["bezier", "曲線"], ["smoothstep", "直角"]].map(([value, label]) => <Button size="sm" variant={edgeLineType === value ? "secondary" : "outline"} key={value} className={edgeLineType === value ? "is-active" : ""} onClick={() => updateEdge(edgeMenu.edgeId, { lineType: value })}><i className={`line-preview line-preview--${value}`} />{label}</Button>)}</div></section>
        <section><span className="edge-menu-label">線の太さ</span><div className="edge-weight-options">{[1, 2, 4, 7].map((width) => <Button size="icon-sm" variant={edgeStrokeWidth === width ? "secondary" : "outline"} key={width} className={edgeStrokeWidth === width ? "is-active" : ""} aria-label={`太さ ${width}`} onClick={() => updateEdge(edgeMenu.edgeId, { strokeWidth: width })}><i style={{ height: width }} /></Button>)}</div></section>
        <section className="edge-dash-row"><span><strong>点線</strong><small>線を破線で表示</small></span><Switch aria-label="点線" checked={edgeDashed} onCheckedChange={(checked) => updateEdge(edgeMenu.edgeId, { dashed: checked })} /></section>
        {[{ key: "startMarker", label: "始点", value: edgeStartMarker }, { key: "endMarker", label: "終点", value: edgeEndMarker }].map((marker) => <section key={marker.key}><span className="edge-menu-label">{marker.label}の形</span><div className="edge-segments edge-segments--marker">{edgeMarkerOptions.map(({ value, label }) => <Button size="sm" variant={marker.value === value ? "secondary" : "outline"} key={value} className={marker.value === value ? "is-active" : ""} onClick={() => updateEdge(edgeMenu.edgeId, { [marker.key]: value })}><EdgeMarkerPreview marker={value} />{label}</Button>)}</div></section>)}
      </div>}
      {lineMenu && <div ref={lineMenuRef} className="edge-context-menu line-context-menu" style={{ left: lineMenu.x, top: lineMenu.y }} onContextMenu={(event) => event.preventDefault()}>
        <header><span><strong>線</strong><small>2つの端点を結ぶ線のスタイル</small></span><Button size="icon-sm" variant="ghost" onClick={() => setLineMenu(null)} aria-label="線設定を閉じる"><X /></Button></header>
        <section><span className="edge-menu-label">線の色</span><div className="line-color-options">{linePalette.map((color) => <button key={color} aria-label={`線の色 ${color}`} className={lineColor === color ? "is-active" : ""} style={{ background: color }} onClick={() => updateItems([lineMenu.nodeId], { color })} />)}</div></section>
        <section><span className="edge-menu-label">線の太さ</span><div className="edge-weight-options">{[1, 2, 4, 7].map((width) => <Button size="icon-sm" variant={lineStrokeWidth === width ? "secondary" : "outline"} key={width} className={lineStrokeWidth === width ? "is-active" : ""} aria-label={`太さ ${width}`} onClick={() => updateItems([lineMenu.nodeId], { lineStrokeWidth: width })}><i style={{ height: width }} /></Button>)}</div></section>
        <section className="edge-dash-row"><span><strong>点線</strong><small>線を破線で表示</small></span><Switch aria-label="点線" checked={lineDashed} onCheckedChange={(checked) => updateItems([lineMenu.nodeId], { lineDashed: checked })} /></section>
      </div>}
      <Dialog open={edgeLabelEditor !== null} onOpenChange={(open) => { if (!open) setEdgeLabelEditor(null); }}><DialogContent><form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); if (!edgeLabelEditor) return; updateEdge(edgeLabelEditor.edgeId, { label: edgeLabelEditor.value.trim() }); setEdgeLabelEditor(null); }}><DialogHeader><DialogTitle>矢印のラベル</DialogTitle><DialogDescription>矢印上に表示する文字を入力します。</DialogDescription></DialogHeader><div className="grid gap-2"><Label htmlFor="edge-label">ラベル</Label><Input id="edge-label" autoFocus value={edgeLabelEditor?.value ?? ""} onChange={(event) => edgeLabelEditor && setEdgeLabelEditor({ ...edgeLabelEditor, value: event.target.value })} placeholder="ラベルを入力" /></div><DialogFooter><DialogClose render={<Button variant="outline" type="button" />}>キャンセル</DialogClose><Button type="submit">保存</Button></DialogFooter></form></DialogContent></Dialog>

      <div className="history-tools"><Button size="icon-sm" variant="ghost" aria-label="元に戻す（Ctrl+Z）" onClick={() => runHistory("undo")}><Undo2 /></Button><Button size="icon-sm" variant="ghost" aria-label="やり直す（Ctrl+Shift+Z）" onClick={() => runHistory("redo")}><Redo2 /></Button><span className="history-divider" /><Button size="icon-sm" variant="ghost" aria-label="拡大" onClick={() => flow?.zoomIn()}><Plus /></Button><Button size="icon-sm" variant="ghost" aria-label="縮小" onClick={() => flow?.zoomOut()}><Minus /></Button><Button size="icon-sm" variant="ghost" aria-label="全体を表示" onClick={() => flow?.fitView({ padding: 0.3, duration: 220 })}><Focus /></Button></div>
      {selectionHintVisible && <div className="hint"><CircleHelp size={15} /><span>Ctrl+クリックで複数選択。Space+背景ドラッグで範囲選択</span><Button size="icon-xs" variant="ghost" onClick={() => setSelectionHintVisible(false)} aria-label="操作ヒントを閉じる" title="閉じる"><X size={14} /></Button></div>}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent className="help-dialog max-h-[calc(100svh-2rem)] overflow-hidden sm:max-w-3xl"><DialogHeader><DialogTitle>れんらくがかりの使い方</DialogTitle><DialogDescription className="sr-only">操作方法とショートカット一覧</DialogDescription></DialogHeader>
        <div className="help-dialog__content">
          <section><h3>選択・移動</h3><dl><div><dt><kbd>Ctrl</kbd> + クリック</dt><dd>オブジェクトを複数選択</dd></div><div><dt><kbd>Space</kbd> + 背景ドラッグ</dt><dd>範囲を指定して複数選択</dd></div><div><dt><kbd>Shift</kbd> + ドラッグ</dt><dd>水平または垂直方向に固定して移動</dd></div><div><dt><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>H</kbd></dt><dd>選択したオブジェクトを横一列に整列</dd></div><div><dt><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>V</kbd></dt><dd>選択したオブジェクトを縦一列に整列</dd></div><div><dt>選択ツール</dt><dd>ツールバーの矢印から選択モードを固定</dd></div></dl></section>
          <section><h3>スマホ・タブレット</h3><dl><div><dt>画面下のツールバー</dt><dd>横へスワイプしてツールを切り替え、タップして画面中央へ追加</dd></div><div><dt>選択ツール</dt><dd>矢印を有効にしてから複数のオブジェクトを順番にタップ</dd></div><div><dt>キャンバス</dt><dd>1本指で移動、2本指で拡大・縮小</dd></div><div><dt>線・矢印の設定</dt><dd>選択後に上部の設定アイコンをタップ</dd></div></dl></section>
          <section><h3>編集</h3><dl><div><dt><kbd>Ctrl</kbd> + <kbd>C</kbd></dt><dd>選択オブジェクトをコピー</dd></div><div><dt><kbd>Ctrl</kbd> + <kbd>V</kbd></dt><dd>コピーしたオブジェクトを貼り付け</dd></div><div><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd></dt><dd>選択オブジェクトのIDをコピー</dd></div><div><dt><kbd>Delete</kbd> / <kbd>Backspace</kbd></dt><dd>選択オブジェクトを削除</dd></div></dl></section>
          <section><h3>履歴・表示</h3><dl><div><dt><kbd>Ctrl</kbd> + <kbd>Z</kbd></dt><dd>元に戻す</dd></div><div><dt><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd></dt><dd>やり直す</dd></div><div><dt>ホイール</dt><dd>キャンバスを拡大・縮小</dd></div><div><dt><kbd>Shift</kbd> + ホイール</dt><dd>データベースの表を左右へスクロール</dd></div></dl></section>
          <section><h3>オブジェクト</h3><dl><div><dt>ツールバーからクリック</dt><dd>画面中央へ追加</dd></div><div><dt>ツールバーからドラッグ</dt><dd>指定した位置へ追加</dd></div><div><dt>ダブルクリック</dt><dd>テキストや矢印ラベルを編集</dd></div><div><dt>右クリック / 3点メニュー</dt><dd>対象に応じた表示・線・タイマー設定を開く</dd></div></dl></section>
        </div>
        <DialogFooter><DialogClose render={<Button variant="outline" />}>閉じる</DialogClose></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={dataManagerOpen} onOpenChange={(open) => { setDataManagerOpen(open); if (!open) { setFieldSelectionModeDatabaseId(null); setSelectedDatabaseFieldIds([]); } }}><DialogContent className="data-manager h-[min(880px,calc(100svh-2rem))] max-w-[min(1100px,calc(100vw-2rem))] overflow-hidden p-0 sm:max-w-[min(1100px,calc(100vw-2rem))]" showCloseButton={false}>
        <header className="data-manager__header">
          <DialogHeader><DialogTitle>データベース管理</DialogTitle><DialogDescription className="sr-only">現在のボードに属するデータベースの管理</DialogDescription></DialogHeader>
          <div className="data-manager__actions">
            <Button className="create-database" onClick={() => createDatabase()} title="新しいデータベース"><Plus />新規作成</Button>
            <Button size="icon" variant="outline" onClick={loadDataManager} disabled={dataManagerLoading} title="再読込" aria-label="再読込"><RefreshCw /></Button>
            <DialogClose render={<Button size="icon" variant="outline" aria-label="閉じる" />}><X /></DialogClose>
          </div>
        </header>
        <input ref={importInputRef} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={importCsv} />
        {dataManagerError && <Alert variant="destructive" role="alert"><AlertDescription>{dataManagerError}</AlertDescription></Alert>}
        {dataManagerLoading ? <div className="data-manager__empty"><RefreshCw className="spin" />データを読み込んでいます…</div> : managedDatabases.length === 0 ? <div className="data-manager__empty"><Database /><span>このボードにはデータベースがありません。</span><Button variant="outline" onClick={() => createDatabase()}><Plus />最初のデータベースを作成</Button></div> : <div className="data-manager__content">
          {managedDatabases.map((database, databaseIndex) => {
            const isOpen = openManagedDatabaseIds.includes(database.id);
            const records = database.records;
            const fieldSelectionMode = fieldSelectionModeDatabaseId === database.id;
            const selectableFields = database.fields.filter((field) => !field.system);
            const selectedFieldIds = fieldSelectionMode ? selectedDatabaseFieldIds.filter((id) => selectableFields.some((field) => field.id === id)) : [];
            const allFieldsSelected = selectableFields.length > 0 && selectedFieldIds.length === selectableFields.length;
            const toggleFieldSelection = (fieldId: string, selected: boolean) => setSelectedDatabaseFieldIds((current) => selected ? [...new Set([...current, fieldId])] : current.filter((id) => id !== fieldId));
            const toggleManagedDatabase = () => setOpenManagedDatabaseIds((current) => current.includes(database.id) ? current.filter((id) => id !== database.id) : [...current, database.id]);
            return <Fragment key={database.id}>{renderManagedDatabaseDropZone(databaseIndex)}<Card data-database-id={database.id} className={`managed-database ${isOpen ? "is-open" : ""} ${draggedManagedDatabase?.id === database.id ? "is-dragging" : ""}`}
              onDragOver={(event) => {
                if (!draggedManagedDatabase) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const insertionIndex = event.clientY < bounds.top + bounds.height / 2 ? databaseIndex : databaseIndex + 1;
                setDraggedManagedDatabase((current) => current ? { ...current, insertionIndex } : current);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (!draggedManagedDatabase) return;
                const bounds = event.currentTarget.getBoundingClientRect();
                const insertionIndex = event.clientY < bounds.top + bounds.height / 2 ? databaseIndex : databaseIndex + 1;
                reorderManagedDatabase(draggedManagedDatabase.id, insertionIndex);
                setDraggedManagedDatabase(null);
              }}>
              <header onClick={(event) => { if (!(event.target as Element).closest("button, a, input, select, textarea")) toggleManagedDatabase(); }}><div><Button size="icon-sm" variant="outline" className="managed-database__toggle" aria-label={`${database.name}を${isOpen ? "閉じる" : "開く"}`} aria-expanded={isOpen} onClick={toggleManagedDatabase}><ChevronDown /></Button><Database size={16} /><Input aria-label={`${database.name}の名前`} value={database.name} onChange={(event) => updateDatabaseName(database.id, event.target.value)} /></div><div>
                <DropdownMenu open={databaseActionMenuId === database.id} onOpenChange={(open) => setDatabaseActionMenuId(open ? database.id : null)}><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="managed-database__more" aria-label={`${database.name}のメニュー`} title="データベースの操作" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => { setDatabaseActionMenuId(null); setImportDatabaseId(database.id); window.setTimeout(() => importInputRef.current?.click(), 0); }}><Upload />CSVを取り込む</DropdownMenuItem>
                  <DropdownMenuItem render={<a href={`/api/mini-databases?boardId=${encodeURIComponent(room)}&export=${encodeURIComponent(database.id)}`} download onClick={() => setDatabaseActionMenuId(null)} />}><Download />CSVを書き出す</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => { setDatabaseActionMenuId(null); setDatabaseDeleteDialog({ id: database.id, name: database.name }); }}><Trash2 />削除する</DropdownMenuItem>
                </DropdownMenuContent></DropdownMenu>
                <button type="button" className="managed-database__drag-handle" draggable aria-label={`${database.name}をドラッグして並べ替え`} title="ドラッグして並べ替え"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-renraku-managed-database", database.id);
                    const card = event.currentTarget.closest(".managed-database");
                    if (card instanceof HTMLElement) event.dataTransfer.setDragImage(card, Math.max(18, card.offsetWidth - 18), 24);
                    setDraggedManagedDatabase({ id: database.id, insertionIndex: databaseIndex });
                  }}
                  onDragEnd={() => setDraggedManagedDatabase(null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && databaseIndex > 0) {
                      event.preventDefault();
                      reorderManagedDatabase(database.id, databaseIndex - 1);
                    }
                    if (event.key === "ArrowDown" && databaseIndex < managedDatabases.length - 1) {
                      event.preventDefault();
                      reorderManagedDatabase(database.id, databaseIndex + 2);
                    }
                  }}><GripVertical /></button>
              </div></header>
              {isOpen && <div className="managed-database__body">
              <Accordion className="database-settings-accordion"><AccordionItem value="schema"><AccordionTrigger><span><Settings2 size={14} /><strong>列と表示設定</strong><small>列の追加・種類・選択肢</small></span></AccordionTrigger><AccordionContent>
              <section className="database-schema-settings"><div className={`schema-heading ${fieldSelectionMode ? "is-selection-mode" : ""}`}><div className="schema-heading__actions"><Button variant={fieldSelectionMode ? "secondary" : "outline"} className="field-selection-toggle" aria-pressed={fieldSelectionMode} onClick={() => { setFieldSelectionModeDatabaseId(fieldSelectionMode ? null : database.id); setSelectedDatabaseFieldIds([]); }}><CheckSquare2 />{fieldSelectionMode ? "選択を終了" : "複数選択"}</Button>{fieldSelectionMode ? <><label className="schema-select-all"><Checkbox aria-label="すべての列を選択" checked={allFieldsSelected} onCheckedChange={(checked) => setSelectedDatabaseFieldIds(checked === true ? selectableFields.map((field) => field.id) : [])} /><span>全選択</span></label><span className="schema-selection-count" aria-live="polite">{selectedFieldIds.length}列選択</span><Button variant="destructive" className="schema-bulk-delete" disabled={selectedFieldIds.length === 0} onClick={() => setFieldDeleteDialog({ databaseId: database.id, fieldIds: selectedFieldIds, itemName: `選択した${selectedFieldIds.length}列` })}><Trash2 />一括削除</Button></> : <><Button variant="outline" className="add-field add-field--top" onClick={() => addDatabaseField(database.id)}><Plus />列を追加</Button><span className="schema-heading__note">看板にはステータス列、ガントには日付列が2列必要です。</span></>}</div></div>
                {database.fields.map((field) => <div className={`schema-field ${fieldSelectionMode ? "is-selection-mode" : ""} ${selectedFieldIds.includes(field.id) ? "is-selected" : ""} ${field.type === "date" ? "has-date-format" : ""} ${draggedDatabaseField?.fieldIds.includes(field.id) ? "is-dragging" : ""} ${draggedDatabaseField?.targetId === field.id ? `is-drop-${draggedDatabaseField.position}` : ""}`} key={field.id}
                  onDragOver={(event) => {
                    if (!draggedDatabaseField || draggedDatabaseField.databaseId !== database.id || draggedDatabaseField.fieldIds.includes(field.id)) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const position = field.system || event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                    setDraggedDatabaseField((current) => current ? { ...current, targetId: field.id, position } : current);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggedDatabaseField || draggedDatabaseField.databaseId !== database.id || draggedDatabaseField.fieldIds.includes(field.id)) return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const position = field.system || event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                    reorderDatabaseFields(database.id, draggedDatabaseField.fieldIds, field.id, position);
                    setDraggedDatabaseField(null);
                  }}>
                  {fieldSelectionMode && (field.system ? <span className="schema-field-check is-disabled" aria-hidden="true" /> : <label className="schema-field-check"><Checkbox aria-label={`${field.name}を選択`} checked={selectedFieldIds.includes(field.id)} onCheckedChange={(checked) => toggleFieldSelection(field.id, checked === true)} /></label>)}
                  <Input aria-label="列名" value={field.name} readOnly={Boolean(field.system)} onChange={(event) => updateDatabaseField(database.id, field.id, { name: event.target.value })} />
                  <UiSelect ariaLabel={`${field.name}の種類`} value={field.type} disabled={Boolean(field.system)} onChange={(type) => updateDatabaseField(database.id, field.id, { type })} options={[{ value: "text", label: "テキスト" }, { value: "textarea", label: "複数行テキスト" }, { value: "number", label: "数値" }, { value: "select", label: "選択肢" }, { value: "status", label: "ステータス" }, { value: "person", label: "担当者" }, { value: "date", label: "日付" }]} />
                  {field.type === "status" || field.type === "select" ? <Button size="icon-sm" variant="outline" className="edit-options" title={`${field.name}の選択肢を編集`} aria-label={`${field.name}の選択肢を編集`} onClick={() => setFieldOptionsEditor({ databaseId: database.id, fieldId: field.id, fieldName: field.name, value: field.options.join("\n"), optionColors: { ...field.optionColors }, activeOption: null })}><Pencil /></Button>
                    : field.type === "date" ? <UiSelect ariaLabel={`${field.name}の表示形式`} value={field.dateFormat ?? "date"} disabled={Boolean(field.system)} onChange={(dateFormat) => updateDatabaseField(database.id, field.id, { dateFormat: dateFormat as DateDisplayFormat })} options={[{ value: "datetime", label: "日時" }, { value: "date", label: "日" }, { value: "month", label: "月" }, { value: "hour", label: "時間" }, { value: "time", label: "時分" }]} />
                      : <span className="schema-spacer" />}
                  <Button size="icon-sm" variant="ghost" className="schema-field-visibility" aria-label={`${field.name}を表に${field.tableVisible ? "表示しない" : "表示する"}`} title={field.tableVisible ? "表では非表示にする" : "表に表示する"} onClick={() => setDatabaseFieldTableVisible(database.id, field.id, !field.tableVisible)}>{field.tableVisible ? <Eye /> : <EyeOff />}</Button>
                  {field.system ? <span className="schema-field-menu-placeholder" aria-hidden="true" /> : <DropdownMenu open={fieldActionMenuId === `${database.id}/${field.id}`} onOpenChange={(open) => setFieldActionMenuId(open ? `${database.id}/${field.id}` : null)}><DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="schema-field-more" aria-label={`${field.name}のメニュー`} title="列の操作" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem variant="destructive" onClick={() => { setFieldActionMenuId(null); setFieldDeleteDialog({ databaseId: database.id, fieldIds: [field.id], itemName: field.name }); }}><Trash2 />削除する</DropdownMenuItem>
                  </DropdownMenuContent></DropdownMenu>}
                  {field.system ? <span className="schema-field-drag-handle is-disabled" title="システム列は末尾固定"><GripVertical /></span> : <button type="button" className="schema-field-drag-handle" draggable aria-label={`${field.name}をドラッグして並べ替え`} title={fieldSelectionMode && selectedFieldIds.includes(field.id) && selectedFieldIds.length > 1 ? `選択した${selectedFieldIds.length}列を並べ替え` : "ドラッグして並べ替え"}
                    onDragStart={(event) => {
                      const movingIds = fieldSelectionMode && selectedFieldIds.includes(field.id) ? database.fields.filter((entry) => selectedFieldIds.includes(entry.id) && !entry.system).map((entry) => entry.id) : [field.id];
                      if (fieldSelectionMode && !selectedFieldIds.includes(field.id)) setSelectedDatabaseFieldIds([field.id]);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-renraku-database-field", JSON.stringify({ databaseId: database.id, fieldIds: movingIds }));
                      const row = event.currentTarget.closest(".schema-field");
                      setDatabaseFieldDragImage(event, row instanceof HTMLElement ? row : null, movingIds.length);
                      setDraggedDatabaseField({ databaseId: database.id, fieldIds: movingIds });
                    }}
                    onDragEnd={() => setDraggedDatabaseField(null)}
                    onKeyDown={(event) => {
                      const movingIds = fieldSelectionMode && selectedFieldIds.includes(field.id) ? selectedFieldIds : [field.id];
                      const movingIdSet = new Set(movingIds);
                      const movingIndexes = database.fields.map((entry, index) => movingIdSet.has(entry.id) ? index : -1).filter((index) => index >= 0);
                      if (event.key === "ArrowUp" && movingIndexes.length > 0) {
                        let targetIndex = Math.min(...movingIndexes) - 1;
                        while (targetIndex >= 0 && movingIdSet.has(database.fields[targetIndex].id)) targetIndex -= 1;
                        if (targetIndex < 0) return;
                        event.preventDefault();
                        reorderDatabaseFields(database.id, movingIds, database.fields[targetIndex].id, "before");
                      }
                      if (event.key === "ArrowDown" && movingIndexes.length > 0) {
                        let targetIndex = Math.max(...movingIndexes) + 1;
                        while (targetIndex < database.fields.length && movingIdSet.has(database.fields[targetIndex].id)) targetIndex += 1;
                        if (targetIndex >= database.fields.length) return;
                        event.preventDefault();
                        const target = database.fields[targetIndex];
                        reorderDatabaseFields(database.id, movingIds, target.id, target.system ? "before" : "after");
                      }
                    }}><GripVertical /></button>}
                </div>)}
              </section></AccordionContent></AccordionItem></Accordion>
              <Accordion className="database-settings-accordion database-records-accordion"><AccordionItem value="records"><AccordionTrigger><span className="database-records-heading"><Table2 size={14} /><strong>登録データ</strong><Badge variant="secondary" className="database-record-count">{records.length}件</Badge></span></AccordionTrigger><AccordionContent>
                <div className="managed-table-wrap"><Table><TableHeader><TableRow>{database.fields.map((field) => <TableHead key={field.id}>{field.name}<small>{field.type}</small></TableHead>)}</TableRow></TableHeader>
                  <TableBody>{records.length === 0 ? <TableRow><TableCell colSpan={database.fields.length}>登録データはありません。</TableCell></TableRow> : records.map((record) => <TableRow key={record.id}>{database.fields.map((field) => <TableCell key={field.id}>{record.values[field.id] ?? ""}</TableCell>)}</TableRow>)}</TableBody></Table></div>
              </AccordionContent></AccordionItem></Accordion>
              </div>}
            </Card></Fragment>;
          })}
          {renderManagedDatabaseDropZone(managedDatabases.length)}
        </div>}
      </DialogContent></Dialog>

      <DeleteConfirmationDialog open={databaseDeleteDialog !== null} itemName={databaseDeleteDialog?.name ?? ""} onOpenChange={(open) => { if (!open) setDatabaseDeleteDialog(null); }} onConfirm={() => databaseDeleteDialog && deleteManagedDatabase(databaseDeleteDialog.id, databaseDeleteDialog.name)} />
      <DeleteConfirmationDialog open={fieldDeleteDialog !== null} itemName={fieldDeleteDialog?.itemName ?? ""} onOpenChange={(open) => { if (!open) setFieldDeleteDialog(null); }} onConfirm={() => fieldDeleteDialog && deleteDatabaseFields(fieldDeleteDialog.databaseId, fieldDeleteDialog.fieldIds)} />
      <DeleteConfirmationDialog open={commentDeleteDialog !== null} itemName={commentDeleteDialog ? `${commentDeleteDialog.author}のコメント` : ""} onOpenChange={(open) => { if (!open) setCommentDeleteDialog(null); }} onConfirm={() => commentDeleteDialog && deleteComment(commentDeleteDialog.id)} />

      <Dialog open={fieldOptionsEditor !== null} onOpenChange={(open) => { if (!open) setFieldOptionsEditor(null); }}><DialogContent className="field-options-dialog sm:max-w-lg"><DialogHeader><DialogTitle>{fieldOptionsEditor?.fieldName}の選択肢</DialogTitle><DialogDescription>1行につき1つ入力します。入力順が選択欄と看板の表示順になります。</DialogDescription></DialogHeader>
        <Textarea className="min-h-36" autoFocus aria-label="選択肢を1行ずつ入力" value={fieldOptionsEditor?.value ?? ""} onChange={(event) => fieldOptionsEditor && setFieldOptionsEditor({ ...fieldOptionsEditor, value: event.target.value })} placeholder={"未着手\n進行中\n完了"} />
        <div className="options-preview" aria-label="選択肢の背景色">{uniqueOptions(fieldOptionsEditor?.value ?? "").map((option) => <Popover key={option} open={fieldOptionsEditor?.activeOption === option} onOpenChange={(open) => fieldOptionsEditor && setFieldOptionsEditor({ ...fieldOptionsEditor, activeOption: open ? option : null })}><PopoverTrigger render={<button type="button" className="option-preview-button" style={fieldOptionsEditor?.optionColors[option] ? { background: fieldOptionsEditor.optionColors[option] } : undefined} aria-label={`${option}の背景色を選択`} />}>{option}</PopoverTrigger><PopoverContent side="top" align="start" className="option-color-popover"><button type="button" className={!fieldOptionsEditor?.optionColors[option] ? "is-selected is-none" : "is-none"} aria-label={`${option}の背景色なし`} title="色なし" onClick={() => fieldOptionsEditor && setFieldOptionsEditor({ ...fieldOptionsEditor, optionColors: { ...fieldOptionsEditor.optionColors, [option]: "" }, activeOption: null })} />{palette.map((color) => <button type="button" key={color} className={fieldOptionsEditor?.optionColors[option] === color ? "is-selected" : ""} style={{ background: color }} aria-label={`${option}の背景色 ${color}`} onClick={() => fieldOptionsEditor && setFieldOptionsEditor({ ...fieldOptionsEditor, optionColors: { ...fieldOptionsEditor.optionColors, [option]: color }, activeOption: null })} />)}</PopoverContent></Popover>)}</div>
        <DialogFooter className="field-options-dialog__footer"><DialogClose render={<Button variant="outline" />}>キャンセル</DialogClose><Button onClick={() => { if (!fieldOptionsEditor) return; const options = uniqueOptions(fieldOptionsEditor.value); const optionColors = Object.fromEntries(options.map((option) => [option, fieldOptionsEditor.optionColors[option] ?? ""]).filter(([, color]) => Boolean(color))); updateDatabaseField(fieldOptionsEditor.databaseId, fieldOptionsEditor.fieldId, { options, optionColors }); setFieldOptionsEditor(null); }}>保存</Button></DialogFooter>
      </DialogContent></Dialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>テンプレート</DialogTitle><DialogDescription className="sr-only">ボードへ追加するテンプレートを選択</DialogDescription></DialogHeader>
        <div className="template-grid">
          <Button variant="outline" className="h-auto flex-col items-stretch p-4 text-left" onClick={() => applyTemplate("brainstorm")}><span className="template-art template-art--brain"><StickyNote /><StickyNote /><StickyNote /></span><strong>ブレインストーミング</strong><small>アイデアを素早く広げる</small></Button>
          <Button variant="outline" className="h-auto flex-col items-stretch p-4 text-left" onClick={() => applyTemplate("kanban")}><span className="template-art template-art--kanban"><KanbanSquare /></span><strong>カンバン</strong><small>タスクの流れを可視化</small></Button>
          <Button variant="outline" className="h-auto flex-col items-stretch p-4 text-left" onClick={() => applyTemplate("retro")}><span className="template-art template-art--retro"><FileStack /></span><strong>振り返り</strong><small>学びと次の行動を整理</small></Button>
        </div>
      </DialogContent></Dialog>

      <Sheet open={rightPanel === "comments"} onOpenChange={(open) => { if (!open) setRightPanel(null); }}><SheetContent className="right-panel comment-panel gap-0 p-0 sm:max-w-md" showCloseButton={false}><SheetHeader className="comment-panel__header"><div className="comment-panel__title-row"><SheetTitle>コメント一覧</SheetTitle><div className="comment-panel__actions"><label className="board-comment-visibility"><span>ボード上に表示</span><Switch aria-label="ボード上のコメント表示" checked={commentsVisible} onCheckedChange={setCommentsVisible} /></label><SheetClose render={<Button size="icon-sm" variant="ghost" aria-label="コメント一覧を閉じる" />}><X /></SheetClose></div></div><SheetDescription className="sr-only">ボード上のコメント一覧</SheetDescription></SheetHeader>
        <div className="comment-list">{visibleComments.length === 0 && <div className="empty-state"><MessageCircle /><strong>コメントはありません</strong></div>}{visibleComments.map((comment) => { const target = nodes.find((node) => node.id === comment.nodeId); const targetLabel = target ? target.data.text.trim().slice(0, 36) || "テキストなしのオブジェクト" : comment.nodeId ? "矢印" : "ボード全体"; return <article key={comment.id} className={comment.resolved ? "is-resolved" : ""}><header className="comment-item__header"><span className="comment-avatar">{comment.author.slice(0, 1)}</span><span className="comment-item__identity"><strong>{comment.author}</strong><small>{targetLabel}</small></span><time>{new Date(comment.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time><Button size="xs" variant="ghost" className="comment-item__resolve" onClick={() => resolveComment(comment.id)}>{comment.resolved ? "再開" : "解決"}</Button><DropdownMenu open={commentActionMenuId === comment.id} onOpenChange={(open) => setCommentActionMenuId(open ? comment.id : null)}><DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" className="comment-item__more" aria-label={`${comment.author}のコメントメニュー`} />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-40"><DropdownMenuItem variant="destructive" onClick={() => { setCommentActionMenuId(null); setCommentDeleteDialog({ id: comment.id, author: comment.author }); }}><Trash2 />削除する</DropdownMenuItem></DropdownMenuContent></DropdownMenu></header><p>{comment.text}</p></article>; })}</div>
      </SheetContent></Sheet>

      <Sheet open={rightPanel === "agent"} onOpenChange={(open) => { if (!open) setRightPanel(null); }}><SheetContent className="right-panel agent-panel gap-0 p-0 sm:max-w-lg"><SheetHeader className="border-b p-4"><SheetTitle>AIエージェント設定</SheetTitle><SheetDescription className="sr-only">MCP接続とツール権限の設定</SheetDescription></SheetHeader>
        <div className="agent-status"><span className={`status-dot status-dot--${status}`} /><div><strong>{status === "connected" ? "ボードサーバー接続中" : "ボードサーバー未接続"}</strong><small>MCPは同じYjsルームを操作します</small></div></div>
        <section className="agent-section"><h3>接続コマンド</h3><code>node [インストール先]\mcp-server.mjs</code><p>AIクライアントのMCP設定に絶対パスを指定します。既定ルームは <b>product-discovery</b> です。</p></section>
        <Accordion className="agent-permissions" defaultValue={["permissions"]}><AccordionItem value="permissions"><AccordionTrigger><span><ShieldCheck size={15} /><strong>AIエージェント権限</strong></span></AccordionTrigger><AccordionContent><div className="permission-help"><span className="access-badge access-badge--read">読み取り</span>は参照のみ、<span className="access-badge access-badge--write">書き込み・更新</span>はボードを変更します。</div><div className="permission-groups"><label><span><i className="access-dot access-dot--read" /><strong>読み取りツールをまとめて設定</strong></span><UiSelect ariaLabel="読み取りツールの一括権限" value={permissionGroupValue("read")} onChange={(permission) => setMcpPermissionGroup("read", permission as McpPermission)} options={[{ value: "mixed", label: "個別設定", disabled: true }, { value: "always_allow", label: "常に許可" }, { value: "require_approval", label: "承認必須" }, { value: "deny", label: "拒否" }]} /></label><label><span><i className="access-dot access-dot--write" /><strong>書き込み・更新ツールをまとめて設定</strong></span><UiSelect ariaLabel="書き込み・更新ツールの一括権限" value={permissionGroupValue("write")} onChange={(permission) => setMcpPermissionGroup("write", permission as McpPermission)} options={[{ value: "mixed", label: "個別設定", disabled: true }, { value: "always_allow", label: "常に許可" }, { value: "require_approval", label: "承認必須" }, { value: "deny", label: "拒否" }]} /></label></div><div className="permission-list">{mcpTools.map((tool) => <label key={tool.name}><span><i className={`access-dot access-dot--${tool.access}`} /><span><strong>{tool.label}</strong><code>{tool.name}</code></span></span><UiSelect ariaLabel={`${tool.label}の権限`} value={mcpPermissions[tool.name] ?? (tool.access === "read" ? "always_allow" : "require_approval")} onChange={(permission) => setMcpPermission(tool.name, permission as McpPermission)} options={[{ value: "always_allow", label: "常に許可" }, { value: "require_approval", label: "承認必須" }, { value: "deny", label: "拒否" }]} /></label>)}</div><p>「承認必須」はClaudeなどMCPクライアント側の確認対象です。サーバーは呼び出しを受け付け、「拒否」にしたツールだけを遮断します。</p></AccordionContent></AccordionItem></Accordion>
        <section className="agent-section activity"><div className="agent-history-heading"><h3>エージェント操作履歴</h3>{agentOwners.length > 1 && <UiSelect ariaLabel="所有ユーザーで絞り込み" value={agentOwnerFilter} onChange={setAgentOwnerFilter} options={[{ value: "all", label: "全ユーザー" }, ...agentOwners.map((owner) => ({ value: owner, label: owner }))]} />}</div>
          {agentEvents.length === 0 ? <p>まだMCPからの操作はありません。</p> : visibleAgentEvents.map((event) => <div key={event.id}>
            <span className="agent-activity-avatar" style={{ "--agent-color": event.agentColor ?? "#8b8494" } as React.CSSProperties}><Bot size={13} /></span>
            <span><span className="agent-identity"><strong>{event.ownerName ?? "所有者記録なし"}</strong><b>{event.agentName ?? "旧形式のエージェント"}</b>{event.agentId && <code title={event.agentId}>#{event.agentId.slice(0, 8)}</code>}</span><strong>{event.action}</strong>{event.summary}<time>{new Date(event.createdAt).toLocaleString("ja-JP")}</time></span>
          </div>)}</section>
      </SheetContent></Sheet>
    </main>
  );
}
