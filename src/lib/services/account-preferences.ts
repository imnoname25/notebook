import { db } from "@/lib/db";
import { accountPreferencesSchema } from "@/lib/validation";

export async function updateAccountPreferences(userId: string, value: unknown) {
  const { appearance, ...other } = accountPreferencesSchema.parse(value);
  return db.$transaction(async tx => {
    // Native ON CONFLICT also covers two first-time PATCH requests arriving together.
    await tx.userSettings.createMany({ data: [{ userId }], skipDuplicates: true });
    if (Object.keys(other).length) await tx.userSettings.update({ where: { userId }, data: other });
    if (appearance) {
      await tx.$executeRaw`UPDATE "UserSettings" SET "appearance" = "appearance" || ${JSON.stringify(appearance)}::jsonb, "updatedAt" = CURRENT_TIMESTAMP WHERE "userId" = ${userId}`;
    }
    return tx.userSettings.findUniqueOrThrow({ where: { userId } });
  });
}
