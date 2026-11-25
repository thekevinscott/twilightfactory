import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".harnessmd/**/*.test.ts"],
    setupFiles: [fileURLToPath(new URL("./setup.ts", import.meta.url))],
    testTimeout: 15_000,
  },
});
