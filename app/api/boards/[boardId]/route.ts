import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SAFE_BOARD_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function authorizationError(request: Request) {
  const user = getRequestUser(request);
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "先に初回パスワードを変更してください。" }, { status: 403 });
  return null;
}

export async function GET(request: Request, context: { params: Promise<{ boardId: string }> }) {
  const authError = authorizationError(request);
  if (authError) return authError;
  const { boardId } = await context.params;
  if (!SAFE_BOARD_ID.test(boardId)) return NextResponse.json({ error: "ボードIDが不正です。" }, { status: 400 });

  const database = new DatabaseSync(join(process.cwd(), "data", "mingleboard.sqlite"), { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 3000;");
    const board = database.prepare("SELECT id, title, yjs_state AS yjsState, updated_at AS updatedAt FROM boards WHERE id = ?").get(boardId) as { id: string; title: string; yjsState: Uint8Array; updatedAt: string } | undefined;
    if (!board) return NextResponse.json({ error: "指定されたボードは存在しません。" }, { status: 404 });
    if (new URL(request.url).searchParams.get("download") !== "1") return NextResponse.json({ id: board.id, title: board.title, updatedAt: board.updatedAt });
    const payload = {
      format: "renraku-gakari-board", formatVersion: 3, boardId, title: board.title,
      stateUpdate: Buffer.from(board.yjsState).toString("base64"),
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(board.title || "board")}.json`,
      },
    });
  } finally {
    database.close();
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ boardId: string }> }) {
  const authError = authorizationError(request);
  if (authError) return authError;
  const { boardId } = await context.params;
  if (!SAFE_BOARD_ID.test(boardId)) return NextResponse.json({ error: "ボードIDが不正です。" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "JSONの形式が不正です。" }, { status: 400 }); }
  const title = body && typeof body === "object" && "title" in body && typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 80) return NextResponse.json({ error: "ボード名は1〜80文字で入力してください。" }, { status: 400 });

  const database = new DatabaseSync(join(process.cwd(), "data", "mingleboard.sqlite"));
  try {
    database.exec("PRAGMA busy_timeout = 3000;");
    const board = database.prepare("SELECT id FROM boards WHERE id = ?").get(boardId);
    if (!board) return NextResponse.json({ error: "指定されたボードは存在しません。" }, { status: 404 });
    database.prepare("UPDATE boards SET title = ?, updated_at = ? WHERE id = ?").run(title, new Date().toISOString(), boardId);
    return NextResponse.json({ id: boardId, title });
  } finally {
    database.close();
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ boardId: string }> }) {
  const authError = authorizationError(request);
  if (authError) return authError;
  const { boardId } = await context.params;
  if (!SAFE_BOARD_ID.test(boardId)) return NextResponse.json({ error: "ボードIDが不正です。" }, { status: 400 });

  const database = new DatabaseSync(join(process.cwd(), "data", "mingleboard.sqlite"));
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    const result = database.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
    if (result.changes === 0) return NextResponse.json({ error: "指定されたボードは存在しません。" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } finally {
    database.close();
  }
}
