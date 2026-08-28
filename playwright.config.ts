import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 5173)
const baseURL = `http://localhost:${PORT}`

// E2E runs against the real stack: vite dev serves the SPA + the Worker against a
// local D1 migrated by `e2e:server` on boot, with AMA_E2E_TEST_AUTH so the suite
// mints explicit synthetic Console Bearer credentials instead of driving a real IdP. Reserved for genuinely
// cross-stack crown journeys — the pyramid's tip, not full-branch coverage.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 120_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm e2e:server',
    url: `${baseURL}/api/v1/e2e/ready`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
})
