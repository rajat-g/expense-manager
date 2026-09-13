# Expense Manager

Offline-first expense tracker as a static PWA — no backend, no build step, no
analytics. Your ledger lives in on-device SQLite (sql.js); an encrypted,
sharded backup syncs to your own private GitHub repo; bank SMS arrives via an
iPhone Shortcut into a review inbox. Dark blue-black theme by default with a
light mode, haptic feedback on mobile, and a desktop layout that earns its
pixels.

## Use it

Open the hosted app directly: **[expense-manager-local.netlify.app](https://expense-manager-local.netlify.app/)**

The app works offline after its shell is cached. Your ledger stays in this
browser unless you configure encrypted GitHub sync in Settings.

## Features

**Dashboard** — Net/in/out hero with quick Add + Sync actions, last-6-months
income-vs-expense area chart (lazy-loaded, theme-aware, per-card skeletons),
top-category bars, recent transactions (tap any row to edit it). Tapping a
month or a category drills into the filtered Transactions view.

**Transactions** — Month pager with income/expense/total strip, collapsible
filters (date range, account, category, type, full-text search), dense
day-grouped ledger. Tap a row to edit it in the bottom sheet (centred modal
on desktop); `×` deletes with a tombstone so the delete propagates on next
sync. Supports **transfers** between own accounts (excluded from in/out and
balances-aware) and **splits** (one payment across categories). Select
multiple transactions for bulk category changes, account changes, deletion,
or CSV export. CSV export is also available for the current filtered view.

**Recurring** — Templates for weekly, monthly, quarterly, and yearly entries
(rent, salary, subscriptions). Upcoming occurrences can be previewed, one
occurrence can be skipped without pausing the template, and overdue
occurrences are shown. Materialized entries use collision-proof ids, so two
devices can never duplicate an occurrence. Pause/resume/edit/delete templates.

**Inbox (bank SMS)** — iPhone Shortcuts automation forwards each bank/UPI SMS
to the app (`?inbox=1&body=…&sender=…`). Every message is parsed
(rule-based, see below), queued in a temporary outbox, then stored as one
encrypted file in your repo's messages folder — never in local SQLite. You
pick account + category and Save to convert it into a transaction (or Ignore
it). Optional delete-after-convert, CSV dataset export for parser training,
paste-box for testing without a phone.

**Accounts & Categories** — Account groups (cash/bank/debit/credit) with
per-group and per-account balances; expense/income/both categories.

**Sync & backup (passwordstore-style)** — AES-256-GCM via WebCrypto; the
passphrase never leaves the browser, GitHub only sees ciphertext. The backup
is sharded (`dims.enc.json` + `months/YYYY-MM.enc.json`); every push pulls
first and unions by id (pushing device wins ties, tombstones delete), empty
month files are removed remotely. Auto-push (debounced) and startup
auto-pull are opt-in. The Danger Zone separates the three stores — GitHub
data, device database, browser storage — with two plain wipes (no
tombstones): GitHub + device, or everything including this browser. An
in-app **Help & FAQ** page (ⓘ buttons in Settings) documents the
multi-device semantics.

**Installable PWA** — Manifest + offline service worker, maskable icon,
favicons, iOS splash screens. iPhone: Safari → Share → Add to Home Screen.
A "Reload fresh app files" button purges stale caches after updates.

**Theme, feel & lock** — Explicit dark/light toggle (top bar, sidebar,
Settings; dark by default, persisted, no flash). Haptics via vendored
`web-haptics` (tab selection, sheet open, save success, validation errors,
delete warnings, manual sync outcomes; background auto-sync stays silent).
Optional PIN app lock (hashed, never stored) on launch and after 10 minutes
away.

**Browser coverage** — Playwright tests cover mobile category actions, sync
chip overflow, offline-to-online auto-pull recovery, bulk transaction actions,
recurring preview/skip behavior, service-worker registration, and shell-cache
population.

## File structure

*   `index.html` — App shell: pages, bottom sheet, tab bar / sidebar.
*   `styles.css` — Design tokens (dark + light), phone/desktop layouts.
*   `utils.js` — Selectors, formatting, theme state.
*   `database.js` — SQLite lifecycle, schema + seeds, tombstone helpers.
*   `dashboard.js` — Async dashboard cards + lazy charts.
*   `transactions.js` — Ledger, filters, add/edit sheet, bulk actions, CSV export.
*   `recurring.js` — Multi-cadence templates, previews, skips + auto-materialization.
*   `lock.js` — Optional PIN app lock.
*   `accounts.js`, `categories.js` — Group/account/category management.
*   `inbox.js` — SMS intake, outbox, review-to-transaction flow.
*   `parsers.js` — Pluggable SMS parsing rules (see below).
*   `vault.js` — AES-256-GCM envelopes for DB, shards and messages.
*   `gitremote.js` — Remote-URL parsing (`https/ssh/shorthand`).
*   `ledger.js` — Pure merge/split logic for sharded sync (unit-tested).
*   `github-sync.js` — Encrypted backup + message-folder sync, wipes.
*   `settings.js` — Settings events, theme + FAQ wiring.
*   `haptics.js` + `vendor/web-haptics.js` — Haptic wrapper + engine (MIT).
*   `manifest.webmanifest`, `sw.js`, `icons/`, `favicon.ico` — PWA assets.
*   `server.js` — Zero-dependency static server for local development.
*   `tests.html`, `tests/` — Browser mocha suite, Playwright E2E tests + `run-node-tests.js`.
*   `playwright.config.js` — Local Playwright configuration for browser tests.

## Run it

Node is only for local development and tests; hosting stays static (e.g.
Netlify — deploy this folder, no build step).

1.  Clone the repository.
2.  `npm start` and open http://localhost:3000
    (port taken: `PORT=8910 npm start` on macOS/Linux,
    `$env:PORT=8910; npm start` on Windows PowerShell).
    You can also just open `index.html` directly.

For the hosted version, open the URL in [Use it](#use-it).

## Tests

*   `npm test` — fast Node checks: parsers, vault, git-remote, ledger merge.
*   Open `tests.html` in a browser — full mocha suite (adds DB, transaction
    rules, utils).
*   `npm run test:e2e` — Playwright browser tests for mobile UI, sync recovery,
  bulk actions, recurring controls, and PWA caching.

The first E2E run may require `npx playwright install chromium` to download
the local test browser.

## Adding message parsers

`parsers.js` exposes a tiny rule engine (`MsgParser`). Rules run **in
registration order, first match wins**; anything unmatched returns
`rule: "no-match"` (e.g. OTPs). A rule is:

```js
MsgParser.addMsgRule({
  id: "hdfc-upi-debit",            // unique; re-adding an id replaces it
  name: "HDFC UPI debits",
  when: (text, sender) => sender === "HDFCBK" && /debited/i.test(text),
  parse: (text, sender) => ({
    amount: MsgParser.extractAmounts(text)[0] ?? null,
    type: "expense",               // "income" | "expense" | "unknown"
    merchant: "…",
    upiRef: "…",                   // optional
    note: "…",                     // optional, ≤140 chars shown
    confidence: "high",            // low | medium | high
    rule: "hdfc-upi-debit",
  }),
});
```

Helpers available: `extractAmounts(text)` (Rs/INR/₹/rupees mentions),
`detectType(text)` (debit/credit keyword signals), `listRules()`. The parsed
result only **prefills** the inbox form (`inbox.js` calls
`MsgParser.parseMessage(text, sender)` with the upper-cased bank shortcode);
the user always confirms account + category before saving.

Two ordering notes that bite:

*   The built-in `generic-upi-bank` rule (matches anything with an amount) is
    registered at load, so a rule added later only fires when generic *doesn't*
    match. For bank-specific overrides, add your rule **in `parsers.js`
    above the generic registration** — or re-register the
    `generic-upi-bank` id with a version that tries your patterns first.
*   Cover it: add cases to `tests/parsers.spec.js` (browser suite) and the
    core ones to `tests/run-node-tests.js` (`npm test`). Paste real SMS into
    the inbox paste-box to see rule, confidence and note live.
