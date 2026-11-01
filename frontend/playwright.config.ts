import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  projects: [
    { name: "light", use: { colorScheme: "light" } },
    { name: "dark", use: { colorScheme: "dark" } },
  ],
  use: {
    baseURL: "http://127.0.0.1:4179",
    viewport: { width: 1380, height: 880 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "vp dev --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
