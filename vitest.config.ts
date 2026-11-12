import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Configuration des tests unitaires du front. Les tests ciblent les helpers
// purs du module Projects (types, transitions, mapping des statuts renvoyés
// par l'API).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
