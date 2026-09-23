import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.contract.test.ts"],
    testTimeout: 30_000,
    retry: 3,
  },
});
