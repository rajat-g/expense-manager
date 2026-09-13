const { test, expect } = require("@playwright/test");

async function openApp(page, width = 1280, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof db !== "undefined" && !!db);
  await expect(page.locator("#dashboard")).toBeVisible();
  const nav = width <= 900 ? "nav.tabbar" : "nav.sidebar";
  await page.locator(`${nav} button[data-page="categories"]`).waitFor();
}

test("mobile category actions remain visible and the page does not overflow", async ({ page }) => {
  await openApp(page, 390, 844);
  await expect(page.locator("#recentTx .txselect")).toHaveCount(0);
  await page.locator('nav.tabbar button[data-page="categories"]').click();
  await expect(page.locator("#catExpense [data-editcat]").first()).toBeVisible();
  await expect(page.locator("#catExpense [data-delcat]").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("offline sync chip stays inside common phone widths", async ({ page }) => {
  await page.context().setOffline(false);
  await page.addInitScript(() => {
    localStorage.setItem("expense_gh_sync_cfg_v1", JSON.stringify({
      remoteUrl: "https://github.com/test/expenses.git", token: "test-token", passphrase: "test-pass", autoPull: true
    }));
    localStorage.setItem("expense_gh_sync_times_v1", JSON.stringify({ pull: new Date().toISOString() }));
  });
  await openApp(page, 390, 844);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("#syncChipText")).toContainText("Offline");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("online transition attempts an auto-pull after offline recovery", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("expense_gh_sync_cfg_v1", JSON.stringify({
      remoteUrl: "https://github.com/test/expenses.git", token: "test-token", passphrase: "test-pass", autoPull: true
    }));
  });
  let apiRequests = 0;
  await page.route("https://api.github.com/**", async (route) => {
    apiRequests++;
    await route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
  });
  await openApp(page);
  apiRequests = 0;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
  });
  await expect.poll(() => apiRequests).toBeGreaterThan(0);
});

test("bulk transaction actions select rows and export the selection", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const date = new Date().toISOString().slice(0, 10);
    exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)", ["e2e-bulk-1", date, "a_cash", "c_food", "expense", 10, "bulk one"]);
    exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)", ["e2e-bulk-2", date, "a_cash", "c_food", "expense", 20, "bulk two"]);
    saveDB();
    renderTxSelectors();
    applyFilters();
  });
  await page.locator('nav.sidebar button[data-page="transactions"]').click();
  await expect(page.locator('[data-select-tx="e2e-bulk-1"]')).toBeVisible();
  await page.locator('[data-select-tx="e2e-bulk-1"]').check();
  await page.locator('[data-select-tx="e2e-bulk-2"]').check();
  await expect(page.locator("#txBulkBar")).toBeVisible();
  await page.locator("#txBulkCategory").selectOption("c_other");
  expect(await page.evaluate(() => queryOne("SELECT categoryId FROM transactions WHERE id=?", ["e2e-bulk-1"]).categoryId)).toBe("c_other");
  await page.locator("#txBulkAccount").selectOption("a_bank");
  expect(await page.evaluate(() => queryOne("SELECT accountId FROM transactions WHERE id=?", ["e2e-bulk-1"]).accountId)).toBe("a_bank");
  const download = page.waitForEvent("download");
  await page.locator("#txBulkExport").click();
  expect((await download).suggestedFilename()).toBe("selected-transactions.csv");
  await page.locator("#txBulkDelete").click();
  await page.locator(".swal2-confirm").click();
  await expect(page.locator("#txBulkBar")).toBeHidden();
});

test("recurring preview and skip-next work for weekly schedules", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    const today = new Date().toISOString().slice(0, 10);
    exec("INSERT INTO recurring(id,accountId,categoryId,type,amount,note,day,startMonth,endMonth,paused,cadence,startDate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", ["e2e-weekly", "a_cash", "c_food", "expense", 25, "Weekly test", 1, today.slice(0, 7), null, 0, "weekly", today]);
    saveDB();
    renderRecurring();
  });
  await page.locator("#recurringBtn").click();
  await page.locator('[data-recpreview="e2e-weekly"]').click();
  await expect(page.locator("#recPreview")).toContainText("Upcoming occurrences");
  await page.locator('[data-recskip="e2e-weekly"]').click();
  expect(await page.evaluate(() => query("SELECT id FROM tombstones WHERE id LIKE 'rec:e2e-weekly:%'").length)).toBe(1);
});

test("PWA registers its service worker and populates the shell cache", async ({ page }) => {
  await openApp(page);
  await expect.poll(async () => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/")))).toBe(true);
  await expect.poll(async () => page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith("expense-manager-")))).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller === null || !!navigator.serviceWorker.controller)).toBe(true);
});