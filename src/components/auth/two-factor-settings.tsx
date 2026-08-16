"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jsonOptions } from "@/lib/client-api";

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesRemaining: number; encryptionAvailable: boolean };
type Setup = { secret: string; provisioningUri: string; qrCodeDataUrl: string };

export function TwoFactorSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"setup" | "enable" | "disable" | "regenerate" | "">("");
  const [message, setMessage] = useState("");

  async function load() {
    const result = await api<{ twoFactor: Status }>("/api/auth/2fa");
    setStatus(result.twoFactor);
  }

  useEffect(() => { let cancelled = false; void api<{ twoFactor: Status }>("/api/auth/2fa").then((result) => { if (!cancelled) setStatus(result.twoFactor); }).catch((error: Error) => { if (!cancelled) setMessage(error.message); }); return () => { cancelled = true; }; }, []);

  async function begin() {
    setBusy("setup"); setMessage("");
    try {
      const result = await api<{ setup: Setup }>("/api/auth/2fa/setup", jsonOptions("POST", { password }));
      setSetup(result.setup); setPassword("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось начать настройку"); }
    finally { setBusy(""); }
  }

  async function enable() {
    setBusy("enable"); setMessage("");
    try {
      const result = await api<{ recoveryCodes: string[] }>("/api/auth/2fa/setup", jsonOptions("PUT", { code }));
      setRecoveryCodes(result.recoveryCodes); setSetup(null); setCode(""); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось включить защиту"); }
    finally { setBusy(""); }
  }

  async function protectedAction(action: "disable" | "regenerate") {
    setBusy(action); setMessage("");
    try {
      if (action === "disable") {
        await api("/api/auth/2fa", jsonOptions("DELETE", { password, code }));
        setRecoveryCodes(null); setMessage("Двухфакторная аутентификация отключена");
      } else {
        const result = await api<{ recoveryCodes: string[] }>("/api/auth/2fa/recovery-codes", jsonOptions("POST", { password, code }));
        setRecoveryCodes(result.recoveryCodes);
      }
      setPassword(""); setCode(""); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
    finally { setBusy(""); }
  }

  async function copyRecoveryCodes() {
    if (!recoveryCodes) return;
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    setMessage("Резервные коды скопированы");
  }

  if (!status) return <div className="flex min-h-24 items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" size={18}/></div>;

  return <section className="space-y-4 border-t border-border/60 pt-5">
    <div className="flex items-start gap-3"><span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><ShieldCheck size={18}/></span><div><h3 className="font-semibold">Двухфакторная аутентификация</h3><p className="mt-1 text-sm text-muted-foreground">Защитите вход одноразовым кодом из приложения-аутентификатора.</p></div></div>
    {!status.encryptionAvailable && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">Для безопасного хранения TOTP secret задайте `SETTINGS_ENCRYPTION_KEY` и перезапустите Notebook.</p>}
    {!status.enabled && !setup && <div className="max-w-sm space-y-3"><label className="block text-sm font-medium">Текущий пароль<Input className="mt-1.5" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><Button onClick={() => void begin()} disabled={!status.encryptionAvailable || password.length < 8 || Boolean(busy)}>{busy === "setup" && <Loader2 className="animate-spin" size={15}/>}Настроить 2FA</Button></div>}
    {setup && <div className="grid gap-5 rounded-xl bg-muted/35 p-4 sm:grid-cols-[240px_minmax(0,1fr)]"><div role="img" aria-label="QR-код для настройки двухфакторной аутентификации" className="aspect-square w-60 rounded-lg bg-white bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${setup.qrCodeDataUrl})` }}/><div className="space-y-3"><div><p className="text-sm font-medium">Отсканируйте QR-код</p><p className="mt-1 text-sm text-muted-foreground">Или введите секрет вручную:</p><code className="mt-2 block break-all rounded-md bg-background p-2 text-sm">{setup.secret}</code></div><label className="block text-sm font-medium">Код из приложения<Input className="mt-1.5" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}/></label><Button onClick={() => void enable()} disabled={code.length !== 6 || Boolean(busy)}>{busy === "enable" && <Loader2 className="animate-spin" size={15}/>}Подтвердить и включить</Button></div></div>}
    {status.enabled && <div className="space-y-4"><div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={17}/>2FA включена · доступно резервных кодов: {status.recoveryCodesRemaining}</div><div className="grid max-w-xl gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Текущий пароль<Input className="mt-1.5" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)}/></label><label className="block text-sm font-medium">TOTP или резервный код<Input className="mt-1.5" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)}/></label></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void protectedAction("regenerate")} disabled={password.length < 8 || code.length < 6 || Boolean(busy)}>{busy === "regenerate" ? <Loader2 className="animate-spin" size={15}/> : <RefreshCw size={15}/>}Новые резервные коды</Button><Button variant="outline" className="text-destructive" onClick={() => void protectedAction("disable")} disabled={password.length < 8 || code.length < 6 || Boolean(busy)}>{busy === "disable" ? <Loader2 className="animate-spin" size={15}/> : <ShieldOff size={15}/>}Отключить 2FA</Button></div></div>}
    {recoveryCodes && <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"><p className="font-medium">Сохраните резервные коды сейчас</p><p className="mt-1 text-sm text-muted-foreground">Они больше не будут показаны. Каждый код можно использовать только один раз.</p><div className="my-3 grid gap-1 font-mono text-sm sm:grid-cols-2">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><Button variant="outline" size="sm" onClick={() => void copyRecoveryCodes()}><Copy size={14}/>Копировать коды</Button></div>}
    {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
  </section>;
}
