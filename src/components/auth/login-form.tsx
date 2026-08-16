"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ needsSetup }: { needsSetup: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    const endpoint = requiresTwoFactor ? "/api/auth/2fa/challenge" : needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = (await response.json()) as { error?: string; requiresTwoFactor?: boolean };
    if (!response.ok) { setError(result.error ?? "Не удалось продолжить"); setLoading(false); return; }
    if (result.requiresTwoFactor) { setRequiresTwoFactor(true); setLoading(false); return; }
    router.replace("/app");
    router.refresh();
  }

  return <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-5 py-12">
    <section className="w-full max-w-sm rounded-2xl bg-card p-7 shadow-sm ring-1 ring-border/60">
      <div className="mb-8 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BookOpen size={20} /></span><div><h1 className="text-xl font-semibold tracking-tight">Notebook</h1><p className="text-sm text-muted-foreground">Простая цифровая записная книжка</p></div></div>
      <h2 className="mb-1 text-lg font-medium">{requiresTwoFactor ? "Подтверждение входа" : needsSetup ? "Создание администратора" : "С возвращением"}</h2>
      <p className="mb-6 text-sm text-muted-foreground">{requiresTwoFactor ? "Введите код из приложения-аутентификатора или одноразовый резервный код." : needsSetup ? "Это первый запуск. Создайте локальную учётную запись." : "Войдите в свою записную книжку."}</p>
      <form className="space-y-4" onSubmit={submit}>
        {!requiresTwoFactor && needsSetup && <label className="block text-sm font-medium">Имя<Input className="mt-1.5" name="name" required autoComplete="name" /></label>}
        {!requiresTwoFactor && <label className="block text-sm font-medium">Email<Input className="mt-1.5" name="email" type="email" required autoComplete="email" /></label>}
        {!requiresTwoFactor && <label className="block text-sm font-medium">Пароль<Input className="mt-1.5" name="password" type="password" minLength={8} required autoComplete={needsSetup ? "new-password" : "current-password"} /></label>}
        {requiresTwoFactor && <label className="block text-sm font-medium">Одноразовый или резервный код<Input className="mt-1.5 font-mono tracking-wider" name="code" required autoComplete="one-time-code" autoFocus /></label>}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
        <Button className="w-full" disabled={loading}>{loading && <Loader2 className="animate-spin" size={16} />}{requiresTwoFactor ? "Подтвердить" : needsSetup ? "Создать и войти" : "Войти"}</Button>
        {requiresTwoFactor && <button type="button" className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => { setRequiresTwoFactor(false); setError(""); }}>Вернуться к вводу пароля</button>}
      </form>
    </section>
  </main>;
}
