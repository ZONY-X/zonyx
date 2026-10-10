import { defineConfig } from "@playwright/test";
// Local UI + intercepted fixture requests only. No external DNS/network traffic.
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "booking-rental-agreement-acceptance.spec.ts",
    "vehicle-minimum-rental.spec.ts",
    "paypal-return.spec.ts",
    "paypal-card.spec.ts",
  ],
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:43871",
    browserName: "chromium",
    serviceWorkers: "block",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
        "--disable-background-networking",
      ],
    },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 43871 --strictPort",
    url: "http://127.0.0.1:43871",
    reuseExistingServer: false,
    env: {
      VITE_PAYPAL_INTERNAL_CHECKOUT_ENABLED: "true",
      VITE_SUPABASE_URL: "https://fazzuetfwwfiqehpnjky.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "synthetic-test-publishable-key",
    },
  },
});
