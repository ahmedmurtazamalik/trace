import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'workspace-invitations.real.spec.ts',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'on-first-retry' },
  webServer: {
    command: 'NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3201 NODE_ENV=production pnpm build && NEXT_PUBLIC_API_ORIGIN=http://127.0.0.1:3201 NODE_ENV=production pnpm start --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: 'desktop-real', use: { ...devices['Desktop Chrome'] } }],
});
