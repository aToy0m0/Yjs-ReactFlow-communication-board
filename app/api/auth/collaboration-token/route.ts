import { NextResponse } from "next/server";
import { createCollaborationToken, getRequestUser } from "@/lib/auth-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "先に初回パスワードを変更してください。" }, { status: 403 });
  const { token, expiresAt } = createCollaborationToken(user.address);
  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
