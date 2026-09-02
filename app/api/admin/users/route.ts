import { NextResponse } from "next/server";
import { createUser, deleteUser, getRequestUser, listUsers, updateUser } from "@/lib/auth-store.mjs";
import { createUserSchema, deleteUserSchema, updateUserSchema } from "@/lib/auth-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const user = getRequestUser(request);
  if (!user) return { response: NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }) };
  if (user.mustChangePassword) return { response: NextResponse.json({ error: "先に初回パスワードを変更してください。" }, { status: 403 }) };
  return user.isAdmin ? { user } : { response: NextResponse.json({ error: "管理者権限が必要です。" }, { status: 403 }) };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error && /UNIQUE constraint failed/.test(error.message)
    ? "このアドレスは登録済みです。"
    : error instanceof Error ? error.message : "ユーザー管理処理に失敗しました。";
  return NextResponse.json({ error: message }, { status: /登録済み|存在しません|管理者は最低/.test(message) ? 409 : 500 });
}

export async function GET(request: Request) {
  const auth = authorized(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: listUsers(), currentAddress: auth.user.address });
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if ("response" in auth) return auth.response;
  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が不正です。" }, { status: 400 });
  try { return NextResponse.json({ user: createUser(parsed.data) }, { status: 201 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const auth = authorized(request);
  if ("response" in auth) return auth.response;
  const parsed = updateUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が不正です。" }, { status: 400 });
  if (parsed.data.address === auth.user.address && !parsed.data.isAdmin) return NextResponse.json({ error: "自分自身の管理者権限は解除できません。" }, { status: 409 });
  try { return NextResponse.json({ user: updateUser(parsed.data) }); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const auth = authorized(request);
  if ("response" in auth) return auth.response;
  const parsed = deleteUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "入力内容が不正です。" }, { status: 400 });
  if (parsed.data.address === auth.user.address) return NextResponse.json({ error: "ログイン中のユーザーは削除できません。" }, { status: 409 });
  try { deleteUser(parsed.data.address); return new NextResponse(null, { status: 204 }); }
  catch (error) { return errorResponse(error); }
}
