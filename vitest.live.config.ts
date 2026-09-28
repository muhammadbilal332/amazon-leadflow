import { defineConfig } from "vitest/config";
import path from "path";

// Opt-in only: `npm run test:live`. These tests launch a real Chromium
// browser and navigate to real Amazon pages — never run as part of the
// normal `npm test` suite or CI. See docs/PROVIDERS.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
