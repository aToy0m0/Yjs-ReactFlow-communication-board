import { NextResponse } from "next/server";
import { getRequestUser } from "@/lib/auth-store.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = getRequestUser(request);
  return user ? NextResponse.json({ user }) : NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
}
