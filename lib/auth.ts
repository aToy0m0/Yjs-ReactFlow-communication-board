import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, SESSION_COOKIE_NAME, type AuthUser } from "@/lib/auth-store.mjs";

export async function currentUser() {
  const cookieStore = await cookies();
  return getSessionUser(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "");
}

export async function requireUser({ allowPasswordChange = false } = {}): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !allowPasswordChange) redirect("/account");
  return user;
}

export async function requireAdmin(): Promise<AuthUser> {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
