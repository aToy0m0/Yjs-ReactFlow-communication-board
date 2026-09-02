import { NextResponse } from "next/server";
import { changePassword, createSession, getRequestUser, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-store.mjs";
import { changePasswordSchema } from "@/lib/auth-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = getRequestUser(request);
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const parsed = changePasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が不正です。" }, { status: 400 });
  try {
    changePassword({ address: user.address, ...parsed.data });
    const session = createSession(user.address);
    const response = NextResponse.json({ updated: true });
    response.cookies.set(SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "パスワードを変更できませんでした。";
    return NextResponse.json({ error: message }, { status: message.includes("現在のパスワード") ? 401 : 500 });
  }
}
