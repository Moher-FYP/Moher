import { defineConfig } from "vitest/config";

/** End-to-end: starts Anvil, deploys the contracts, runs the API and drives it with the SDK. */
export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
