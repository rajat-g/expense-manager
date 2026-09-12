# Expense Manager — product truth

- Personal expense tracker for one user in India (₹). iPhone-first: installed via
  Safari Add to Home Screen, offline-capable PWA. No App Store, no accounts server.
- Local-first: accounts, categories, transactions in on-device SQLite (sql.js),
  persisted to localStorage. Encrypted backup of the whole DB to a private GitHub
  repo (AES-256-GCM, passphrase never leaves the device).
- SMS inbox: iPhone Shortcut sends bank/UPI SMS via URL into an inbox; messages live
  ONLY as per-file ciphertext in a GitHub folder (+ temporary outbox until upload).
  User reviews each message, picks account + category, saves as a transaction.
- Pages: Dashboard, Transactions, Inbox, Accounts, Categories, Settings. No auth,
  no sharing, no multi-user. Nothing here may invent network accounts or pricing.
