import { z } from "zod";

export const BLOCK_BACKGROUND_TOKENS = [
  "default",
  "gray",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
] as const;

export type BlockBackgroundToken = (typeof BLOCK_BACKGROUND_TOKENS)[number];

export const blockBackgroundTokenSchema = z.enum(BLOCK_BACKGROUND_TOKENS);

