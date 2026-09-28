import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Live/integration tests (tests/live/**) launch a real browser against
    // real Amazon pages and are opt-in only — run them with `npm run
    // test:live` (vitest.live.config.ts), never as part of the normal
    // suite/CI. See docs/PROVIDERS.md.
    exclude: ["node_modules/**", "tests/live/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
