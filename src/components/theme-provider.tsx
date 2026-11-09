"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ComponentProps } from "react";
import { THEMES } from "@/lib/themes";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} themes={THEMES.filter((theme) => theme !== "system")} enableColorScheme={false}><ThemeFallback/>{props.children}</NextThemesProvider>;
}

function ThemeFallback() {
  const { theme, setTheme } = useTheme();
  useEffect(() => {
    if (theme && !THEMES.some(value => value === theme)) {
      // next-themes removes only registered theme classes when applying a theme.
      const classes = theme.split(/\s+/).filter(Boolean);
      setTheme("system");
      return () => document.documentElement.classList.remove(...classes);
    }
  }, [theme, setTheme]);
  return null;
}
