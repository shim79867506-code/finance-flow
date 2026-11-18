import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.TEST_BASE_URL ?? "http://127.0.0.1:3188" },
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3188",
        url: "http://127.0.0.1:3188",
        env: { FINANCEFLOW_DEMO: "true" },
      },
});
