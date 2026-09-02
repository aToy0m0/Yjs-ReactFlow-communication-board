import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.mustChangePassword ? "/account" : "/");
  return <main className="grid min-h-svh place-items-center bg-muted/40 p-4"><section className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm"><header className="mb-6 flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg bg-primary font-bold text-primary-foreground" aria-hidden="true">れ</span><h1 className="text-xl font-semibold tracking-tight">れんらくがかり</h1></header><LoginForm /></section></main>;
}
