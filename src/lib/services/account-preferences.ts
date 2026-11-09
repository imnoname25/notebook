import { db } from "@/lib/db";
import { accountPreferencesSchema } from "@/lib/validation";

export async function updateAccountPreferences(userId: string, value: unknown) {
  const { appearance, ...other } = accountPreferencesSchema.parse(value);
  return db.$transaction(async tx => {
    await tx.userSettings.upsert({ where: { userId }, create: { userId, ...other }, update: other });
    if (appearance) {
      await tx.$executeRaw`UPDATE "UserSettings" SET "appearance" = "appearance" || ${JSON.stringify(appearance)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
    }
    return tx.userSettings.findUniqueOrThrow({ where: { userId } });
  });
}
