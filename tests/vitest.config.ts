import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".harnessmd/**/*.test.ts"],
  },
});
