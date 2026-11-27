"use client";
import { createContext, useContext } from "react";
import type { AppearancePreferences } from "@/lib/appearance-preferences";

export type AppearanceContextValue = {
  preferences: AppearancePreferences;
  update(patch: Partial<AppearancePreferences>): void;
  saving: boolean;
  loaded: boolean;
  error: string;
  retry(): void;
};
export const AppearanceContext = createContext<AppearanceContextValue | null>(null);
export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("Appearance settings require an authenticated workspace");
  return value;
}
