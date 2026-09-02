"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PasswordChangeForm({ mustChangePassword }: { mustChangePassword: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError(""); setSuccess(""); setSubmitting(true);
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(body.error ?? "パスワードを変更できませんでした。"));
      formElement.reset(); setSuccess("パスワードを変更しました。");
      if (mustChangePassword) { router.replace("/"); router.refresh(); }
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "パスワードを変更できませんでした。"); }
    finally { setSubmitting(false); }
  }

  return <form className="grid gap-5 rounded-xl border bg-background p-5" onSubmit={submit}>
    <div><h2 className="font-semibold">パスワード変更</h2><p className="mt-1 text-sm text-muted-foreground">現在のパスワードを確認し、12文字以上の新しいパスワードへ変更します。</p></div>
    <div className="grid gap-2"><Label htmlFor="current-password">現在のパスワード</Label><Input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required /></div>
    <div className="grid gap-2"><Label htmlFor="new-password">新しいパスワード</Label><Input id="new-password" name="newPassword" type="password" autoComplete="new-password" minLength={12} required /></div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {success && <Alert role="status"><AlertDescription>{success}</AlertDescription></Alert>}
    <Button type="submit" disabled={submitting}>{submitting ? "変更中…" : "パスワードを変更"}</Button>
  </form>;
}
