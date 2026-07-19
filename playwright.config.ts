import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/setup.ts",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: [
    {
      // Keep E2E isolated from the developer's auth-enabled API on 4180.
      // Reusing that server silently sent clean-room tests to /login and made
      // the result depend on whichever local process happened to be running.
      command: "ECHO_AUTH_DISABLED=1 ECHO_AUTH_DISABLED_USER_ID=__e2e__ API_PORT=4280 npm run start --workspace @echo/api",
      url: "http://127.0.0.1:4280/healthz",
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: "BACKEND_PORT=4280 npm run dev --workspace @echo/web -- --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: false,
      timeout: 30_000
    }
  ]
});
