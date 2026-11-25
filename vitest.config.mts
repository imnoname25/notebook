import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", exclude: ["**/node_modules/**", "**/.git/**", "**/.next/**", "data/**", "src/generated/**", "e2e/**", "docs/**/capture.spec.ts"] },
});
