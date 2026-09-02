"use client";

import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, NodeProps, NodeResizer, Position } from "@xyflow/react";
import { CalendarDays, Check, ChevronDown, Copy, Database, Download, ExternalLink, ListFilter, LockKeyhole, Maximize2, MessageCircle, Minimize2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import UiSelect from "./ui-select";
import NumericStepper from "./numeric-stepper";
import { DatePicker } from "./date-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateInputValue, normalizeDateValue, type DateDisplayFormat } from "@/lib/mini-database-date";

export type BoardItemKind = "sticky" | "text" | "shape" | "card" | "frame" | "database" | "drawing" | "line" | "link";
export type DatabaseField = { id: string; name: string; type: "text" | "textarea" | "number" | "status" | "select" | "person" | "date"; options: string[]; optionColors: Record<string, string>; tableVisible: boolean; dateFormat?: DateDisplayFormat; system?: "updatedAt" };
export type DatabaseRecord = { id: string; values: Record<string, string> };
export type DatabaseFilter = { id: string; fieldId: string; operator: "contains" | "not_contains" | "equals" | "not_equals"; value: string };

export type BoardNodeData = {
  text: string;
  color: string;
  kind: BoardItemKind;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  shape: "rectangle" | "ellipse" | "diamond" | "triangle";
  status: "todo" | "doing" | "done";
  locked: boolean;
  commentCount: number;
  commentsVisible: boolean;
  reactions: Record<string, number>;
  databaseFields: DatabaseField[];
  databaseRecords: DatabaseRecord[];
  databaseId: string;
  availableDatabases: Array<{ id: string; name: string }>;
  databaseView: "table" | "kanban" | "gantt" | "calendar";
  tableVisibleFieldIds: string[];
  tableColumnWidths: Record<string, number>;
  tableRowHeight: number;
  kanbanGroupFieldId: string;
  ganttStartFieldId: string;
  ganttEndFieldId: string;
  ganttScale: "day" | "week" | "month";
  ganttRangeMode: "auto" | "fixed" | "relative";
  ganttFixedStart: string;
  ganttFixedEnd: string;
  ganttRelativeUnit: "week" | "month";
  ganttRelativeBefore: number;
  ganttRelativeAfter: number;
  calendarDateFieldId: string;
  calendarShowHolidays: boolean;
  calendarWeekStart: "sunday" | "monday";
  calendarScrollDirection: "vertical" | "horizontal";
  calendarRangeMode: "fixed" | "relative";
  calendarFixedStart: string;
  calendarFixedEnd: string;
  calendarRelativeBefore: number;
  calendarRelativeAfter: number;
  databaseFilters: DatabaseFilter[];
  databaseSortFieldId: string;
  databaseSortDirection: "asc" | "desc";
  drawingPath: string;
  drawingStrokeWidth: number;
  drawingBrush: "pen" | "marker" | "highlighter";
  frameRows: number;
  frameColumns: number;
  frameGridColor: string;
  frameImage: string;
  frameImageFit: "height" | "width" | "stretch";
  lineStartX: number;
  lineStartY: number;
  lineEndX: number;
  lineEndY: number;
  lineStrokeWidth: number;
  lineDashed: boolean;
  linkTitle: string;
  editingBy?: { name: string; color: string };
  showCollaborationIndicators?: boolean;
  onTextChange: (id: string, value: string) => void;
  onReaction: (id: string, emoji: string) => void;
  onEditingChange: (id: string, editing: boolean) => void;
  onDatabaseCellChange: (id: string, recordId: string, fieldId: string, value: string) => void;
  onDatabaseRecordChange: (id: string, recordId: string, values: Record<string, string>) => void;
  onDatabaseRecordAdd: (id: string) => void;
  onDatabaseViewChange: (id: string, view: "table" | "kanban" | "gantt" | "calendar") => void;
  onDatabaseConnect: (id: string, databaseId: string) => void;
  onDatabaseCreate: (id: string) => string;
  onDatabaseDisplaySettingsChange: (id: string, values: Record<string, unknown>) => void;
  onDatabaseQueryChange: (id: string, values: Record<string, unknown>) => void;
  onQuerySheetChange: (id: string, open: boolean, height: number) => void;
  onResizeStart: (id: string) => void;
  onResize: (id: string, width: number, height: number, x: number, y: number) => void;
  onLineGeometryChange: (id: string, values: { lineStartX: number; lineStartY: number; lineEndX: number; lineEndY: number }) => void;
  selectionOnly: boolean;
  fullscreen: boolean;
  onFullscreenChange: (id: string, fullscreen: boolean) => void;
};

function dateTime(value: string | undefined) {
  const datePart = value?.slice(0, 10);
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart) || datePart.includes("-00")) return null;
  const time = Date.parse(`${datePart}T00:00:00`); return Number.isNaN(time) ? null : time;
}

function dateValue(time: number) { return localDateKey(new Date(time)); }
function dateValueForField(time: number, field: DatabaseField) {
  const date = dateValue(time);
  return normalizeDateValue(field.dateFormat === "datetime" ? `${date}T00:00` : date, field.dateFormat ?? "date") ?? "";
}

const DAY_MS = 86400000;

function periodStart(unit: "week" | "month", source = new Date()) {
  const date = new Date(source); date.setHours(0, 0, 0, 0);
  if (unit === "month") date.setDate(1);
  else date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function addPeriod(time: number, unit: "week" | "month", amount: number) {
  const date = new Date(time);
  if (unit === "month") date.setMonth(date.getMonth() + amount);
  else date.setDate(date.getDate() + amount * 7);
  return date.getTime();
}

function timelineTicks(start: number, end: number, scale: "day" | "week" | "month") {
  const ticks: Array<{ time: number; label: string }> = [];
  let cursor = start;
  while (cursor <= end && ticks.length < 1000) {
    const date = new Date(cursor);
    const label = scale === "month" ? `${date.getFullYear()}/${date.getMonth() + 1}` : scale === "week" ? `${date.getMonth() + 1}/${date.getDate()}週` : `${date.getMonth() + 1}/${date.getDate()}(${["日", "月", "火", "水", "木", "金", "土"][date.getDay()]})`;
    ticks.push({ time: cursor, label });
    if (scale === "month") { date.setMonth(date.getMonth() + 1); cursor = date.getTime(); }
    else cursor += scale === "week" ? DAY_MS * 7 : DAY_MS;
  }
  return ticks;
}

const holidayCache = new Map<number, Map<string, string>>();
function localDateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function nthMonday(year: number, month: number, nth: number) {
  const first = new Date(year, month, 1); return 1 + ((8 - first.getDay()) % 7) + (nth - 1) * 7;
}
function japaneseHolidays(year: number) {
  const cached = holidayCache.get(year); if (cached) return cached;
  const holidays = new Map<string, string>();
  const add = (month: number, day: number, name: string) => holidays.set(localDateKey(new Date(year, month, day)), name);
  const spring = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  add(0, 1, "元日"); add(0, nthMonday(year, 0, 2), "成人の日"); add(1, 11, "建国記念の日"); add(1, 23, "天皇誕生日"); add(2, spring, "春分の日");
  add(3, 29, "昭和の日"); add(4, 3, "憲法記念日"); add(4, 4, "みどりの日"); add(4, 5, "こどもの日"); add(6, nthMonday(year, 6, 3), "海の日");
  add(7, 11, "山の日"); add(8, nthMonday(year, 8, 3), "敬老の日"); add(8, autumn, "秋分の日"); add(9, nthMonday(year, 9, 2), "スポーツの日"); add(10, 3, "文化の日"); add(10, 23, "勤労感謝の日");
  const baseDates = Array.from(holidays.keys()).sort();
  baseDates.forEach((key) => {
    const date = new Date(`${key}T00:00:00`); if (date.getDay() !== 0) return;
    do date.setDate(date.getDate() + 1); while (holidays.has(localDateKey(date)));
    holidays.set(localDateKey(date), "振替休日");
  });
  for (let month = 0; month < 12; month += 1) for (let day = 2; day <= 30; day += 1) {
    const date = new Date(year, month, day); if (date.getMonth() !== month || holidays.has(localDateKey(date))) continue;
    const before = new Date(date); before.setDate(day - 1); const after = new Date(date); after.setDate(day + 1);
    if (holidays.has(localDateKey(before)) && holidays.has(localDateKey(after))) holidays.set(localDateKey(date), "国民の休日");
  }
  holidayCache.set(year, holidays); return holidays;
}

function calendarCells(monthTime: number, weekStart: "sunday" | "monday") {
  const month = new Date(monthTime); const year = month.getFullYear(); const monthIndex = month.getMonth();
  const days = new Date(year, monthIndex + 1, 0).getDate(); const firstWeekday = new Date(year, monthIndex, 1).getDay();
  const offset = weekStart === "sunday" ? firstWeekday : (firstWeekday + 6) % 7;
  return Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => index < offset || index >= offset + days ? null : new Date(year, monthIndex, index - offset + 1));
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(protectedValue) ? `"${protectedValue.replaceAll('"', '""')}"` : protectedValue;
}

function setScaledDragPreview(event: React.DragEvent<HTMLElement>) {
  const source = event.currentTarget;
  const rect = source.getBoundingClientRect();
  const scale = source.offsetWidth > 0 ? rect.width / source.offsetWidth : 1;
  const frame = document.createElement("div");
  const preview = source.cloneNode(true) as HTMLElement;
  const sourceElements = [source, ...source.querySelectorAll<HTMLElement>("*")];
  const previewElements = [preview, ...preview.querySelectorAll<HTMLElement>("*")];
  sourceElements.forEach((element, index) => {
    const computed = getComputedStyle(element);
    const target = previewElements[index];
    for (const property of computed) target.style.setProperty(property, computed.getPropertyValue(property));
  });
  Object.assign(preview.style, {
    position: "absolute",
    left: "0",
    top: "0",
    margin: "0",
    width: `${source.offsetWidth}px`,
    height: `${source.offsetHeight}px`,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    pointerEvents: "none",
  });
  Object.assign(frame.style, {
    position: "fixed",
    left: "-10000px",
    top: "-10000px",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });
  frame.appendChild(preview);
  document.body.appendChild(frame);
  event.dataTransfer.setDragImage(frame, Math.max(0, event.clientX - rect.left), Math.max(0, event.clientY - rect.top));
  setTimeout(() => frame.remove(), 0);
}

function BoardNode({ id, data, selected }: NodeProps) {
  const item = data as BoardNodeData;
  const isFrame = item.kind === "frame";
  const isDatabase = item.kind === "database";
  const isDrawing = item.kind === "drawing";
  const isLine = item.kind === "line";
  const hasDragHandle = isFrame || isDatabase || item.kind === "shape" || item.kind === "text";
  const isLink = item.kind === "link";
  const doubleClickToEdit = item.kind === "shape" || item.kind === "text";
  const readOnly = item.locked || Boolean(item.editingBy) || item.selectionOnly;
  const onEditingChange = item.onEditingChange;
  const onQuerySheetChange = item.onQuerySheetChange;
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [tableMenu, setTableMenu] = useState<React.CSSProperties | null>(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryHeight, setQueryHeight] = useState(330);
  const [filterAccordionOpen, setFilterAccordionOpen] = useState(true);
  const [sortAccordionOpen, setSortAccordionOpen] = useState(true);
  const [filterSelectionMode, setFilterSelectionMode] = useState(false);
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([]);
  const [textEditing, setTextEditing] = useState(false);
  const [lineDraft, setLineDraft] = useState(() => ({ lineStartX: item.lineStartX, lineStartY: item.lineStartY, lineEndX: item.lineEndX, lineEndY: item.lineEndY }));
  const [tableColumnWidthsDraft, setTableColumnWidthsDraft] = useState<Record<string, number> | null>(null);
  const [tableRowHeightDraft, setTableRowHeightDraft] = useState<number | null>(null);
  const [ganttDrafts, setGanttDrafts] = useState<Record<string, { start: number; end: number }>>({});
  const lineDraftRef = useRef(lineDraft);
  const lineDragCleanupRef = useRef<(() => void) | null>(null);
  const tableResizeCleanupRef = useRef<(() => void) | null>(null);
  const tableMenuRef = useRef<HTMLDivElement>(null);
  const tableMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => onEditingChange(id, false), [id, onEditingChange]);
  useEffect(() => () => lineDragCleanupRef.current?.(), []);
  useEffect(() => () => tableResizeCleanupRef.current?.(), []);
  useEffect(() => {
    const next = { lineStartX: item.lineStartX, lineStartY: item.lineStartY, lineEndX: item.lineEndX, lineEndY: item.lineEndY };
    lineDraftRef.current = next;
    const frame = requestAnimationFrame(() => setLineDraft(next));
    return () => cancelAnimationFrame(frame);
  }, [item.lineEndX, item.lineEndY, item.lineStartX, item.lineStartY]);
  useEffect(() => {
    if (!tableMenu) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (target instanceof Element && target.closest(".ui-select__menu")) return;
      if (!tableMenuRef.current?.contains(target) && !tableMenuButtonRef.current?.contains(target)) setTableMenu(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [tableMenu]);
  useEffect(() => {
    onQuerySheetChange(id, queryOpen, queryHeight);
    return () => onQuerySheetChange(id, false, 0);
  }, [id, onQuerySheetChange, queryHeight, queryOpen]);
  const openQuery = () => { setQueryOpen(true); onEditingChange(id, true); };
  const closeQuery = () => { setQueryOpen(false); onEditingChange(id, false); };

  const csv = [item.databaseFields.map((field) => csvCell(field.name)).join(","), ...item.databaseRecords.map((record) => item.databaseFields.map((field) => csvCell(record.values[field.id] ?? "")).join(","))].join("\r\n");
  const downloadCsv = () => {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })); link.download = `${item.text || "mini-database"}.csv`; link.click(); URL.revokeObjectURL(link.href); setTableMenu(null);
  };
  const copyCsv = async () => { await navigator.clipboard.writeText(csv); setTableMenu(null); };

  const titleField = item.databaseFields.find((field) => field.id === "title") ?? item.databaseFields[0];
  const kanbanFields = item.databaseFields.filter((field) => (field.type === "status" || field.type === "select") && field.options.length > 0);
  const kanbanField = kanbanFields.find((field) => field.id === item.kanbanGroupFieldId) ?? kanbanFields[0];
  const personField = item.databaseFields.find((field) => field.type === "person");
  const dateFields = item.databaseFields.filter((field) => field.type === "date" && !field.system && ["date", "datetime"].includes(field.dateFormat ?? "date"));
  const startField = dateFields.find((field) => field.id === item.ganttStartFieldId) ?? dateFields.find((field) => field.id === "startDate") ?? dateFields[0];
  const endField = dateFields.find((field) => field.id === item.ganttEndFieldId && field.id !== startField?.id) ?? dateFields.find((field) => field.id === "endDate" && field.id !== startField?.id) ?? dateFields.find((field) => field.id !== startField?.id);
  const tableFields = item.databaseFields.filter((field) => field.tableVisible);
  const tableColumnWidths = tableColumnWidthsDraft ?? item.tableColumnWidths;
  const tableRowHeight = tableRowHeightDraft ?? item.tableRowHeight;
  const defaultColumnWidth = (field: DatabaseField) => field.type === "textarea" ? 260 : field.type === "text" ? 210 : 160;
  const tableGridColumns = tableFields.map((field) => `${tableColumnWidths[field.id] ?? defaultColumnWidth(field)}px`).join(" ");
  const sortField = item.databaseFields.find((field) => field.id === item.databaseSortFieldId);
  const queriedRecords = item.databaseRecords.filter((record) => {
    return item.databaseFilters.every((filter) => {
      const field = item.databaseFields.find((entry) => entry.id === filter.fieldId);
      if (!field || !filter.value) return true;
      const actual = record.values[field.id] ?? ""; const expected = filter.value;
      if (filter.operator === "equals") return actual === expected;
      if (filter.operator === "not_equals") return actual !== expected;
      const contains = actual.toLocaleLowerCase("ja").includes(expected.toLocaleLowerCase("ja"));
      return filter.operator === "not_contains" ? !contains : contains;
    });
  }).sort((left, right) => {
    if (!sortField) return 0;
    const result = (left.values[sortField.id] ?? "").localeCompare(right.values[sortField.id] ?? "", "ja", { numeric: true });
    return item.databaseSortDirection === "desc" ? -result : result;
  });
  const kanbanGroups = kanbanField?.options ?? [];
  const canKanban = kanbanFields.length > 0;
  const canGantt = dateFields.length >= 2;
  const databaseViewLabel = item.databaseView === "table" ? "表" : item.databaseView === "kanban" ? "看板" : item.databaseView === "gantt" ? "ガント" : "カレンダー";
  const ganttRecords = queriedRecords.map((record) => ({ record, start: dateTime(record.values[startField?.id ?? "startDate"]), end: dateTime(record.values[endField?.id ?? "endDate"]) }))
    .filter((entry): entry is { record: DatabaseRecord; start: number; end: number } => entry.start !== null && entry.end !== null);
  const autoRangeStart = ganttRecords.length ? Math.min(...ganttRecords.map((entry) => entry.start)) : periodStart("week");
  const autoRangeEnd = ganttRecords.length ? Math.max(...ganttRecords.map((entry) => Math.max(entry.start, entry.end))) : autoRangeStart + DAY_MS * 6;
  const fixedStart = dateTime(item.ganttFixedStart);
  const fixedEnd = dateTime(item.ganttFixedEnd);
  const relativeBase = periodStart(item.ganttRelativeUnit);
  const relativeStart = addPeriod(relativeBase, item.ganttRelativeUnit, -Math.max(0, item.ganttRelativeBefore));
  const relativeEnd = addPeriod(relativeBase, item.ganttRelativeUnit, Math.max(0, item.ganttRelativeAfter) + 1) - DAY_MS;
  const invalidFixedRange = item.ganttRangeMode === "fixed" && (fixedStart === null || fixedEnd === null || fixedStart > fixedEnd);
  const rangeStart = item.ganttRangeMode === "fixed" && !invalidFixedRange ? fixedStart! : item.ganttRangeMode === "relative" ? relativeStart : autoRangeStart;
  const rangeEnd = item.ganttRangeMode === "fixed" && !invalidFixedRange ? fixedEnd! : item.ganttRangeMode === "relative" ? relativeEnd : autoRangeEnd;
  const range = Math.max(DAY_MS, rangeEnd - rangeStart + DAY_MS);
  const ticks = timelineTicks(rangeStart, rangeEnd, item.ganttScale);
  const timelineWidth = Math.max(540, ticks.length * (item.ganttScale === "day" ? 58 : item.ganttScale === "week" ? 88 : 112));
  const visibleGanttRecords = ganttRecords.filter(({ start, end }) => Math.max(start, end) >= rangeStart && start <= rangeEnd);
  const startGanttDrag = (mode: "start" | "move" | "end", record: DatabaseRecord, start: number, end: number, event: React.PointerEvent<HTMLElement>) => {
    if (readOnly || !startField || !endField) return;
    event.preventDefault(); event.stopPropagation();
    const track = event.currentTarget.closest(".gantt-track"); if (!(track instanceof HTMLElement)) return;
    const bounds = track.getBoundingClientRect(); const startX = event.clientX; let draft = { start, end };
    const move = (pointerEvent: PointerEvent) => {
      const deltaDays = Math.round((pointerEvent.clientX - startX) / bounds.width * range / DAY_MS);
      draft = mode === "move" ? { start: start + deltaDays * DAY_MS, end: end + deltaDays * DAY_MS }
        : mode === "start" ? { start: Math.min(end, start + deltaDays * DAY_MS), end }
          : { start, end: Math.max(start, end + deltaDays * DAY_MS) };
      setGanttDrafts((current) => ({ ...current, [record.id]: draft }));
    };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
    const finish = () => { cleanup(); setGanttDrafts((current) => { const next = { ...current }; delete next[record.id]; return next; }); item.onDatabaseRecordChange(id, record.id, { [startField.id]: dateValueForField(draft.start, startField), [endField.id]: dateValueForField(draft.end, endField) }); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
  };
  const calendarDateField = dateFields.find((field) => field.id === item.calendarDateFieldId) ?? startField ?? dateFields[0];
  const calendarFixedStart = dateTime(item.calendarFixedStart);
  const calendarFixedEnd = dateTime(item.calendarFixedEnd);
  const invalidCalendarFixedRange = item.calendarRangeMode === "fixed" && (calendarFixedStart === null || calendarFixedEnd === null || calendarFixedStart > calendarFixedEnd);
  const calendarStart = item.calendarRangeMode === "fixed" && !invalidCalendarFixedRange ? calendarFixedStart! : addPeriod(periodStart("month"), "month", -Math.max(0, item.calendarRelativeBefore));
  const calendarEnd = item.calendarRangeMode === "fixed" && !invalidCalendarFixedRange ? calendarFixedEnd! : addPeriod(periodStart("month"), "month", Math.max(0, item.calendarRelativeAfter) + 1) - DAY_MS;
  const calendarMonthTimes: number[] = [];
  let calendarCursor = periodStart("month", new Date(calendarStart));
  const calendarLastMonth = periodStart("month", new Date(calendarEnd));
  while (calendarCursor <= calendarLastMonth && calendarMonthTimes.length < 60) { calendarMonthTimes.push(calendarCursor); calendarCursor = addPeriod(calendarCursor, "month", 1); }
  const scrollDatabaseView = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY || event.deltaX;
  };
  const scrollCalendarView = (event: React.WheelEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const delta = event.deltaY || event.deltaX;
    if (event.shiftKey) event.currentTarget.scrollLeft += delta;
    else event.currentTarget.scrollTop += delta;
  };
  const startTableColumnResize = (field: DatabaseField, event: React.PointerEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    event.preventDefault(); event.stopPropagation();
    const startX = event.clientX; const startWidth = tableColumnWidths[field.id] ?? defaultColumnWidth(field);
    let nextWidths = tableColumnWidths;
    const move = (pointerEvent: PointerEvent) => { nextWidths = { ...tableColumnWidths, [field.id]: Math.max(90, Math.min(720, startWidth + pointerEvent.clientX - startX)) }; setTableColumnWidthsDraft(nextWidths); };
    const finish = () => { cleanup(); item.onDatabaseDisplaySettingsChange(id, { tableColumnWidths: nextWidths }); setTableColumnWidthsDraft(null); };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); tableResizeCleanupRef.current = null; };
    tableResizeCleanupRef.current?.(); tableResizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
  };
  const autoFitTableColumn = (field: DatabaseField, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    const table = event.currentTarget.closest(".database-table"); if (!(table instanceof HTMLElement)) return;
    const index = tableFields.findIndex((entry) => entry.id === field.id); if (index < 0) return;
    const cells = table.querySelectorAll<HTMLElement>(`.database-row > :nth-child(${index + 1})`);
    let width = defaultColumnWidth(field);
    cells.forEach((cell) => {
      const control = cell.matches("input, textarea") ? cell as HTMLInputElement | HTMLTextAreaElement : cell.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
      const contentWidth = control ? Math.ceil((control.value || control.placeholder).length * 8.5 + 38) : cell.scrollWidth + 24;
      width = Math.max(width, contentWidth);
    });
    const nextWidths = { ...tableColumnWidths, [field.id]: Math.min(720, width) };
    item.onDatabaseDisplaySettingsChange(id, { tableColumnWidths: nextWidths });
  };
  const startTableRowResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    event.preventDefault(); event.stopPropagation();
    const startY = event.clientY; const startHeight = tableRowHeight; let nextHeight = startHeight;
    const move = (pointerEvent: PointerEvent) => { nextHeight = Math.max(34, Math.min(160, startHeight + pointerEvent.clientY - startY)); setTableRowHeightDraft(nextHeight); };
    const finish = () => { cleanup(); item.onDatabaseDisplaySettingsChange(id, { tableRowHeight: nextHeight }); setTableRowHeightDraft(null); };
    const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); tableResizeCleanupRef.current = null; };
    tableResizeCleanupRef.current?.(); tableResizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", finish); window.addEventListener("pointercancel", finish);
  };
  const choiceField = (field: DatabaseField | undefined) => field?.type === "select" || field?.type === "status";
  const updateFilters = (databaseFilters: DatabaseFilter[]) => item.onDatabaseQueryChange(id, { filters: databaseFilters });
  const addFilter = () => {
    const field = item.databaseFields[0];
    if (!field) return;
    updateFilters([...item.databaseFilters, { id: crypto.randomUUID(), fieldId: field.id, operator: choiceField(field) ? "equals" : "contains", value: choiceField(field) ? field.options[0] ?? "" : "" }]);
    setFilterAccordionOpen(true);
  };
  const updateFilter = (filterId: string, values: Partial<DatabaseFilter>) => updateFilters(item.databaseFilters.map((filter) => filter.id === filterId ? { ...filter, ...values } : filter));
  const deleteSelectedFilters = () => {
    updateFilters(item.databaseFilters.filter((filter) => !selectedFilterIds.includes(filter.id)));
    setSelectedFilterIds([]); setFilterSelectionMode(false);
  };
  const moveLineEndpoint = (endpoint: "start" | "end", clientX: number, clientY: number, bounds: DOMRect, constrainAxis: boolean) => {
    let x = ((clientX - bounds.left) / bounds.width) * 1000;
    let y = ((clientY - bounds.top) / bounds.height) * 1000;
    if (constrainAxis) {
      const fixedX = endpoint === "start" ? lineDraftRef.current.lineEndX : lineDraftRef.current.lineStartX;
      const fixedY = endpoint === "start" ? lineDraftRef.current.lineEndY : lineDraftRef.current.lineStartY;
      if (Math.abs(x - fixedX) >= Math.abs(y - fixedY)) y = fixedY; else x = fixedX;
    }
    const next = endpoint === "start" ? { ...lineDraftRef.current, lineStartX: x, lineStartY: y } : { ...lineDraftRef.current, lineEndX: x, lineEndY: y };
    lineDraftRef.current = next;
    setLineDraft(next);
  };
  const startLineEndpointDrag = (endpoint: "start" | "end", event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    const root = event.currentTarget.closest(".board-node"); if (!(root instanceof HTMLElement)) return;
    const bounds = root.getBoundingClientRect();
    const move = (pointerEvent: PointerEvent) => moveLineEndpoint(endpoint, pointerEvent.clientX, pointerEvent.clientY, bounds, pointerEvent.shiftKey);
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      lineDragCleanupRef.current = null;
    };
    const finish = () => { cleanup(); item.onLineGeometryChange(id, lineDraftRef.current); };
    lineDragCleanupRef.current?.();
    lineDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div
      className={`board-node board-node--${item.kind} board-node--${item.shape} ${selected ? "is-selected" : ""} ${item.locked ? "is-locked" : ""} ${item.selectionOnly ? "is-selection-only" : ""} ${item.fullscreen ? "is-fullscreen" : ""}`}
      style={{
        "--node-color": item.color,
        "--node-font-size": `${item.fontSize}px`,
        "--node-text-align": item.textAlign,
        "--node-vertical-align": item.verticalAlign === "top" ? "start" : item.verticalAlign === "bottom" ? "end" : "center",
        "--frame-grid-color": item.frameGridColor,
        ...(isFrame && item.frameImage ? { backgroundImage: `url(${item.frameImage})`, backgroundSize: item.frameImageFit === "height" ? "auto 100%" : item.frameImageFit === "width" ? "100% auto" : "100% 100%", backgroundPosition: "center", backgroundRepeat: "no-repeat" } : {}),
      } as React.CSSProperties}
    >
      {!isDrawing && !isLine && <NodeResizer isVisible={selected && !readOnly} minWidth={isDatabase ? 420 : 120} minHeight={isDatabase ? 260 : 60} lineClassName="node-resizer-line" handleClassName="node-resizer-handle" onResizeStart={() => item.onResizeStart(id)} onResizeEnd={(_, params) => item.onResize(id, params.width, params.height, params.x, params.y)} />}
      {hasDragHandle && <div className="node-drag-handle" title="ドラッグして移動" />}
      {!isFrame && !isDrawing && !isLine && <>
        <Handle id="top" type="source" position={Position.Top} className="connection-handle connection-handle--top" />
        <Handle id="bottom" type="source" position={Position.Bottom} className="connection-handle connection-handle--bottom" />
        <Handle id="left" type="source" position={Position.Left} className="connection-handle connection-handle--left" />
        <Handle id="right" type="source" position={Position.Right} className="connection-handle connection-handle--right" />
      </>}
      {item.locked && <span className="node-lock" title="ロック中"><LockKeyhole size={13} /></span>}
      {item.editingBy && item.showCollaborationIndicators !== false && <span className="editing-indicator" style={{ "--editor-color": item.editingBy.color } as React.CSSProperties} title={`${item.editingBy.name} が編集中`} aria-label={`${item.editingBy.name} が編集中`}><Pencil size={12} /></span>}
      {item.kind === "card" && <span className={`card-status card-status--${item.status}`}>{item.status === "todo" ? "未着手" : item.status === "doing" ? "進行中" : "完了"}</span>}
      {isDatabase ? <div className="database-node-content">
        <div className="database-header">
          <Database size={18} />
          <div className="database-connection nodrag" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setConnectionOpen(false); }}>
            <Button variant="ghost" className="database-connection__trigger" aria-label="接続するデータベース" aria-haspopup="listbox" aria-expanded={connectionOpen} onClick={() => setConnectionOpen((open) => !open)}>
              <span className={!item.databaseId ? "is-empty" : ""}>{item.databaseId ? item.text : "データベースを選択"}</span><ChevronDown size={14} />
            </Button>
            {connectionOpen && <div className="database-picker" role="listbox" aria-label="データベース接続先">
              <div className="database-picker__label">接続先</div>
              <Button variant="ghost" role="option" aria-selected={!item.databaseId} className={!item.databaseId ? "is-selected" : ""} onClick={() => { item.onDatabaseConnect(id, ""); setConnectionOpen(false); }}>
                <span className="database-picker__icon is-empty"><Database size={14} /></span><span><strong>未接続</strong><small>データを表示しない</small></span>{!item.databaseId && <Check size={14} />}
              </Button>
              {item.availableDatabases.map((database) => <Button variant="ghost" role="option" aria-selected={item.databaseId === database.id} className={item.databaseId === database.id ? "is-selected" : ""} key={database.id} onClick={() => { item.onDatabaseConnect(id, database.id); setConnectionOpen(false); }}>
                <span className="database-picker__icon"><Database size={14} /></span><span><strong>{database.name}</strong><small>既存データベース</small></span>{item.databaseId === database.id && <Check size={14} />}
              </Button>)}
              <div className="database-picker__divider" />
              <Button variant="ghost" className="database-picker__create" onClick={() => { item.onDatabaseCreate(id); setConnectionOpen(false); }}><Plus /><span><strong>新しく作成</strong><small>空のデータベース</small></span></Button>
            </div>}
          </div>
          <Button size="icon-sm" variant="ghost" className="database-header-action nodrag" aria-label={item.fullscreen ? "全画面表示を終了" : "全画面表示"} title={item.fullscreen ? "全画面表示を終了" : "全画面表示"} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); item.onFullscreenChange(id, !item.fullscreen); }}>{item.fullscreen ? <Minimize2 /> : <Maximize2 />}</Button>
          <Button size="icon-sm" variant="ghost" className={`database-header-action nodrag ${item.databaseFilters.length > 0 || item.databaseSortFieldId ? "is-active" : ""}`} aria-label="ソート/フィルタ" title="ソート/フィルタ" disabled={!item.databaseId} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openQuery(); }}><ListFilter /></Button>
          <Button size="icon-sm" variant="ghost" className="database-header-action nodrag" aria-label="レコードを追加" title="レコードを追加" disabled={!item.databaseId || readOnly} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); item.onDatabaseRecordAdd(id); }}><Plus /></Button>
          <Button size="icon-sm" variant="ghost"
            ref={tableMenuButtonRef}
            className="database-more nodrag"
            aria-label={`${databaseViewLabel}メニュー`}
            title={`${databaseViewLabel}の表示設定とCSV操作`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setTableMenu((menu) => menu ? null : { right: 12, top: 48 });
            }}
          ><MoreHorizontal /></Button>
          <div className="database-view-switch nodrag">
            <Button size="xs" variant={item.databaseView === "table" ? "secondary" : "ghost"} className={item.databaseView === "table" ? "is-active" : ""} onClick={() => item.onDatabaseViewChange(id, "table")}>表</Button>
            <Button size="xs" variant={item.databaseView === "kanban" ? "secondary" : "ghost"} disabled={!item.databaseId || !canKanban} title={!canKanban ? "ステータス列と選択肢が必要です" : undefined} className={item.databaseView === "kanban" ? "is-active" : ""} onClick={() => item.onDatabaseViewChange(id, "kanban")}>看板</Button>
            <Button size="xs" variant={item.databaseView === "gantt" ? "secondary" : "ghost"} disabled={!item.databaseId || !canGantt} title={!canGantt ? "日付列が2列必要です" : undefined} className={item.databaseView === "gantt" ? "is-active" : ""} onClick={() => item.onDatabaseViewChange(id, "gantt")}>ガント</Button>
            <Button size="xs" variant={item.databaseView === "calendar" ? "secondary" : "ghost"} disabled={!item.databaseId || dateFields.length === 0} title={dateFields.length === 0 ? "日付列が必要です" : undefined} className={item.databaseView === "calendar" ? "is-active" : ""} onClick={() => item.onDatabaseViewChange(id, "calendar")}>カレンダー</Button>
          </div>
        </div>
        {!item.databaseId ? <div className="database-unconnected nodrag"><Database size={30} /><strong>データベースに接続されていません</strong><span>上の選択欄から既存データベースへ接続するか、新しく作成してください。</span></div> : item.databaseView === "table" ? <div className="database-table database-scroll-region nodrag nowheel" style={{ "--database-columns": tableGridColumns, "--database-row-height": `${tableRowHeight}px` } as React.CSSProperties} onWheel={scrollDatabaseView}>
          <div className="database-row database-row--head">{tableFields.map((field) => <strong key={field.id}>{field.name}<button className="database-column-resizer" aria-label={`${field.name}の列幅を変更`} title="ドラッグで列幅変更・ダブルクリックで内容に合わせる" onPointerDown={(event) => startTableColumnResize(field, event)} onDoubleClick={(event) => autoFitTableColumn(field, event)} /></strong>)}<button className="database-row-resizer" aria-label="表の行の高さを変更" title="ドラッグで全行の高さを変更" onPointerDown={startTableRowResize} /></div>
          {queriedRecords.map((record) => <div className="database-row" key={record.id}>{tableFields.map((field) => field.type === "status" || field.type === "select" ?
            <UiSelect key={field.id} ariaLabel={`${field.name}を選択`} value={record.values[field.id] ?? field.options[0] ?? ""} disabled={readOnly} options={(record.values[field.id] && !field.options.includes(record.values[field.id]) ? [...field.options, record.values[field.id]] : field.options).map((group) => ({ value: group, label: group, color: field.optionColors[group] }))}
              onOpenChange={(open) => item.onEditingChange(id, open)} onChange={(value) => item.onDatabaseCellChange(id, record.id, field.id, value)} /> :
            field.type === "date" && (field.dateFormat ?? "date") === "date" ? <DatePicker key={field.id} ariaLabel={`${field.name}の日付`} value={dateInputValue(record.values[field.id] ?? "", "date")} disabled={readOnly || Boolean(field.system)}
              onOpenChange={(open) => { if (!field.system) item.onEditingChange(id, open); }}
              onChange={(inputValue) => {
                if (field.system) return;
                const value = normalizeDateValue(inputValue, "date");
                if (value === null) throw new Error("日付の形式が不正です。");
                item.onDatabaseCellChange(id, record.id, field.id, value);
              }} /> :
            field.type === "textarea" ? <Textarea className="database-cell-textarea" key={field.id} value={record.values[field.id] ?? ""} readOnly={readOnly}
              onFocus={() => item.onEditingChange(id, true)} onBlur={() => item.onEditingChange(id, false)}
              onChange={(event) => item.onDatabaseCellChange(id, record.id, field.id, event.target.value)} /> :
            <Input key={field.id}
              type={field.type === "date" ? field.dateFormat === "datetime" ? "datetime-local" : field.dateFormat === "month" ? "month" : field.dateFormat === "hour" || field.dateFormat === "time" ? "time" : "date" : field.type === "number" ? "number" : "text"}
              step={field.type === "number" ? "any" : field.dateFormat === "hour" ? 3600 : undefined}
              value={field.type === "date" ? dateInputValue(record.values[field.id] ?? "", field.dateFormat ?? "date") : record.values[field.id] ?? ""} readOnly={readOnly || Boolean(field.system)}
              onFocus={() => { if (!field.system) item.onEditingChange(id, true); }} onBlur={() => item.onEditingChange(id, false)}
              onChange={(event) => {
                if (field.system) return;
                const value = field.type === "date" ? normalizeDateValue(event.target.value, field.dateFormat ?? "date") : event.target.value;
                if (value !== null) item.onDatabaseCellChange(id, record.id, field.id, value);
              }} />)}</div>)}
        </div> : item.databaseView === "kanban" ? <div className="database-kanban database-scroll-region nodrag nowheel" onWheel={scrollDatabaseView}>{kanbanGroups.map((group) => <section key={group} onDragOver={(event) => { if (!readOnly) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const recordId = event.dataTransfer.getData("application/x-mingleboard-record"); if (recordId && kanbanField) item.onDatabaseCellChange(id, recordId, kanbanField.id, group); }}><header className="database-kanban-status" style={kanbanField?.optionColors[group] ? { background: kanbanField.optionColors[group] } : undefined}>{group}<span>{queriedRecords.filter((record) => (record.values[kanbanField?.id ?? ""] ?? kanbanGroups[0] ?? "") === group).length}</span></header>
          {queriedRecords.filter((record) => (record.values[kanbanField?.id ?? ""] ?? kanbanGroups[0] ?? "") === group).map((record) => <article draggable={!readOnly} className={!readOnly ? "is-draggable" : ""} onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData("application/x-mingleboard-record", record.id); event.dataTransfer.effectAllowed = "move"; setScaledDragPreview(event); }} key={record.id}><strong>{record.values[titleField?.id ?? "title"] || "無題"}</strong><small>{record.values[personField?.id ?? "owner"] || "未担当"}</small><small>{record.values[startField?.id ?? "startDate"] || "日付未設定"} → {record.values[endField?.id ?? "endDate"] || "日付未設定"}</small></article>)}</section>)}</div> :
        item.databaseView === "gantt" ?
          <div className="database-gantt database-scroll-region nodrag nowheel" onWheel={scrollDatabaseView}>
            {invalidFixedRange ? <div className="gantt-empty gantt-empty--error">固定期間の開始日と終了日を正しく設定してください。</div> : <div className="gantt-content" style={{ width: timelineWidth + 150 }}>
              <div className="gantt-axis"><strong>タスク</strong><div className="gantt-ticks" style={{ gridTemplateColumns: `repeat(${ticks.length}, 1fr)` }}>{ticks.map((tick) => <span key={tick.time}>{tick.label}</span>)}</div></div>
              {ganttRecords.length === 0 ? <div className="gantt-empty">表表示で開始日と終了日を設定してください。</div> : visibleGanttRecords.length === 0 ? <div className="gantt-empty">指定期間内のレコードはありません。</div> : visibleGanttRecords.map(({ record, start, end }) => {
                const draft = ganttDrafts[record.id]; const currentStart = draft?.start ?? start; const currentEnd = draft?.end ?? end;
                const visibleStart = Math.min(rangeEnd, Math.max(currentStart, rangeStart)); const visibleEnd = Math.max(rangeStart, Math.min(Math.max(currentStart, currentEnd), rangeEnd));
                const left = ((visibleStart - rangeStart) / range) * 100; const width = Math.max(1.5, ((visibleEnd - visibleStart + DAY_MS) / range) * 100);
                return <div className="gantt-row" key={record.id}><strong>{record.values[titleField?.id ?? "title"] || "無題"}</strong><div className="gantt-track" style={{ "--gantt-ticks": ticks.length } as React.CSSProperties}><span className={!readOnly ? "is-editable" : ""} onPointerDown={(event) => startGanttDrag("move", record, currentStart, currentEnd, event)} style={{ left: `${left}%`, width: `${Math.max(1.5, Math.min(100 - left, width))}%` }}><button aria-label={`${record.values[titleField?.id ?? "title"] || "無題"}の開始日を変更`} onPointerDown={(event) => startGanttDrag("start", record, currentStart, currentEnd, event)} /><em>{dateValue(currentStart)} → {dateValue(currentEnd)}</em><button aria-label={`${record.values[titleField?.id ?? "title"] || "無題"}の終了日を変更`} onPointerDown={(event) => startGanttDrag("end", record, currentStart, currentEnd, event)} /></span></div></div>;
              })}
            </div>}
          </div> : <div className={`database-calendar database-calendar--${item.calendarScrollDirection} database-scroll-region nodrag nowheel`} onWheel={scrollCalendarView}>
            {invalidCalendarFixedRange ? <div className="gantt-empty gantt-empty--error">カレンダーの固定期間を正しく設定してください。</div> : calendarMonthTimes.map((monthTime) => {
              const month = new Date(monthTime); const weekdayLabels = item.calendarWeekStart === "sunday" ? ["日", "月", "火", "水", "木", "金", "土"] : ["月", "火", "水", "木", "金", "土", "日"];
              return <section className="calendar-month" key={monthTime}><header><CalendarDays size={14} /><strong>{month.getFullYear()}年{month.getMonth() + 1}月</strong></header><div className="calendar-weekdays">{weekdayLabels.map((label) => <span key={label}>{label}</span>)}</div><div className="calendar-days">{calendarCells(monthTime, item.calendarWeekStart).map((date, index) => {
                if (!date) return <span className="calendar-day is-empty" key={`empty-${index}`} />;
                const key = localDateKey(date); const holiday = item.calendarShowHolidays ? japaneseHolidays(date.getFullYear()).get(key) : undefined; const records = queriedRecords.filter((record) => record.values[calendarDateField?.id ?? ""] === key);
                return <article className={`calendar-day ${holiday ? "is-holiday" : ""}`} key={key}><time>{date.getDate()}</time>{holiday && <small title={holiday}>{holiday}</small>}{records.slice(0, 3).map((record) => <b key={record.id}>{record.values[titleField?.id ?? "title"] || "無題"}</b>)}{records.length > 3 && <i>+{records.length - 3}</i>}</article>;
              })}</div></section>;
            })}
          </div>}
        {tableMenu && <div ref={tableMenuRef} className="database-context-menu nodrag nowheel" aria-label="表示設定とCSV" style={tableMenu} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
          <header><strong>表示設定</strong><small>{databaseViewLabel}</small></header>
          {item.databaseView === "kanban" && <section><label className="database-setting-field"><span>分類に使う選択肢列</span><UiSelect ariaLabel="看板の分類列" value={kanbanField?.id ?? ""} options={kanbanFields.map((field) => ({ value: field.id, label: field.name }))} onChange={(kanbanGroupFieldId) => item.onDatabaseDisplaySettingsChange(id, { kanbanGroupFieldId })} /></label><p>同じDBでも、この表示オブジェクトだけに適用されます。</p></section>}
          {item.databaseView === "gantt" && <section className="database-gantt-settings">
            <div className="database-setting-grid"><label className="database-setting-field"><span>開始日列</span><UiSelect ariaLabel="ガントの開始日列" value={startField?.id ?? ""} options={dateFields.map((field) => ({ value: field.id, label: field.name, disabled: field.id === endField?.id }))} onChange={(ganttStartFieldId) => item.onDatabaseDisplaySettingsChange(id, { ganttStartFieldId })} /></label><label className="database-setting-field"><span>終了日列</span><UiSelect ariaLabel="ガントの終了日列" value={endField?.id ?? ""} options={dateFields.map((field) => ({ value: field.id, label: field.name, disabled: field.id === startField?.id }))} onChange={(ganttEndFieldId) => item.onDatabaseDisplaySettingsChange(id, { ganttEndFieldId })} /></label></div>
            <label className="database-setting-field"><span>表示単位</span><UiSelect ariaLabel="ガントの表示単位" value={item.ganttScale} options={[{ value: "day", label: "日" }, { value: "week", label: "週" }, { value: "month", label: "月" }]} onChange={(ganttScale) => item.onDatabaseDisplaySettingsChange(id, { ganttScale })} /></label>
            <label className="database-setting-field"><span>表示期間</span><UiSelect ariaLabel="ガントの表示期間" value={item.ganttRangeMode} options={[{ value: "auto", label: "データ範囲に合わせる" }, { value: "fixed", label: "開始日・終了日を固定" }, { value: "relative", label: "当週・当月から相対指定" }]} onChange={(ganttRangeMode) => item.onDatabaseDisplaySettingsChange(id, { ganttRangeMode })} /></label>
            {item.ganttRangeMode === "fixed" && <div className="gantt-fixed-range"><label><span>開始日</span><Input aria-label="固定期間の開始日" type="date" value={item.ganttFixedStart} onChange={(event) => item.onDatabaseDisplaySettingsChange(id, { ganttFixedStart: event.target.value })} /></label><label><span>終了日</span><Input aria-label="固定期間の終了日" type="date" value={item.ganttFixedEnd} onChange={(event) => item.onDatabaseDisplaySettingsChange(id, { ganttFixedEnd: event.target.value })} /></label>{invalidFixedRange && <p>開始日は終了日以前に設定してください。</p>}</div>}
            {item.ganttRangeMode === "relative" && <div className="gantt-relative-range"><label className="database-setting-field"><span>基準期間（現在を含む）</span><UiSelect ariaLabel="相対期間の基準" value={item.ganttRelativeUnit} options={[{ value: "week", label: "当週" }, { value: "month", label: "当月" }]} onChange={(ganttRelativeUnit) => item.onDatabaseDisplaySettingsChange(id, { ganttRelativeUnit })} /></label><div><label><span>前</span><NumericStepper ariaLabel="基準より前の期間数" min={0} max={24} value={item.ganttRelativeBefore} onChange={(ganttRelativeBefore) => item.onDatabaseDisplaySettingsChange(id, { ganttRelativeBefore })} /></label><label><span>後</span><NumericStepper ariaLabel="基準より後の期間数" min={0} max={24} value={item.ganttRelativeAfter} onChange={(ganttRelativeAfter) => item.onDatabaseDisplaySettingsChange(id, { ganttRelativeAfter })} /></label></div><p>例：当月・前2・後1で、前々月から翌月まで表示します。</p></div>}
          </section>}
          {item.databaseView === "calendar" && <section className="database-calendar-settings">
            <label className="database-setting-field"><span>表示する日付列</span><UiSelect ariaLabel="カレンダーの日付列" value={calendarDateField?.id ?? ""} options={dateFields.map((field) => ({ value: field.id, label: field.name }))} onChange={(calendarDateFieldId) => item.onDatabaseDisplaySettingsChange(id, { calendarDateFieldId })} /></label>
            <label className="calendar-holiday-toggle"><span><strong>日本の祝日を表示</strong><small>祝日名を日付内に表示します</small></span><Checkbox aria-label="祝日を表示" checked={item.calendarShowHolidays} onCheckedChange={(checked) => item.onDatabaseDisplaySettingsChange(id, { calendarShowHolidays: checked === true })} /></label>
            <label className="database-setting-field"><span>週の始まり</span><UiSelect ariaLabel="カレンダーの週始まり" value={item.calendarWeekStart} options={[{ value: "sunday", label: "日曜日" }, { value: "monday", label: "月曜日" }]} onChange={(calendarWeekStart) => item.onDatabaseDisplaySettingsChange(id, { calendarWeekStart })} /></label>
            <label className="database-setting-field"><span>月の並び方</span><UiSelect ariaLabel="カレンダーの月の並び方" value={item.calendarScrollDirection} options={[{ value: "vertical", label: "縦並び" }, { value: "horizontal", label: "横並び" }]} onChange={(calendarScrollDirection) => item.onDatabaseDisplaySettingsChange(id, { calendarScrollDirection })} /></label>
            <label className="database-setting-field"><span>表示期間</span><UiSelect ariaLabel="カレンダーの表示期間" value={item.calendarRangeMode} options={[{ value: "relative", label: "当月から相対指定" }, { value: "fixed", label: "開始日・終了日を固定" }]} onChange={(calendarRangeMode) => item.onDatabaseDisplaySettingsChange(id, { calendarRangeMode })} /></label>
            {item.calendarRangeMode === "fixed" ? <div className="gantt-fixed-range"><label><span>開始日</span><Input aria-label="カレンダー固定期間の開始日" type="date" value={item.calendarFixedStart} onChange={(event) => item.onDatabaseDisplaySettingsChange(id, { calendarFixedStart: event.target.value })} /></label><label><span>終了日</span><Input aria-label="カレンダー固定期間の終了日" type="date" value={item.calendarFixedEnd} onChange={(event) => item.onDatabaseDisplaySettingsChange(id, { calendarFixedEnd: event.target.value })} /></label>{invalidCalendarFixedRange && <p>開始日は終了日以前に設定してください。</p>}</div> : <div className="gantt-relative-range"><div><label><span>前の月数</span><NumericStepper ariaLabel="カレンダーで表示する前の月数" min={0} max={24} value={item.calendarRelativeBefore} onChange={(calendarRelativeBefore) => item.onDatabaseDisplaySettingsChange(id, { calendarRelativeBefore })} /></label><label><span>後の月数</span><NumericStepper ariaLabel="カレンダーで表示する後の月数" min={0} max={24} value={item.calendarRelativeAfter} onChange={(calendarRelativeAfter) => item.onDatabaseDisplaySettingsChange(id, { calendarRelativeAfter })} /></label></div><p>当月を含め、前後の月をスクロール表示します。</p></div>}
          </section>}
          <div className="database-menu-divider" />
          <Button variant="ghost" className="database-menu-action" onClick={downloadCsv}><Download /><span>CSVでダウンロード</span></Button><Button variant="ghost" className="database-menu-action" onClick={copyCsv}><Copy /><span>CSVをコピー</span></Button>
        </div>}
        {queryOpen && createPortal(<div className="query-sheet-layer" onPointerDown={closeQuery}><section className="query-sheet" aria-label="ソート/フィルタ" style={{ height: queryHeight }} onPointerDown={(event) => event.stopPropagation()}>
          <button className="query-sheet-handle" aria-label="メニューの高さを変更" onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setQueryHeight(Math.max(240, Math.min(window.innerHeight * .78, window.innerHeight - event.clientY))); }}><i /></button>
          <header><h2>ソート/フィルタ</h2><Button size="icon" variant="ghost" onClick={closeQuery} aria-label="ソート/フィルタを閉じる"><X /></Button></header>
          <div className="query-sheet-content">
            <section className={`query-accordion ${sortAccordionOpen ? "is-open" : ""}`}>
              <Button variant="ghost" className="query-accordion__toggle" aria-expanded={sortAccordionOpen} onClick={() => setSortAccordionOpen((open) => !open)}><ChevronDown /><span><strong>並び替え</strong><small>{item.databaseSortFieldId ? "1件の条件" : "未設定"}</small></span></Button>
              {sortAccordionOpen && <div className="query-accordion__body"><div className="query-setting-row query-setting-row--sort"><label><span>並び替える項目</span><UiSelect ariaLabel="並び替え対象列" value={item.databaseSortFieldId} options={[{ value: "", label: "並び替えなし" }, ...item.databaseFields.map((field) => ({ value: field.id, label: field.name }))]} onChange={(databaseSortFieldId) => item.onDatabaseQueryChange(id, { sortFieldId: databaseSortFieldId })} /></label><label><span>順序</span><UiSelect ariaLabel="並び順" value={item.databaseSortDirection} options={[{ value: "asc", label: "昇順" }, { value: "desc", label: "降順" }]} onChange={(databaseSortDirection) => item.onDatabaseQueryChange(id, { sortDirection: databaseSortDirection })} /></label></div></div>}
            </section>
            <section className={`query-accordion ${filterAccordionOpen ? "is-open" : ""}`}>
              <div className="query-accordion__header"><Button variant="ghost" className="query-accordion__toggle" aria-expanded={filterAccordionOpen} onClick={() => setFilterAccordionOpen((open) => !open)}><ChevronDown /><span><strong>フィルター</strong><small>{item.databaseFilters.length}件の条件</small></span></Button><div className="query-accordion__actions"><Button size="sm" variant="outline" onClick={addFilter}><Plus />フィルターを追加</Button><Button size="sm" variant={filterSelectionMode ? "secondary" : "outline"} className={filterSelectionMode ? "is-active" : ""} onClick={() => { setFilterSelectionMode((active) => !active); setSelectedFilterIds([]); }}>{filterSelectionMode ? "選択を終了" : "選択モード"}</Button></div></div>
              {filterAccordionOpen && <div className="query-accordion__body">
                {item.databaseFilters.length === 0 ? <p className="query-empty">フィルターは設定されていません。</p> : <div className="filter-rows">{item.databaseFilters.map((filter) => {
                  const field = item.databaseFields.find((entry) => entry.id === filter.fieldId); const isChoice = choiceField(field);
                  return <div className={`filter-row ${filterSelectionMode ? "is-selecting" : ""}`} key={filter.id}>
                    {filterSelectionMode && <label className="filter-row__check"><Checkbox aria-label={`${field?.name ?? "フィルター"}を削除対象に選択`} checked={selectedFilterIds.includes(filter.id)} onCheckedChange={(checked) => setSelectedFilterIds((current) => checked === true ? [...current, filter.id] : current.filter((entryId) => entryId !== filter.id))} /></label>}
                    <label><span>項目</span><UiSelect ariaLabel="フィルター対象列" value={filter.fieldId} options={item.databaseFields.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(fieldId) => { const nextField = item.databaseFields.find((entry) => entry.id === fieldId); updateFilter(filter.id, { fieldId, operator: choiceField(nextField) ? "equals" : "contains", value: choiceField(nextField) ? nextField?.options[0] ?? "" : "" }); }} /></label>
                    <label><span>条件</span><UiSelect ariaLabel="フィルター条件" value={filter.operator} options={(isChoice ? [{ value: "equals", label: "等しい" }, { value: "not_equals", label: "等しくない" }] : [{ value: "equals", label: "等しい" }, { value: "not_equals", label: "等しくない" }, { value: "contains", label: "含む" }, { value: "not_contains", label: "含まない" }])} onChange={(operator) => updateFilter(filter.id, { operator: operator as DatabaseFilter["operator"] })} /></label>
                    <label><span>値</span>{isChoice ? <UiSelect ariaLabel="フィルター値" value={filter.value} options={(field?.options ?? []).map((option) => ({ value: option, label: option }))} onChange={(value) => updateFilter(filter.id, { value })} /> : <Input aria-label="フィルター値" value={filter.value} onChange={(event) => updateFilter(filter.id, { value: event.target.value })} placeholder="値を入力" />}</label>
                  </div>;
                })}</div>}
                {filterSelectionMode && <div className="filter-selection-actions"><span>{selectedFilterIds.length}件を選択中</span><Button variant="destructive" disabled={selectedFilterIds.length === 0} onClick={deleteSelectedFilters}><Trash2 />選択したフィルターを削除</Button></div>}
              </div>}
            </section>
          </div>
        </section></div>, document.body)}
      </div> : isDrawing ? <svg className="drawing-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"><path d={item.drawingPath} style={{ strokeWidth: item.drawingStrokeWidth, strokeLinecap: item.drawingBrush === "pen" ? "round" : "square", strokeLinejoin: item.drawingBrush === "marker" ? "bevel" : "round", opacity: item.drawingBrush === "highlighter" ? .35 : item.drawingBrush === "marker" ? .86 : 1, mixBlendMode: item.drawingBrush === "highlighter" ? "multiply" : "normal" }} /></svg> : isLine ? <div className="line-object"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><line x1={lineDraft.lineStartX} y1={lineDraft.lineStartY} x2={lineDraft.lineEndX} y2={lineDraft.lineEndY} style={{ strokeWidth: item.lineStrokeWidth, strokeDasharray: item.lineDashed ? "24 18" : undefined }} /></svg>{selected && !readOnly && <><button className="line-endpoint line-endpoint--start nodrag" aria-label="線の始点" style={{ left: `${lineDraft.lineStartX / 10}%`, top: `${lineDraft.lineStartY / 10}%` }} onPointerDown={(event) => startLineEndpointDrag("start", event)} /><button className="line-endpoint line-endpoint--end nodrag" aria-label="線の終点" style={{ left: `${lineDraft.lineEndX / 10}%`, top: `${lineDraft.lineEndY / 10}%` }} onPointerDown={(event) => startLineEndpointDrag("end", event)} /></>}</div> : isLink ? <div className="link-card nodrag"><ExternalLink size={18} /><span><a href={/^https?:\/\//.test(item.text) ? item.text : undefined} target="_blank" rel="noreferrer" aria-disabled={!/^https?:\/\//.test(item.text)}>{item.linkTitle || item.text}</a><Input aria-label="リンクURL" value={item.text} readOnly={readOnly} onFocus={() => item.onEditingChange(id, true)} onBlur={() => item.onEditingChange(id, false)} onChange={(event) => item.onTextChange(id, event.target.value)} /></span></div> : <Textarea
          aria-label="カードのテキスト" className="board-node__input nodrag" value={item.text}
          onDoubleClick={(event) => {
            if (!doubleClickToEdit || readOnly) return;
            event.stopPropagation();
            setTextEditing(true);
            item.onEditingChange(id, true);
          }}
          onFocus={() => { if (!doubleClickToEdit) item.onEditingChange(id, true); }}
          onBlur={() => { setTextEditing(false); item.onEditingChange(id, false); }}
          onKeyDown={(event) => { if (doubleClickToEdit && event.key === "Escape") event.currentTarget.blur(); }}
          onChange={(event) => item.onTextChange(id, event.target.value)} readOnly={readOnly || (doubleClickToEdit && !textEditing)} spellCheck={false}
        />}
      {isFrame && !item.frameImage && item.frameRows > 0 && item.frameColumns > 0 && <div className="frame-grid" style={{ gridTemplateRows: `repeat(${item.frameRows}, 1fr)`, gridTemplateColumns: `repeat(${item.frameColumns}, 1fr)` }}>{Array.from({ length: item.frameRows * item.frameColumns }, (_, index) => {
        const column = index % item.frameColumns; const row = Math.floor(index / item.frameColumns);
        return <span className={`${column === item.frameColumns - 1 ? "is-last-column" : ""} ${row === item.frameRows - 1 ? "is-last-row" : ""}`} key={index} />;
      })}</div>}
      {!isFrame && !isDatabase && !isDrawing && !isLine && !isLink && (
        <div className="node-meta nodrag">
          {Object.entries(item.reactions).filter(([, count]) => count > 0).map(([emoji, count]) => (
            <button key={emoji} onClick={() => item.onReaction(id, emoji)}>{emoji} {count}</button>
          ))}
          {item.commentsVisible && item.commentCount > 0 && <span><MessageCircle size={12} /> {item.commentCount}</span>}
        </div>
      )}
    </div>
  );
}

export default memo(BoardNode);
