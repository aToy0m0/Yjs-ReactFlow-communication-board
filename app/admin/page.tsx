import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listUsers } from "@/lib/auth-store.mjs";
import AdminUsers from "./users";
import { Button } from "@/components/ui/button";

export default async function AdminPage() {
  const user = await requireAdmin();
  return <main className="min-h-svh bg-muted/30"><header className="border-b bg-background"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6"><div><h1 className="text-xl font-semibold">ユーザー管理</h1><p className="text-sm text-muted-foreground">{user.displayName}・{user.address}</p></div><Button variant="outline" nativeButton={false} render={<Link href="/" />}>ボードへ戻る</Button></div></header><AdminUsers currentAddress={user.address} initialUsers={listUsers()} /></main>;
}
