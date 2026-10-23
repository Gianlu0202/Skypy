import { defineConfig } from '@playwright/test';

// End-to-end tests drive real browsers with fake cameras against a running
// Skypy (default: the production build on :3000, started automatically).
const BASE = process.env.BASE ?? 'http://localhost:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    viewport: { width: 1400, height: 860 },
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: process.env.BASE
    ? undefined
    : {
        command: 'node scripts/dev.mjs --prod',
        url: 'http://localhost:3000/api/health',
        reuseExistingServer: true,
        timeout: 120_000,
        env: { ...(process.env as Record<string, string>), DATA_DIR: 'data-test', SEAT_GRACE_SECONDS: '6', ROOM_CREATE_LIMIT: '1000' },
      },
});
