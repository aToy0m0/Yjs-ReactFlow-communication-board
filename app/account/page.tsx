import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { requireUser } from "@/lib/auth";
import PasswordChangeForm from "./password-change-form";

export default async function AccountPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return <main className="min-h-svh bg-muted/30"><header className="border-b bg-background"><div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6"><div><h1 className="text-xl font-semibold">アカウント設定</h1><p className="text-sm text-muted-foreground">{user.displayName}・{user.address}</p></div>{!user.mustChangePassword && <Button variant="outline" nativeButton={false} render={<Link href="/" />}>ボードへ戻る</Button>}</div></header><section className="mx-auto grid max-w-2xl gap-4 px-4 py-6 sm:px-6">{user.mustChangePassword && <Alert><AlertDescription>初回ログイン用パスワードを変更すると、ボードを利用できます。</AlertDescription></Alert>}<PasswordChangeForm mustChangePassword={user.mustChangePassword} /></section></main>;
}
