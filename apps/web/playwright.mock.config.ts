import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "mock-mode.spec.ts",
  use: { baseURL: "http://127.0.0.1:3201", trace: "on-first-retry" },
  webServer: {
    command: "NEXT_PUBLIC_MSW_ENABLED=true NEXT_PUBLIC_API_ORIGIN=http://localhost:3001 NODE_ENV=production pnpm build && NEXT_PUBLIC_MSW_ENABLED=true NEXT_PUBLIC_API_ORIGIN=http://localhost:3001 NODE_ENV=production pnpm start --port 3201",
    url: "http://127.0.0.1:3201",
    reuseExistingServer: false,
  },
  projects: [
    { name: "mock-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mock-mobile", use: { ...devices["Pixel 5"] } },
  ],
});
