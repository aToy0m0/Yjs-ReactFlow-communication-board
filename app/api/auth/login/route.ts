import { NextResponse } from "next/server";
import { authenticateUser, clearLoginFailures, createSession, loginRateLimit, recordLoginFailure, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth-store.mjs";
import { loginSchema } from "@/lib/auth-validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "アドレスとパスワードを確認してください。" }, { status: 400 });
  const limit = loginRateLimit(parsed.data.address);
  if (limit.blocked) return NextResponse.json({ error: "ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const user = authenticateUser(parsed.data.address, parsed.data.password);
  if (!user) {
    const failure = recordLoginFailure(parsed.data.address);
    return NextResponse.json({ error: failure.blocked ? "ログイン試行回数が上限に達しました。しばらく待ってから再試行してください。" : "アドレスまたはパスワードが違います。" }, { status: failure.blocked ? 429 : 401, headers: failure.blocked ? { "Retry-After": String(failure.retryAfterSeconds) } : undefined });
  }
  clearLoginFailures(user.address);
  const session = createSession(user.address);
  const response = NextResponse.json({ user });
  response.cookies.set(SESSION_COOKIE_NAME, session.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: session.expiresAt,
  });
  return response;
}
