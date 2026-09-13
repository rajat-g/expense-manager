// ledger.js - pure record-level merge/split logic for sharded GitHub sync.
// No DOM, no network, no database: everything is plain data in/out so it can
// be unit-tested in Node and the browser. DB + GitHub I/O lives in github-sync.js.
//
// Sync model (passwordstore-style, one encrypted file per shard):
//   <dir>/dims.enc.json            account_groups, accounts, categories, tombstones
//   <dir>/months/2026-09.enc.json  transactions dated 2026-09 (plus "undated")
// Union merge by id (uuids), local wins same-id conflicts, tombstones delete.

const Ledger = (() => {
  const DIM_TABLES = ["account_groups", "accounts", "categories", "recurring"];
  const ALL_TABLES = ["account_groups", "accounts", "categories", "recurring", "transactions", "tombstones"];

  // "2026-09-14" -> "2026-09"; anything else -> "undated"
  function monthKey(dateStr) {
    const m = /^(\d{4})-(\d{2})/.exec(String(dateStr || ""));
    if (!m) return "undated";
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return "undated";
    return `${m[1]}-${m[2]}`;
  }

  function emptyLedger() {
    return {
      dims: { account_groups: [], accounts: [], categories: [], recurring: [], tombstones: [] },
      months: {},
    };
  }

  // Union by id; local rows win same-id conflicts; tombstoned ids dropped.
  function mergeTables(localRows, remoteRows, tombIds) {
    const map = new Map();
    for (const r of remoteRows || []) if (r && r.id != null) map.set(r.id, r);
    for (const r of localRows || []) if (r && r.id != null) map.set(r.id, r);
    if (tombIds) for (const id of tombIds) map.delete(id);
    return [...map.values()];
  }

  function tombIdSet(tombRows) {
    const s = new Set();
    for (const t of tombRows || []) if (t && t.id != null) s.add(t.id);
    return s;
  }

  function mergeTombstones(localTombs, remoteTombs) {
    return mergeTables(localTombs, remoteTombs, null);
  }

  function splitMonths(transactions) {
    const months = {};
    for (const t of transactions || []) {
      const k = monthKey(t && t.date);
      (months[k] = months[k] || []).push(t);
    }
    return months;
  }

  // Merge two full ledgers {dims, months}. Returns a fresh merged ledger.
  function mergeLedgers(local, remote) {
    const L = local || emptyLedger();
    const R = remote || emptyLedger();
    const tombs = mergeTombstones(
      (L.dims || {}).tombstones, (R.dims || {}).tombstones);
    const tombIds = tombIdSet(tombs);
    const dims = { tombstones: tombs };
    for (const t of DIM_TABLES) {
      dims[t] = mergeTables((L.dims || {})[t], (R.dims || {})[t], tombIds);
    }
    const months = {};
    const keys = new Set([
      ...Object.keys(L.months || {}),
      ...Object.keys(R.months || {}),
    ]);
    for (const k of keys) {
      const rows = mergeTables(
        (L.months || {})[k], (R.months || {})[k], tombIds);
      if (rows.length) months[k] = rows;
      // Empty months are dropped: with tombstones enforcing the deletes,
      // there is no need to keep (or upload) an empty shard file.
    }
    return { dims, months };
  }

  // Flatten a merged ledger back to per-table row lists for SQLite replace.
  function flattenLedger(merged) {
    const M = merged || emptyLedger();
    const out = {
      account_groups: (M.dims || {}).account_groups || [],
      accounts: (M.dims || {}).accounts || [],
      categories: (M.dims || {}).categories || [],
      recurring: (M.dims || {}).recurring || [],
      tombstones: (M.dims || {}).tombstones || [],
      transactions: [],
    };
    for (const k of Object.keys(M.months || {})) {
      for (const t of M.months[k] || []) out.transactions.push(t);
    }
    return out;
  }

  // Shard file paths for a backup dir ("" = repo root).
  function ledgerDir(backupFilePath) {
    const p = String(backupFilePath || "").replace(/^\/+|\/+$/g, "");
    if (!p || !p.includes("/")) return "";
    return p.slice(0, p.lastIndexOf("/"));
  }

  function shardPaths(backupFilePath) {
    const dir = ledgerDir(backupFilePath);
    const pre = dir ? dir + "/" : "";
    return {
      dir,
      dims: pre + "dims.enc.json",
      month: (key) => pre + "months/" + key + ".enc.json",
      monthsDir: pre + "months",
    };
  }

  return {
    DIM_TABLES, ALL_TABLES,
    monthKey, emptyLedger, mergeTables, tombIdSet, mergeTombstones,
    splitMonths, mergeLedgers, flattenLedger, ledgerDir, shardPaths,
  };
})();

// Node export for tests (browser ignores)
if (typeof module !== "undefined" && module.exports) {
  module.exports = Ledger;
}
