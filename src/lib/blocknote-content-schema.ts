import { z } from "zod";

// Shared by browser paste/template validation and server-side archive schemas.
export const blockNoteContentSchema = z
  .array(z.object({ type: z.string().min(1).max(80) }).passthrough())
  .max(10_000);
