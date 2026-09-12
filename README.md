# Expense Manager

Offline-first, iOS-native-feeling expense tracker (static PWA, no backend).
On-device SQLite (sql.js) + encrypted GitHub backup (AES-256-GCM, passphrase never
leaves the browser) + SMS inbox via iPhone Shortcuts (messages live only as
per-file ciphertext in a GitHub folder).

## Features

*   Dashboard overview of income vs expenses with charts
*   Manage accounts, categories, and transactions
*   SMS inbox: Shortcuts intake, rule-based parsing, review-to-transaction flow
*   Encrypted GitHub backup (whole DB) and per-message encrypted folder
*   Installable on iPhone via Safari Add to Home Screen, works offline

## File Structure

*   `index.html`: The main entry point of the application.
*   `styles.css`: iOS-native design system (light + dark).
*   `dashboard.js`: Dashboard stats and charts.
*   `accounts.js`: Logic for managing accounts.
*   `categories.js`: Logic for managing expense categories.
*   `transactions.js`: Logic for managing transactions.
*   `inbox.js`: SMS inbox (outbox queue + GitHub-backed review).
*   `parsers.js`: Pluggable SMS parsing rules.
*   `database.js`: SQLite (sql.js) schema and lifecycle.
*   `vault.js`: Client-side encryption envelopes.
*   `github-sync.js`: Encrypted GitHub backup + message-folder sync.
*   `settings.js`: Settings event handlers.
*   `utils.js`: Utility functions.
*   `server.js`: Zero-dependency static server for local development.
*   `tests.html`: Browser test suite entry point.
*   `tests/`: Browser specs plus `run-node-tests.js` for `npm test`.

## How to Run

Node is used for local development and tests; production hosting stays static
(e.g. Netlify — just deploy this folder, no build step).

1.  Clone the repository.
2.  `npm start` and open http://localhost:3000
    (if the port is taken: `PORT=8910 npm start` on macOS/Linux,
    `$env:PORT=8910; npm start` on Windows PowerShell).
    You can also simply open `index.html` in your web browser.

## Tests

*   `npm test` — fast Node checks (parsers + vault).
*   Open `tests.html` in your web browser — full mocha suite.
