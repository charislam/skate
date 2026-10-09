import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
  },
});
