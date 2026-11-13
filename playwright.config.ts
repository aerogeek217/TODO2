import { defineConfig, devices } from '@playwright/test';

// The dev server's port for this run. `PW_PORT` lets two checkouts run their
// suites at once without one reusing the other's server (and testing its code).
const port = Number(process.env.PW_PORT ?? 5173);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`PW_PORT must be a port number, got "${process.env.PW_PORT}"`);
}
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  // A run empties its output folder first: one per port, so two runs at once
  // (another checkout's, or a single probe spec beside a full run) don't
  // delete each other's traces.
  outputDir: `test-results/port-${port}`,
  // Every test gets its own browser context (fresh IndexedDB), so tests
  // within a spec spread across workers instead of one long spec setting
  // the suite's wall time.
  fullyParallel: true,
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
