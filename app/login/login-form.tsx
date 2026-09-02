"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginForm() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return <form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setError(""); setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, password }) });
      const body = await response.json();
      if (!response.ok) { setError(String(body.error ?? "ログインできませんでした。")); return; }
      router.replace(body.user?.mustChangePassword ? "/account" : "/"); router.refresh();
    } finally { setSubmitting(false); }
  }}>
    <div className="grid gap-2"><Label htmlFor="address">アドレス</Label><Input id="address" type="email" autoComplete="username" value={address} onChange={(event) => setAddress(event.target.value)} required /></div>
    <div className="grid gap-2"><Label htmlFor="password">パスワード</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Button className="w-full" type="submit" disabled={submitting}>{submitting ? "確認中…" : "ログイン"}</Button>
  </form>;
}
