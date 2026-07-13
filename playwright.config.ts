import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      command: "ECHO_AUTH_DISABLED=1 ECHO_AUTH_DISABLED_USER_ID=__e2e__ API_PORT=4180 npm run start --workspace @echo/api",
      url: "http://127.0.0.1:4180/healthz",
      reuseExistingServer: true,
      timeout: 30_000
    },
    {
      command: "npm run dev --workspace @echo/web -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: true,
      timeout: 30_000
    }
  ]
});
