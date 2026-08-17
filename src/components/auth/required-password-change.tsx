"use client";

import { BookOpen } from "lucide-react";
import { PasswordSettings } from "@/components/auth/account-settings";
import { t } from "@/lib/i18n/messages";

export function RequiredPasswordChange() {
  return <main className="flex min-h-dvh items-center justify-center bg-muted/40 p-5"><section className="w-full max-w-lg rounded-2xl bg-card p-6 shadow-sm ring-1 ring-border/60"><div className="mb-6 flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><BookOpen size={20}/></span><div><h1 className="font-semibold">Notebook</h1><p className="text-sm text-muted-foreground">{t("account.securitySubtitle")}</p></div></div><PasswordSettings forced onError={() => undefined}/></section></main>;
}
