"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";
import { THEMES } from "@/lib/themes";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} themes={THEMES.filter((theme) => theme !== "system")} enableColorScheme={false} />;
}
