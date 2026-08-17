import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3100", trace: "on-first-retry" },
  webServer: {
    command: "NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3100 NODE_ENV=production pnpm build && NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3100 NODE_ENV=production pnpm start --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
});
