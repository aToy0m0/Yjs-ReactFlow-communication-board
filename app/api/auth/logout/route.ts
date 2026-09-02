import { NextResponse } from "next/server";
import { deleteSession, sessionTokenFromCookie, SESSION_COOKIE_NAME } from "@/lib/auth-store.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  deleteSession(sessionTokenFromCookie(request.headers.get("cookie")));
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
