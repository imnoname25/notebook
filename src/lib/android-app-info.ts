import { z } from "zod";

export const androidAppInfoSchema = z.object({
  versionName: z.string().regex(/^\d+\.\d+\.\d+(?:-g[0-9a-f]{8})?$/),
  versionCode: z.number().int().positive(),
  gitCommit: z.string().regex(/^[0-9a-f]{40}$/),
  sourceDirty: z.boolean(),
  debug: z.boolean(),
});
export type AndroidAppInfo = z.infer<typeof androidAppInfoSchema>;
