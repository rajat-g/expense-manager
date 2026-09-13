const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:3000", serviceWorkers: "allow" },
  webServer: { command: "node server.js", url: "http://127.0.0.1:3000", reuseExistingServer: true },
});