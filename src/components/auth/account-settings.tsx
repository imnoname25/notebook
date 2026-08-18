"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Eye, EyeOff, Loader2, MoreHorizontal, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jsonOptions } from "@/lib/client-api";
import { t } from "@/lib/i18n/messages";
import { flushNativeAuthCookies } from "@/lib/native-android";

export type AccountUser = { id: string; name: string; email: string; role: "ADMIN" | "USER"; mustChangePassword: boolean };
type ManagedUser = AccountUser & { disabledAt: string | null; totpEnabledAt: string | null; createdAt: string; _count: { sessions: number } };

function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [shown, setShown] = useState(false);
  return <div className="relative"><Input {...props} type={shown ? "text" : "password"} className={`${props.className ?? ""} pr-12`}/><button type="button" className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground" onClick={() => setShown((value) => !value)} aria-label={t(shown ? "password.hide" : "password.show")}>{shown ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>;
}

export function ProfileSettings({ user, onError }: { user: AccountUser; onError(error: unknown): void }) {
  const router = useRouter();
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const result = await api<{ sessionRevoked: boolean }>("/api/account/profile", jsonOptions("PATCH", { name, email }));
      if (result.sessionRevoked) { await flushNativeAuthCookies(); router.replace("/login"); router.refresh(); return; }
      setMessage(t("account.profileSaved")); router.refresh();
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <SettingsSection title={t("account.profile")}><form className="max-w-lg space-y-4" onSubmit={submit}><Label text={t("account.name")}><Input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={100}/></Label><Label text={t("account.email")}><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required/></Label>{message && <p className="text-sm text-emerald-600" role="status">{message}</p>}<Button disabled={busy}>{busy && <Loader2 size={16} className="animate-spin"/>}{t("account.saveProfile")}</Button></form></SettingsSection>;
}

export function PasswordSettings({ forced = false, onError }: { forced?: boolean; onError(error: unknown): void }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [repeat, setRepeat] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const validLength = newPassword.length >= 8 && newPassword.length <= 128;
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (newPassword !== repeat) { setError(t("password.mismatch")); return; }
    if (newPassword === currentPassword) { setError(t("password.same")); return; }
    setBusy(true);
    try {
      await api("/api/account/password", jsonOptions("POST", { currentPassword, newPassword }));
      await flushNativeAuthCookies();
      router.replace("/login?passwordChanged=1"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("password.changeFailed")); onError(cause); } finally { setBusy(false); }
  }
  return <SettingsSection title={forced ? t("password.temporaryRequired") : t("password.change")}><form className="max-w-lg space-y-4" onSubmit={submit}><Label text={t("password.current")}><PasswordInput value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required minLength={8} maxLength={128}/></Label><Label text={t("password.new")}><PasswordInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128}/></Label><p className={`text-sm ${validLength ? "text-emerald-600" : "text-muted-foreground"}`}>{t("password.requirement")}</p><Label text={t("password.repeat")}><PasswordInput value={repeat} onChange={(event) => setRepeat(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={128}/></Label>{error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}<Button disabled={busy || !validLength}>{busy && <Loader2 size={16} className="animate-spin"/>}{t("password.change")}</Button></form></SettingsSection>;
}

export function UserManagement({ currentUserId, onError }: { currentUserId: string; onError(error: unknown): void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]); const [busy, setBusy] = useState(false); const [dialog, setDialog] = useState<"create" | "edit" | "password" | null>(null); const [target, setTarget] = useState<ManagedUser | null>(null); const [message, setMessage] = useState("");
  const load = useCallback(async () => { try { setUsers((await api<{ users: ManagedUser[] }>("/api/admin/users")).users); } catch (error) { onError(error); } }, [onError]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  async function action(user: ManagedUser, name: "disable" | "enable" | "revokeSessions" | "resetTwoFactor") {
    const confirmation = name === "disable" ? t("users.confirmDisable") : name === "revokeSessions" ? t("users.confirmSessions") : name === "resetTwoFactor" ? t("users.confirmTwoFactor") : null;
    if (confirmation && !window.confirm(confirmation)) return;
    setBusy(true); try { await api(`/api/admin/users/${user.id}/actions`, jsonOptions("POST", { action: name })); await load(); } catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <SettingsSection title={t("account.users")}><div className="mb-4 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{t("users.description")}</p><Button size="sm" onClick={() => { setTarget(null); setDialog("create"); }}><Plus size={16}/>{t("users.add")}</Button></div>{message && <p className="mb-3 text-sm text-emerald-600" role="status">{message}</p>}<div className="divide-y divide-border/60 rounded-xl border border-border/60">{users.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("users.empty")}</p>}{users.map((user) => <article key={user.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{user.name}</p><Badge>{t(user.role === "ADMIN" ? "users.admin" : "users.user")}</Badge><Badge danger={Boolean(user.disabledAt)}>{t(user.disabledAt ? "users.disabled" : "users.active")}</Badge></div><p className="truncate text-sm text-muted-foreground">{user.email}</p><p className="mt-1 text-xs text-muted-foreground">{t("users.twoFactor")}: {t(user.totpEnabledAt ? "users.enabled" : "users.off")} · {t("users.sessions")}: {user._count.sessions} · {new Date(user.createdAt).toLocaleDateString("ru")}</p></div><details className="relative"><summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-accent" aria-label={t("users.actions")}><MoreHorizontal size={18}/></summary><div className="right-0 z-20 mt-1 grid min-w-56 rounded-xl border bg-popover p-1 shadow-lg sm:absolute">{[<button key="edit" onClick={() => { setTarget(user); setDialog("edit"); }}>{t("users.edit")}</button>,<button key="password" onClick={() => { setTarget(user); setDialog("password"); }}>{t("users.resetPassword")}</button>,<button key="sessions" onClick={() => void action(user, "revokeSessions")}>{t("users.revokeSessions")}</button>,user.totpEnabledAt && <button key="2fa" onClick={() => void action(user, "resetTwoFactor")}>{t("users.resetTwoFactor")}</button>,user.disabledAt ? <button key="enable" onClick={() => void action(user, "enable")}>{t("users.enable")}</button> : <button key="disable" disabled={user.id === currentUserId} className="text-destructive disabled:opacity-40" onClick={() => void action(user, "disable")}>{t("users.disable")}</button>].filter(Boolean).map((item) => <span key={(item as React.ReactElement).key} className="[&>button]:h-9 [&>button]:w-full [&>button]:rounded-md [&>button]:px-3 [&>button]:text-left [&>button]:text-sm [&>button:hover]:bg-accent">{item}</span>)}</div></details></article>)}</div><UserDialog key={`${dialog ?? "closed"}:${target?.id ?? "new"}`} mode={dialog} target={target} busy={busy} onClose={() => setDialog(null)} onSaved={async (text) => { setDialog(null); setMessage(text); await load(); }} onBusy={setBusy} onError={onError}/></SettingsSection>;
}

function UserDialog({ mode, target, busy, onClose, onSaved, onBusy, onError }: { mode: "create" | "edit" | "password" | null; target: ManagedUser | null; busy: boolean; onClose(): void; onSaved(message: string): Promise<void>; onBusy(value: boolean): void; onError(error: unknown): void }) {
  const [name, setName] = useState(target?.name ?? ""); const [email, setEmail] = useState(target?.email ?? ""); const [role, setRole] = useState<"ADMIN" | "USER">(target?.role ?? "USER"); const [password, setPassword] = useState(""); const [mustChange, setMustChange] = useState(true);
  function generate() { const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%"; const values = crypto.getRandomValues(new Uint32Array(20)); setPassword(Array.from(values, (value) => alphabet[value % alphabet.length]).join("")); }
  async function submit(event: FormEvent) { event.preventDefault(); onBusy(true); try { if (mode === "create") await api("/api/admin/users", jsonOptions("POST", { name, email, role, password, mustChangePassword: mustChange })); else if (mode === "edit" && target) await api(`/api/admin/users/${target.id}`, jsonOptions("PATCH", { name, email, role })); else if (mode === "password" && target) await api(`/api/admin/users/${target.id}/actions`, jsonOptions("POST", { action: "resetPassword", password, mustChangePassword: mustChange })); await onSaved(t(mode === "create" ? "users.created" : mode === "password" ? "users.passwordReset" : "users.saved")); } catch (error) { onError(error); } finally { onBusy(false); } }
  return <Dialog.Root open={Boolean(mode)} onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40"/><Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-[80] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-5 shadow-2xl"><div className="flex items-center"><Dialog.Title className="flex-1 font-semibold">{t(mode === "create" ? "users.add" : mode === "password" ? "users.resetPassword" : "users.edit")}</Dialog.Title><Dialog.Close className="flex size-11 items-center justify-center rounded-lg hover:bg-accent" aria-label={t("common.close")}><X size={18}/></Dialog.Close></div><form className="mt-4 space-y-4" onSubmit={submit}>{mode !== "password" && <><Label text={t("account.name")}><Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100}/></Label><Label text={t("account.email")}><Input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required/></Label><Label text={t("users.role")}><select className="input" value={role} onChange={(event) => setRole(event.target.value as "ADMIN" | "USER")}><option value="USER">{t("users.user")}</option><option value="ADMIN">{t("users.admin")}</option></select></Label></>}{mode !== "edit" && <><Label text={mode === "create" ? t("users.initialPassword") : t("password.new")}><PasswordInput value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required/></Label><Button type="button" variant="outline" size="sm" onClick={generate}>{t("users.generatePassword")}</Button><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={mustChange} onChange={(event) => setMustChange(event.target.checked)} className="size-4"/>{t("users.mustChange")}</label></>}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button disabled={busy}>{busy && <Loader2 size={16} className="animate-spin"/>}{t("common.save")}</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-4"><h2 className="text-lg font-semibold">{title}</h2>{children}</section>; }
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="block text-sm"><span className="mb-1.5 block text-muted-foreground">{text}</span>{children}</label>; }
function Badge({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) { return <span className={`rounded-full px-2 py-0.5 text-xs ${danger ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>{children}</span>; }
