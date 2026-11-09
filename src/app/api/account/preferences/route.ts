import { NextRequest, NextResponse } from "next/server";
import { apiError, readJson, requireAccountUser, validateRequestOrigin } from "@/lib/api";
import { db } from "@/lib/db";
import { getApplicationSettings } from "@/lib/services/settings-service";
import { updateAccountPreferences } from "@/lib/services/account-preferences";
import { normalizeAppearance } from "@/lib/appearance-preferences";
import { accountPreferencesSchema } from "@/lib/validation";

function publicPreferences(settings: { interfaceDensity: string; sectionAccentIntensity: string; pageListView: string; defaultPagePreset: string; startScreen: string; editorSpellcheck: boolean; editorCodeLineNumbers: boolean; editorCompactMode: boolean; editorContentWidth: string; appearance?: unknown }, autosaveDelayMs: number) {
  return { ...settings, appearance: normalizeAppearance(settings.appearance), appearanceConfigured: Boolean(settings.appearance && typeof settings.appearance === "object" && Object.keys(settings.appearance).length), autosaveDelayMs };
}

export async function GET() {
  try {
    const user = await requireAccountUser();
    const [settings, application] = await Promise.all([
      db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} }),
      getApplicationSettings(),
    ]);
    return NextResponse.json({ settings: publicPreferences(settings, application.autosaveDelayMs) });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    validateRequestOrigin(request);
    const user = await requireUserForPreferences();
    const input = accountPreferencesSchema.parse(await readJson(request));
    const settings = await updateAccountPreferences(user.id, input);
    const application = await getApplicationSettings();
    return NextResponse.json({ settings: publicPreferences(settings, application.autosaveDelayMs) });
  } catch (error) { return apiError(error); }
}

async function requireUserForPreferences() {
  return requireAccountUser();
}
