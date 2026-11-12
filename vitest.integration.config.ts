import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests d'intégration réels (MongoDB freelancetn_dev). Ils ne font pas partie
// de `npm test` : on les lance explicitement avec
// `npx vitest run --config vitest.integration.config.ts`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ["./vitest.setup.ts"],
    fileParallelism: false,
  },
});
