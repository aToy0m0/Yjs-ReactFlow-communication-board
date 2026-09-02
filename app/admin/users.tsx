"use client";

import { Check, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type User = { address: string; displayName: string; isAdmin: boolean; mustChangePassword: boolean; createdAt: string; updatedAt: string };

export default function AdminUsers({ currentAddress, initialUsers }: { currentAddress: string; initialUsers: User[] }) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [error, setError] = useState("");
  const [editingAddress, setEditingAddress] = useState<string | null>(null);
  const [deleteAddress, setDeleteAddress] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [displayNameEdited, setDisplayNameEdited] = useState(false);
  const [newPassword, setNewPassword] = useState("password");
  const [newIsAdmin, setNewIsAdmin] = useState(false);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/admin/users");
      const body = await response.json();
      if (!response.ok) throw new Error(String(body.error ?? "ユーザーを取得できませんでした。"));
      setUsers(body.users as User[]);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "ユーザーを取得できませんでした。"); }
  }

  async function submit(endpoint: string, method: string, body: unknown) {
    setError("");
    const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(String(result.error ?? "ユーザーを更新できませんでした。"));
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await submit("/api/admin/users", "POST", { address: form.get("address"), displayName: form.get("displayName"), password: form.get("password"), isAdmin: newIsAdmin });
      formElement.reset(); setNewAddress(""); setNewDisplayName(""); setDisplayNameEdited(false); setNewPassword("password"); setNewIsAdmin(false); await load();
    } catch (createError) { setError(createError instanceof Error ? createError.message : "ユーザーを作成できませんでした。"); }
  }

  async function save(event: FormEvent<HTMLFormElement>, address: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await submit("/api/admin/users", "PATCH", { address, displayName: form.get("displayName"), isAdmin: address === currentAddress || form.get("isAdmin") === "on" });
      setEditingAddress(null); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "ユーザーを更新できませんでした。"); }
  }

  async function remove() {
    if (!deleteAddress) return;
    try {
      await submit("/api/admin/users", "DELETE", { address: deleteAddress });
      setDeleteAddress(null); await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "削除できませんでした。");
      setDeleteAddress(null);
    }
  }

  return <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6">
    <form className="grid items-end gap-4 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto]" onSubmit={create}>
      <div className="grid gap-2"><Label htmlFor="new-address">メールアドレス</Label><Input id="new-address" name="address" type="email" value={newAddress} onChange={(event) => { const address = event.target.value; setNewAddress(address); if (!displayNameEdited) setNewDisplayName(address.split("@")[0]); }} required /></div>
      <div className="grid gap-2"><Label htmlFor="new-display-name">表示名</Label><Input id="new-display-name" name="displayName" value={newDisplayName} onChange={(event) => { setNewDisplayName(event.target.value); setDisplayNameEdited(true); }} required maxLength={80} /></div>
      <div className="grid gap-2"><Label htmlFor="new-password">初期パスワード</Label><Input id="new-password" name="password" type="text" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required minLength={8} autoComplete="off" /></div>
      <Label className="flex h-9 items-center gap-2 rounded-md border px-3"><Checkbox checked={newIsAdmin} onCheckedChange={(checked) => setNewIsAdmin(checked === true)} /><span>管理者</span></Label>
      <Button type="submit"><Plus />招待</Button>
    </form>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="overflow-x-auto rounded-xl border bg-background"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>メールアドレス</TableHead><TableHead>表示名</TableHead><TableHead>権限</TableHead><TableHead>登録日</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>
      {users.length === 0 ? <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">登録ユーザーはいません。</TableCell></TableRow> : users.map((user) => <TableRow key={user.address}>
        <TableCell><div className="flex items-center gap-2"><strong>{user.address}</strong>{user.address === currentAddress && <Badge variant="secondary">ログイン中</Badge>}{user.mustChangePassword && <Badge variant="outline">初回変更待ち</Badge>}</div></TableCell>
        <TableCell>{editingAddress === user.address ? <form id={`edit-${user.address}`} className="grid gap-2" onSubmit={(event) => void save(event, user.address)}><Input name="displayName" defaultValue={user.displayName} required maxLength={80} aria-label={`${user.address}の表示名`} /><Label className="flex items-center gap-2"><Checkbox name="isAdmin" defaultChecked={user.isAdmin} disabled={user.address === currentAddress} /><span>管理者権限</span></Label></form> : user.displayName}</TableCell>
        <TableCell>{user.isAdmin ? <Badge>管理者</Badge> : <span className="text-muted-foreground">一般</span>}</TableCell>
        <TableCell>{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(new Date(user.createdAt))}</TableCell>
        <TableCell><div className="flex justify-end gap-2">{editingAddress === user.address ? <><Button size="icon" type="submit" form={`edit-${user.address}`} aria-label="変更を保存"><Check /></Button><Button size="icon" variant="outline" onClick={() => setEditingAddress(null)} aria-label="編集を終了"><X /></Button></> : <Button variant="outline" onClick={() => setEditingAddress(user.address)}>編集</Button>}<Button size="icon" variant="destructive" disabled={user.address === currentAddress} onClick={() => setDeleteAddress(user.address)} aria-label={`${user.address}を削除`}><Trash2 /></Button></div></TableCell>
      </TableRow>)}</TableBody></Table></div>
    <AlertDialog open={deleteAddress !== null} onOpenChange={(open) => { if (!open) setDeleteAddress(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>ユーザーを削除しますか？</AlertDialogTitle><AlertDialogDescription>{deleteAddress} を削除します。この操作は取り消せません。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void remove()}>削除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
