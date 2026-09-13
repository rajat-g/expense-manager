// Privacy model (verifiable in this file + vault.js):
// - Everything in this Settings section is stored ONLY in this browser's
//   localStorage, including the token and the encryption passphrase.
// - The passphrase is used solely for local WebCrypto key derivation
//   (see vault.js). It is never placed in a URL, header, or request body.
// - The only network calls the app makes are to https://api.github.com
//   (your own repo: ciphertext up/down, token in the Authorization header)
//   plus CDN library downloads (sql.js, charts). No personal server or DB.

const GhSync = (() => {
  const LS_KEY = "expense_gh_sync_cfg_v1";
  let autoTimer = null;
  let suppressAuto = false;

  function $(id) { return document.getElementById(id); }

  function loadCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
      return {
        owner: c.owner || "",
        repo: c.repo || "",
        remoteUrl: c.remoteUrl || "",
        path: c.path || "expenses/expenses.enc.json",
        msgFolder: c.msgFolder || "messages",
        branch: c.branch || "main",
        token: c.token || "",
        passphrase: c.passphrase || "",
        auto: !!c.auto,
        autoPull: !!c.autoPull,
      };
    } catch { return { owner:"", repo:"", remoteUrl:"", path:"expenses/expenses.enc.json", msgFolder:"messages", branch:"main", token:"", passphrase:"", auto:false, autoPull:false }; }
  }

  function readForm() {
    // The remote URL is the single source of truth for owner/repo.
    const remoteUrl = ($("ghRemoteUrl")?.value || "").trim();
    const parsed = (typeof GitRemote !== "undefined") ? GitRemote.parseGitRemote(remoteUrl) : null;
    return {
      owner: parsed ? parsed.owner : "",
      repo: parsed ? parsed.repo : "",
      host: parsed ? parsed.host : "",
      remoteUrl,
      path: ($("ghPath")?.value || "").trim() || "expenses/expenses.enc.json",
      msgFolder: ($("ghMsgFolder")?.value || "").trim() || "messages",
      branch: ($("ghBranch")?.value || "").trim() || "main",
      token: ($("ghToken")?.value || "").trim(),
      // Stored in this browser's localStorage like everything else here.
      // Only ever fed to local WebCrypto calls; never sent over the network.
      passphrase: ($("ghPassphrase")?.value || ""),
      auto: !!$("ghAuto")?.checked,
      autoPull: !!$("ghAutoPull")?.checked,
    };
  }

  function fillForm(cfg) {
    // One-time upgrade: older configs stored owner/repo without a remote URL.
    let remoteUrl = cfg.remoteUrl || "";
    if (!remoteUrl && cfg.owner && cfg.repo) {
      remoteUrl = `https://github.com/${cfg.owner}/${cfg.repo}.git`;
      try { saveCfg({ ...cfg, remoteUrl }); } catch {}
    }
    if ($("ghRemoteUrl")) $("ghRemoteUrl").value = remoteUrl;
    if ($("ghPath")) $("ghPath").value = cfg.path || "expenses/expenses.enc.json";
    if ($("ghMsgFolder")) $("ghMsgFolder").value = cfg.msgFolder || "messages";
    if ($("ghBranch")) $("ghBranch").value = cfg.branch || "main";
    if ($("ghToken")) $("ghToken").value = cfg.token || "";
    if ($("ghPassphrase")) $("ghPassphrase").value = cfg.passphrase || "";
    if ($("ghAuto")) $("ghAuto").checked = !!cfg.auto;
    if ($("ghAutoPull")) $("ghAutoPull").checked = !!cfg.autoPull;
  }

  function saveCfg(cfg) {
    localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  }

  // Last successful push/pull timestamps (separate key: readForm() must stay
  // form-only so saving settings never wipes them).
  const TIMES_KEY = "expense_gh_sync_times_v1";

  function getSyncTimes() {
    try {
      const t = JSON.parse(localStorage.getItem(TIMES_KEY) || "{}");
      return { push: t.push || null, pull: t.pull || null };
    } catch { return { push: null, pull: null }; }
  }

  function timeAgo(iso) {
    const t = Date.parse(iso || "");
    if (!t) return "never";
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    const d = Math.floor(h / 24);
    if (d === 1) return "yesterday";
    if (d < 30) return `${d} days ago`;
    return new Date(t).toLocaleDateString();
  }

  function markSync(kind) {
    try {
      const t = getSyncTimes();
      t[kind] = new Date().toISOString();
      localStorage.setItem(TIMES_KEY, JSON.stringify(t));
    } catch {}
    renderSyncTimes();
  }

  // Shown only when sync is correctly configured; hidden otherwise.
  // Also drives the topbar sync chip (stateful even when unconfigured).
  function renderSyncTimes() {
    const el = $("ghSyncTimes");
    const chip = $("syncChip");
    const chipText = $("syncChipText");
    let configured = false;
    try { configured = isConfiguredForSync(readForm()); } catch {}
    if (el) {
      if (!configured) { el.style.display = "none"; }
      else {
        el.style.display = "";
        const t = getSyncTimes();
        el.textContent = `Last push: ${timeAgo(t.push)} · Last pull: ${timeAgo(t.pull)}`;
      }
    }
    if (chip) {
      chip.classList.toggle("ok", configured);
      if (chipText) {
        if (!configured) { chipText.textContent = "Sync off"; }
        else {
          const t = getSyncTimes();
          chipText.textContent = t.push ? `Synced ${timeAgo(t.push)}` : "Never pushed";
        }
      }
    }
  }

  function setStatus(msg, isErr) {
    const el = $("ghStatus");
    if (el) {
      el.textContent = msg;
      el.style.color = isErr ? "#b42318" : "";
    }
  }

  // Danger Zone has its own status line: wipe results must appear where the
  // buttons are, not only up in the Backup section (out of view).
  function setDangerStatus(msg, isErr) {
    const el = $("dangerStatus");
    if (el) {
      el.textContent = msg;
      el.style.color = isErr ? "#b42318" : "";
    }
  }

  // Wipe flows report to BOTH the backup status and the Danger Zone line.
  function setWipeStatus(msg, isErr) {
    setStatus(msg, isErr);
    setDangerStatus(msg, isErr);
  }

  function feelTap(t) {
    try { if (typeof Haptics !== "undefined") Haptics.tap(t); } catch {}
  }

  function requireCfg(cfg) {
    if (!cfg.owner || !cfg.repo) throw new Error("Paste your git remote URL first (e.g. https://github.com/OWNER/REPO).");
    if (cfg.host && typeof GitRemote !== "undefined" && !GitRemote.isGitHubHost(cfg.host)) {
      throw new Error(`"${cfg.host}" is not github.com — sync only works with GitHub.`);
    }
    if (!cfg.token) throw new Error("Set a GitHub fine-grained token (Contents read+write on this repo).");
    if (!cfg.path) throw new Error("Set a file path in the repo.");
  }

  function updateResolvedLine() {
    const el = $("ghRepoResolved");
    if (!el) return;
    const cfg = readForm();
    el.textContent = (cfg.owner && cfg.repo)
      ? `Repo: ${cfg.owner} / ${cfg.repo} ✓`
      : "No valid remote URL yet.";
  }

  // Re-read the remote URL field, persist it, and show the resolved repo.
  function fillFromRemote() {
    const input = ($("ghRemoteUrl")?.value || "").trim();
    if (!input) {
      updateResolvedLine();
      return false;
    }
    saveCfg(readForm());
    updateResolvedLine();
    const cfg = readForm();
    if (!cfg.owner || !cfg.repo) {
      setStatus("Could not read a repo from that URL. Try https://github.com/OWNER/REPO.", true);
      return false;
    }
    setStatus(`Repo set to ${cfg.owner}/${cfg.repo} ✓`);
    return true;
  }

  // Verify the token like a login: shows which GitHub user it belongs to.
  async function verifyConnection() {
    const cfg = readForm();
    try {
      if (!cfg.token) throw new Error("Paste a token first.");
      setStatus("Verifying token with GitHub…");
      const res = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${cfg.token}`, "Accept": "application/vnd.github+json" },
      });
      if (res.status === 401) throw new Error("Token rejected (401). Create a new fine-grained PAT and paste it again.");
      if (res.status === 403) throw new Error("Token blocked (403). It may be expired or rate-limited — check GitHub settings.");
      if (!res.ok) throw new Error(`GitHub answered ${res.status}. Retry in a moment.`);
      const user = await res.json();
      saveCfg(cfg);
      setStatus(`Connected as @${user.login} ✓ — pushes will land in ${cfg.owner || "?"} / ${cfg.repo || "?"}.`);
    } catch (e) {
      setStatus("Verify failed: " + (e?.message || e), true);
    }
  }

  function passphrase() {
    const p = ($("ghPassphrase")?.value || "");
    if (!p) throw new Error("Enter your encryption passphrase.");
    return p;
  }

  function apiBase(cfg) {
    return contentsUrl(cfg, cfg.path);
  }

  function contentsUrl(cfg, repoPath) {
    const clean = String(repoPath || "").replace(/^\/+/, "");
    return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${clean.split("/").map(encodeURIComponent).join("/")}`;
  }

  // Separate folder for per-message encrypted files (passwordstore-style:
  // one ciphertext file per message). Local SQLite stays the second copy.
  function msgFolder(cfg) {
    return String((cfg && cfg.msgFolder) || "messages").replace(/^\/+|\/+$/g, "") || "messages";
  }

  function msgFilePath(cfg, id) {
    return msgFolder(cfg) + "/" + id + ".enc.json";
  }

  async function getRemotePath(cfg, repoPath) {
    const url = `${contentsUrl(cfg, repoPath)}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${cfg.token}`, "Accept": "application/vnd.github+json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`GitHub read failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return res.json();
  }

  async function listRemoteFolder(cfg, folder) {
    const data = await getRemotePath(cfg, folder);
    if (!data) return [];
    return Array.isArray(data) ? data : [];
  }

  async function putRemoteFile(cfg, repoPath, contentB64, message, sha) {
    const body = { message, content: contentB64, branch: cfg.branch };
    if (sha) body.sha = sha;
    const put = await fetch(contentsUrl(cfg, repoPath), {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!put.ok) {
      const t = await put.text().catch(() => "");
      if (put.status === 409) throw new Error("Conflict (remote changed). Pull first, then push again.");
      if (put.status === 401 || put.status === 403) throw new Error("Auth failed. Check token scope (Contents read+write on this repo) and expiry.");
      if (put.status === 404) throw new Error("Repo/path not found. Create the private repo first (empty is fine) and check branch name.");
      throw new Error(`GitHub write failed (${put.status}): ${t.slice(0, 300)}`);
    }
    return put.json();
  }

  async function getRemote(cfg) {
    const url = `${apiBase(cfg)}?ref=${encodeURIComponent(cfg.branch)}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${cfg.token}`, "Accept": "application/vnd.github+json" },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`GitHub read failed (${res.status}): ${t.slice(0, 200)}`);
    }
    return res.json();
  }

  async function pushBackup() {
    const cfg = readForm();
    try {
      requireCfg(cfg);
      const pw = passphrase();
      if (typeof db === "undefined" || !db) throw new Error("Database not ready yet.");
      setStatus("Encrypting…");
      const bytes = db.export();
      const payload = await Vault.encryptDb(pw, bytes);
      const json = JSON.stringify(payload, null, 2);
      // GitHub Contents API expects base64 of file bytes (utf-8 safe)
      const contentB64 = b64EncodeUtf8(json);
      setStatus("Checking remote…");
      const remote = await getRemote(cfg);
      const body = {
        message: `expenses backup ${new Date().toISOString()}`,
        content: contentB64,
        branch: cfg.branch,
      };
      if (remote && remote.sha) body.sha = remote.sha;
      setStatus(remote ? "Updating encrypted file on GitHub…" : "Creating encrypted file on GitHub…");
      const put = await fetch(apiBase(cfg), {
        method: "PUT",
        headers: {
          "Authorization": `Bearer ${cfg.token}`,
          "Accept": "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!put.ok) {
        const t = await put.text().catch(() => "");
        if (put.status === 409) throw new Error("Conflict (remote changed). Pull first, then push again.");
        if (put.status === 401 || put.status === 403) throw new Error("Auth failed. Check token scope (Contents read+write on this repo) and expiry.");
        if (put.status === 404) throw new Error("Repo/path not found. Create the private repo first (empty is fine) and check branch name.");
        throw new Error(`GitHub write failed (${put.status}): ${t.slice(0, 300)}`);
      }
      saveCfg(cfg);
      setStatus(`Pushed encrypted backup to ${cfg.owner}/${cfg.repo}@${cfg.branch}:${cfg.path} ✓`);
    } catch (e) {
      setStatus("Push failed: " + (e?.message || e), true);
    }
  }

  function b64EncodeUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function b64DecodeUtf8(b64) {
    const bin = atob(b64.replace(/\n/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---- Sharded ledger sync (pull-before-push by default) ----
  // Local SQLite stays the working copy. GitHub holds one encrypted file per
  // shard: <dir>/dims.enc.json + <dir>/months/YYYY-MM.enc.json.
  // Every push first pulls remote shards, unions by id (local wins conflicts,
  // tombstones delete), writes the merged result back locally AND remotely,
  // so no device silently overwrites another.

  const LEDGER_TABLES = {
    account_groups: ["id", "name", "type"],
    accounts: ["id", "name", "groupId"],
    categories: ["id", "name", "type"],
    transactions: ["id", "date", "accountId", "categoryId", "type", "amount", "note"],
    tombstones: ["id", "tbl", "deleted_at"],
  };

  // Read every sync table out of a sql.js Database (live db or legacy import).
  function readAllTables(sqlDb) {
    const out = {};
    for (const t of Object.keys(LEDGER_TABLES)) {
      try {
        const res = sqlDb.exec(`SELECT * FROM ${t}`);
        if (!res.length) { out[t] = []; continue; }
        const { columns, values } = res[0];
        out[t] = values.map((v) => Object.fromEntries(v.map((x, i) => [columns[i], x])));
      } catch { out[t] = []; }
    }
    return out;
  }

  function dumpLocalLedger() {
    const rows = readAllTables(db);
    return {
      dims: {
        account_groups: rows.account_groups,
        accounts: rows.accounts,
        categories: rows.categories,
        tombstones: rows.tombstones,
      },
      months: Ledger.splitMonths(rows.transactions),
    };
  }

  // Replace local tables with merged data (the "pull" half). Fixed table list
  // keeps this injection-safe.
  function replaceAllTables(flat) {
    suppressAuto = true;
    try {
      for (const t of Object.keys(LEDGER_TABLES)) {
        exec(`DELETE FROM ${t}`);
        const cols = LEDGER_TABLES[t];
        const stmt = db.prepare(`INSERT OR IGNORE INTO ${t}(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
        for (const r of (flat[t] || [])) stmt.run(cols.map((c) => (r[c] ?? null)));
        stmt.free();
      }
      saveDB();
      refreshAll();
    } finally {
      suppressAuto = false;
    }
  }

  async function decryptShardPayload(file, what) {
    if (!file || !file.content) throw new Error(`Missing ${what}.`);
    let payload;
    try { payload = JSON.parse(b64DecodeUtf8(file.content)); }
    catch { throw new Error(`Remote ${what} is not valid vault JSON.`); }
    try {
      const text = await Vault.decryptText(passphraseOrThrow(), payload);
      const rec = JSON.parse(text);
      if (!rec || rec.kind !== "expense-shard") throw new Error("bad kind");
      return rec;
    } catch (e) {
      if (e && e.message === "bad kind") throw new Error(`Remote ${what} is not a ledger shard.`);
      throw new Error("Decryption failed. Wrong passphrase or file tampered with.");
    }
  }

  function passphraseOrThrow() {
    const p = ($("ghPassphrase")?.value || "") || (loadCfg().passphrase || "");
    if (!p) throw new Error("Enter your encryption passphrase.");
    return p;
  }

  // Fetch every remote shard (+ legacy single file on first run) into a ledger.
  async function fetchLedger(cfg, pw) {
    const paths = Ledger.shardPaths(cfg.path);
    const merged = Ledger.emptyLedger();
    // dims
    try {
      const file = await getRemotePath(cfg, paths.dims);
      if (file) {
        const rec = await decryptShardPayload(file, "dimensions");
        for (const t of ["account_groups", "accounts", "categories", "tombstones"]) {
          if (Array.isArray((rec.tables || {})[t])) merged.dims[t] = rec.tables[t];
        }
      }
    } catch (e) {
      if (!/Missing dimensions/.test(e?.message || "")) throw e;
    }
    // months
    const entries = await listRemoteFolder(cfg, paths.monthsDir);
    for (const e of entries.filter((x) => x && x.name && x.name.endsWith(".enc.json"))) {
      const key = e.name.replace(/\.enc\.json$/, "");
      const file = await getRemotePath(cfg, paths.month(key));
      const rec = await decryptShardPayload(file, `month ${key}`);
      const rows = ((rec.tables || {}).transactions || []).filter((t) => Ledger.monthKey(t.date) === key);
      if (rows.length) merged.months[key] = (merged.months[key] || []).concat(rows);
    }
    // legacy single-file backup: fold in once (left untouched afterwards)
    try {
      const legacy = await getRemotePath(cfg, paths.legacy);
      if (legacy && legacy.content) {
        const payload = JSON.parse(b64DecodeUtf8(legacy.content));
        const bytes = await Vault.decryptDb(pw, payload);
        const tmp = new SQL.Database(bytes);
        try {
          const rows = readAllTables(tmp);
          for (const t of ["account_groups", "accounts", "categories", "tombstones"]) {
            merged.dims[t] = merged.dims[t].concat(rows[t]);
          }
          const byMonth = Ledger.splitMonths(rows.transactions);
          for (const k of Object.keys(byMonth)) {
            merged.months[k] = (merged.months[k] || []).concat(byMonth[k]);
          }
        } finally {
          try { tmp.close(); } catch {}
        }
      }
    } catch { /* no legacy file: normal going forward */ }
    return merged;
  }

  async function putLedgerShard(cfg, repoPath, record) {
    const payload = await Vault.encryptText(passphraseOrThrow(), JSON.stringify(record));
    const contentB64 = b64EncodeUtf8(JSON.stringify(payload, null, 2));
    const remote = await getRemotePath(cfg, repoPath);
    await putRemoteFile(cfg, repoPath, contentB64,
      `ledger ${repoPath} ${new Date().toISOString()}`, remote && remote.sha);
  }

  function shardRecord(scope, tables) {
    return { kind: "expense-shard", version: 1, scope, tables };
  }

  // Push with pull-before-push: pull remote, union (local wins, tombstones
  // delete), write merged result back to local SQLite AND to GitHub shards.
  // Haptics fire only for manual pushes — background auto-push stays silent.
  async function pushBackup(fromUser) {
    const cfg = readForm();
    const feel = (t) => { if (fromUser) { try { Haptics.tap(t); } catch {} } };
    try {
      requireCfg(cfg);
      passphraseOrThrow();
      if (typeof db === "undefined" || !db) throw new Error("Database not ready yet.");
      const paths = Ledger.shardPaths(cfg.path);
      setStatus("Pulling remote shards before push…");
      const remote = await fetchLedger(cfg, passphraseOrThrow());
      const merged = Ledger.mergeLedgers(dumpLocalLedger(), remote);
      const flat = Ledger.flattenLedger(merged);
      replaceAllTables(flat);
      const txCount = flat.transactions.length;
      setStatus(`Pushing ${Object.keys(merged.months).length} month shard(s) + dimensions (${txCount} transactions)…`);
      await putLedgerShard(cfg, paths.dims, shardRecord("dims", {
        account_groups: merged.dims.account_groups,
        accounts: merged.dims.accounts,
        categories: merged.dims.categories,
        tombstones: merged.dims.tombstones,
      }));
      for (const key of Object.keys(merged.months).sort()) {
        await putLedgerShard(cfg, paths.month(key), shardRecord(key, {
          transactions: merged.months[key],
        }));
        setStatus(`Pushed ${key}…`);
      }
      // Drop remote month shards that are now empty (tombstones enforce deletes)
      try {
        const entries = await listRemoteFolder(cfg, paths.monthsDir);
        for (const e of entries.filter((x) => x && x.name && x.name.endsWith(".enc.json"))) {
          const key = e.name.replace(/\.enc\.json$/, "");
          if (!merged.months[key]) {
            await deleteRemoteFile(cfg, paths.month(key), e.sha);
          }
        }
      } catch {}
      saveCfg(cfg);
      markSync("push");
      feel("success");
      setStatus(`Pushed ${txCount} transaction(s) across ${Object.keys(merged.months).length} month(s) to ${cfg.owner}/${cfg.repo}@${cfg.branch}:${paths.dir || "/"} ✓ (legacy single file left untouched)`);
    } catch (e) {
      try { suppressAuto = false; } catch {}
      feel("error");
      setStatus("Push failed: " + (e?.message || e), true);
    }
  }

  // Manual pull: replace local tables with the union of all remote shards
  // (+ legacy single file if shards don't exist yet). Confirmed by caller.
  async function pullBackup() {
    const cfg = readForm();
    try {
      requireCfg(cfg);
      const pw = passphraseOrThrow();
      if (typeof db === "undefined" || !db) throw new Error("Database not ready yet.");
      setStatus("Downloading ledger shards…");
      const remote = await fetchLedger(cfg, pw);
      const flat = Ledger.flattenLedger(remote);
      const txCount = flat.transactions.length;
      if (!txCount && !flat.accounts.length) {
        throw new Error("No backup found at that path/branch yet. Push first.");
      }
      replaceAllTables(flat);
      saveCfg(cfg);
      markSync("pull");
      try { Haptics.tap("success"); } catch {}
      setStatus(`Pulled ${txCount} transaction(s) across ${Object.keys(remote.months).length} month(s) ✓`);
    } catch (e) {
      try { suppressAuto = false; } catch {}
      try { Haptics.tap("error"); } catch {}
      setStatus("Pull failed: " + (e?.message || e), true);
    }
  }
  // Merge persisted settings with owner/repo parsed from the remote URL.
  function resolveCfg(cfg) {
    const parsed = (typeof GitRemote !== "undefined") ? GitRemote.parseGitRemote(cfg.remoteUrl || "") : null;
    return {
      ...cfg,
      owner: parsed ? parsed.owner : (cfg.owner || ""),
      repo: parsed ? parsed.repo : (cfg.repo || ""),
      host: parsed ? parsed.host : "",
    };
  }

  // Persisted config with owner/repo resolved (for use before the form fills).
  function storedCfg() {
    return resolveCfg(loadCfg());
  }

  // True only when every sync credential is present (remote parses to GitHub,
  // token + saved passphrase exist). No network involved.
  function isConfiguredForSync(cfg) {
    cfg = cfg || readForm();
    if (!cfg.owner || !cfg.repo || !cfg.token) return false;
    if (cfg.host && typeof GitRemote !== "undefined" && !GitRemote.isGitHubHost(cfg.host)) return false;
    if (!cfg.passphrase) return false;
    return true;
  }

  // Live check that the token works. Returns the GitHub login or null.
  async function verifyTokenQuiet(token) {
    try {
      const res = await fetch("https://api.github.com/user", {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" },
      });
      if (!res.ok) return null;
      const user = await res.json();
      return (user && user.login) || null;
    } catch { return null; }
  }

  // Startup auto-pull: runs only when the user opted in AND the connection
  // verifies live. Replaces local data with the backup, then refreshes the
  // messages cache. Never throws; reports into the sync status line.
  // NOTE: reads loadCfg() (localStorage), not the form — at startup the form
  // has not been filled from storage yet.
  async function autoPullIfConfigured() {
    let cfg;
    try {
      cfg = resolveCfg(loadCfg());
      if (!cfg.autoPull) return false;
      if (!isConfiguredForSync(cfg)) {
        console.info("Auto-pull skipped: GitHub sync not fully configured.");
        return false;
      }
      setStatus("Auto-pull: verifying GitHub connection…");
      const login = await verifyTokenQuiet(cfg.token);
      if (!login) {
        setStatus("Auto-pull skipped: connection failed. Check token, repo and branch.", true);
        return false;
      }
      setStatus(`Auto-pull: downloading ledger as @${login}…`);
      const remote = await fetchLedger(cfg, cfg.passphrase);
      replaceAllTables(Ledger.flattenLedger(remote));
      try { if (typeof Inbox !== "undefined" && Inbox.refreshRemote) await Inbox.refreshRemote(); } catch {}
      saveCfg(cfg);
      markSync("pull");
      setStatus(`Auto-pulled backup + messages as @${login} ✓`);
      return true;
    } catch (e) {
      try { suppressAuto = false; } catch {}
      setStatus("Auto-pull failed: " + (e?.message || e), true);
      return false;
    }
  }

  async function exportEncFile() {
    try {
      const pw = passphrase();
      if (typeof db === "undefined" || !db) throw new Error("Database not ready yet.");
      const payload = await Vault.encryptDb(pw, db.export());
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      downloadBlob(blob, "expenses.enc.json");
      setStatus("Downloaded expenses.enc.json (ciphertext only, safe to store anywhere).");
    } catch (e) {
      setStatus("Export failed: " + (e?.message || e), true);
    }
  }

  function importEncFile(file) {
    const pw = (() => { try { return passphrase(); } catch (e) { setStatus(e.message, true); return null; } })();
    if (!pw || !file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(reader.result);
        const bytes = await Vault.decryptDb(pw, payload);
        suppressAuto = true;
        db = new SQL.Database(bytes);
        createSchema();
        saveDB();
        refreshAll();
        suppressAuto = false;
        setStatus("Imported and decrypted " + file.name + " ✓");
      } catch {
        suppressAuto = false;
        setStatus("Import failed: wrong passphrase or invalid file.", true);
      }
    };
    reader.readAsText(file);
  }

  function setMsgStatus(msg, isErr) {
    const el = $("ghMsgStatus");
    if (el) {
      el.textContent = msg;
      el.style.color = isErr ? "#b42318" : "";
    }
  }

  // ---- Messages: GitHub encrypted folder is their ONLY home. ----
  // Local SQLite keeps no messages. New SMS waits in a temporary localStorage
  // outbox (never SQLite) and is uploaded on the next sync.
  const OUTBOX_KEY = "expense_msg_outbox_v1";

  function readOutbox() {
    try {
      const a = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }

  function writeOutbox(items) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch {}
  }

  function outboxCount() {
    return readOutbox().length;
  }

  function messageRecordFromOutbox(item, overrides = {}) {
    const p = item.parsed || {};
    return {
      kind: "expense-manager-message", version: 1, id: item.id,
      body: item.body || "", sender: item.sender || "", received_at: item.received_at || "",
      source: item.source || "", amount: p.amount ?? null, type: p.type || "unknown",
      merchant: p.merchant || "", rule: p.rule || "", confidence: p.confidence || "",
      status: "pending", tx_id: null, created_at: item.created_at || "",
      ...overrides,
    };
  }

  async function putMessageRecord(cfg, pw, rec, sha) {
    const payload = await Vault.encryptText(pw, JSON.stringify(rec));
    const contentB64 = b64EncodeUtf8(JSON.stringify(payload, null, 2));
    const done = await putRemoteFile(cfg, msgFilePath(cfg, rec.id), contentB64,
      `message ${rec.id} backup ${new Date().toISOString()}`, sha || null);
    return (done && done.content && done.content.sha) || sha || null;
  }

  async function deleteRemoteFile(cfg, repoPath, sha) {
    const res = await fetch(contentsUrl(cfg, repoPath), {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: `delete ${repoPath}`, sha, branch: cfg.branch }),
    });
    if (!res.ok && res.status !== 404) {
      const t = await res.text().catch(() => "");
      throw new Error(`GitHub delete failed (${res.status}): ${t.slice(0, 200)}`);
    }
  }

  // Upload every outbox item, removing each from the outbox on success.
  async function flushOutbox() {
    const cfg = readForm();
    try {
      requireCfg(cfg);
      const pw = passphrase();
      const items = readOutbox();
      if (!items.length) { setMsgStatus(`Outbox empty — nothing to upload ✓`); return 0; }
      setMsgStatus(`Encrypting ${items.length} queued message(s)…`);
      const remaining = [];
      let ok = 0;
      for (const item of items) {
        try {
          const remote = await getRemotePath(cfg, msgFilePath(cfg, item.id));
          await putMessageRecord(cfg, pw, messageRecordFromOutbox(item, {
            status: item.status || "pending", tx_id: item.tx_id || null,
          }), remote && remote.sha);
          ok++;
        } catch (e) { console.warn("outbox upload failed", item.id, e); remaining.push(item); }
        setMsgStatus(`Uploaded ${ok}/${items.length} queued message(s)…`);
      }
      writeOutbox(remaining);
      try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {}
      saveCfg(cfg);
      if (ok > 0) markSync("push");
      setMsgStatus(remaining.length
        ? `Uploaded ${ok}, ${remaining.length} still queued (see console).`
        : `Uploaded ${ok} message(s) to ${cfg.owner}/${cfg.repo}@${cfg.branch}:${msgFolder(cfg)}/ ✓`, remaining.length > 0);
      return ok;
    } catch (e) {
      setMsgStatus("Message upload failed: " + (e?.message || e), true);
      return 0;
    }
  }

  // Download + decrypt every message file in the folder. Returns [{rec, sha}].
  // Batches requests to stay polite with the API.
  async function fetchMessages(cfg, pw, onProgress) {
    requireCfg(cfg);
    if (!pw) throw new Error("Enter your encryption passphrase.");
    const entries = (await listRemoteFolder(cfg, msgFolder(cfg)))
      .filter((e) => e && e.name && e.name.endsWith(".enc.json"));
    const out = [];
    const BATCH = 8;
    for (let i = 0; i < entries.length; i += BATCH) {
      const chunk = entries.slice(i, i + BATCH);
      const got = await Promise.all(chunk.map(async (e) => {
        const id = e.name.replace(/\.enc\.json$/, "");
        try {
          const file = await getRemotePath(cfg, msgFilePath(cfg, id));
          if (!file || !file.content) return null;
          const rec = JSON.parse(await Vault.decryptText(pw, JSON.parse(b64DecodeUtf8(file.content))));
          if (!rec || rec.id !== id) return null;
          return { rec, sha: file.sha || null };
        } catch (err) { console.warn("message fetch failed", id, err); return null; }
      }));
      for (const g of got) if (g) out.push(g);
      if (onProgress) { try { onProgress(out.length, entries.length); } catch {} }
    }
    out.sort((a, b) => String(b.rec.created_at || "").localeCompare(String(a.rec.created_at || "")));
    return out;
  }

  // Create/update one remote message record (used for convert/ignore/reopen).
  async function saveMessageRecord(rec) {
    const cfg = readForm();
    requireCfg(cfg);
    const pw = passphrase();
    const remote = await getRemotePath(cfg, msgFilePath(cfg, rec.id));
    const sha = await putMessageRecord(cfg, pw, rec, remote && remote.sha);
    saveCfg(cfg);
    return sha;
  }

  // Delete one remote message file (used when "delete after converting" is ON).
  async function deleteMessageRecord(id) {
    const cfg = readForm();
    requireCfg(cfg);
    const remote = await getRemotePath(cfg, msgFilePath(cfg, id));
    if (!remote) return false;
    await deleteRemoteFile(cfg, msgFilePath(cfg, id), remote.sha);
    saveCfg(cfg);
    return true;
  }

  // Delete one remote path if it exists. Returns true when deleted.
  async function deleteRemotePathIfExists(cfg, repoPath) {
    const file = await getRemotePath(cfg, repoPath);
    if (!file) return false;
    await deleteRemoteFile(cfg, repoPath, file.sha);
    return true;
  }

  // Wipe the ledger backup on GitHub: month shards, dimensions, legacy file.
  // Returns { months, dims, legacy } deletion counts.
  async function wipeLedgerRemote(cfg) {
    requireCfg(cfg);
    const paths = Ledger.shardPaths(cfg.path);
    let months = 0, dims = 0, legacy = 0;
    const entries = await listRemoteFolder(cfg, paths.monthsDir);
    for (const e of entries.filter((x) => x && x.name && x.name.endsWith(".enc.json"))) {
      await deleteRemoteFile(cfg, paths.month(e.name.replace(/\.enc\.json$/, "")), e.sha);
      months++;
    }
    if (await deleteRemotePathIfExists(cfg, paths.dims)) dims++;
    if (await deleteRemotePathIfExists(cfg, paths.legacy)) legacy++;
    return { months, dims, legacy };
  }

  // Wipe every message file on GitHub + drop the local outbox. Returns count.
  async function wipeMessagesRemote(cfg) {
    requireCfg(cfg);
    const folder = msgFolder(cfg);
    const entries = (await listRemoteFolder(cfg, folder))
      .filter((e) => e && e.name && e.name.endsWith(".enc.json"));
    for (const e of entries) {
      await deleteRemoteFile(cfg, folder + "/" + e.name, e.sha);
    }
    writeOutbox([]);
    try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {}
    return entries.length;
  }

  // "Clear Database", finished properly: wipe this device (tombstoned, so the
  // wipe propagates) AND delete the ledger backup from GitHub right away.
  // Messages are a separate store — untouched. Auto-push stays suppressed so
  // the wipe itself never triggers a re-upload.
  async function clearDatabaseEverywhere() {
    const cfg = readForm();
    suppressAuto = true;
    try {
      const before = snapshotSyncIds();
      db = new SQL.Database();
      createSchema();
      seedDefaults();
      tombstoneWipedIds(before);
      saveDB();
      refreshAll();
      if (cfg.owner && cfg.repo && cfg.token) {
        setWipeStatus("Deleting ledger backup from GitHub…");
        const w = await wipeLedgerRemote(cfg);
        const n = w.months + w.dims + w.legacy;
        setWipeStatus(n
          ? `Cleared on this device + deleted ${n} backup file(s) from GitHub ✓`
          : "Cleared on this device (no backup files found on GitHub).");
      } else {
        setWipeStatus("Cleared on this device (GitHub not configured — nothing remote to delete).");
      }
      feelTap("success");
    } catch (e) {
      setWipeStatus("Clear failed: " + (e?.message || e), true);
      feelTap("error");
    } finally {
      suppressAuto = false;
    }
  }

  // "Delete Everything": plain wipe of the device ledger plus the whole GitHub
  // data (ledger backup + messages + outbox) with NO tombstones. Simple, but
  // other devices still holding data will re-upload it on their next sync.
  async function nukeEverything() {
    const cfg = readForm();
    suppressAuto = true;
    try {
      db = new SQL.Database();
      createSchema();
      seedDefaults();
      saveDB();
      refreshAll();
      if (cfg.owner && cfg.repo && cfg.token) {
        setWipeStatus("Deleting everything from GitHub…");
        const w = await wipeLedgerRemote(cfg);
        const m = await wipeMessagesRemote(cfg);
        setWipeStatus(`Deleted device ledger + ${w.months + w.dims + w.legacy} backup file(s) + ${m} message file(s) ✓ No tombstones kept — other devices will re-upload their data on next sync.`);
      } else {
        writeOutbox([]);
        setWipeStatus("Deleted device ledger (GitHub not configured — nothing remote to delete).");
      }
      feelTap("success");
    } catch (e) {
      setWipeStatus("Delete-everything failed: " + (e?.message || e), true);
      feelTap("error");
    } finally {
      suppressAuto = false;
    }
  }
  // folder, verify each id is present remotely, then DROP the local table so
  // messages are never kept in local SQLite again.
  // One-time migration: push every locally stored SQLite message to the GitHub
  // folder, verify each id is present remotely, then DROP the local table so
  // messages are never kept in local SQLite again.
  async function migrateLocalMessages() {
    const cfg = readForm();
    try {
      requireCfg(cfg);
      const pw = passphrase();
      if (typeof db === "undefined" || !db) throw new Error("Database not ready yet.");
      let hasTable = false;
      try { hasTable = query("SELECT name FROM sqlite_master WHERE type='table' AND name='raw_messages'").length > 0; }
      catch { hasTable = false; }
      if (!hasTable) return { pushed: 0, dropped: false, note: "No local messages table — nothing to migrate." };
      const rows = query("SELECT * FROM raw_messages ORDER BY created_at ASC");
      if (!rows.length) {
        db.exec("DROP TABLE IF EXISTS raw_messages");
        saveDB();
        return { pushed: 0, dropped: true, note: "Local table was empty — dropped." };
      }
      setMsgStatus(`Migrating ${rows.length} local message(s) to "${msgFolder(cfg)}"…`);
      let ok = 0;
      for (const m of rows) {
        const rec = {
          kind: "expense-manager-message", version: 1, id: m.id,
          body: m.body || "", sender: m.sender || "", received_at: m.received_at || "",
          source: m.source || "", amount: m.amount ?? null, type: m.type || "unknown",
          merchant: m.merchant || "", rule: m.rule || "", confidence: m.confidence || "",
          status: m.status || "pending", tx_id: m.tx_id || null, created_at: m.created_at || "",
        };
        try {
          const remote = await getRemotePath(cfg, msgFilePath(cfg, m.id));
          await putMessageRecord(cfg, pw, rec, remote && remote.sha);
          ok++;
        } catch (e) { console.warn("migration push failed", m.id, e); }
        setMsgStatus(`Migrated ${ok}/${rows.length}…`);
      }
      if (ok !== rows.length) {
        throw new Error(`Only ${ok}/${rows.length} uploaded. Local table kept — retry migration.`);
      }
      // Verify every id is readable remotely before dropping anything.
      const names = new Set((await listRemoteFolder(cfg, msgFolder(cfg))).map((e) => e && e.name));
      const missing = rows.filter((m) => !names.has(m.id + ".enc.json"));
      if (missing.length) {
        throw new Error(`${missing.length} file(s) missing remotely after upload. Local table kept.`);
      }
      db.exec("DROP TABLE IF EXISTS raw_messages");
      saveDB();
      try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {}
      saveCfg(cfg);
      return { pushed: ok, dropped: true, note: `Migrated ${ok} message(s), verified, local table dropped.` };
    } catch (e) {
      setMsgStatus("Migration failed: " + (e?.message || e), true);
      return { pushed: 0, dropped: false, note: "Migration failed: " + (e?.message || e) };
    }
  }

  // Called by inbox.js after a new message is queued; best-effort auto-upload
  // (the whole-DB backup auto-push is handled separately by the saveDB hook).
  function notifyLocalChange() {
    try {
      const cfg = readForm();
      if (!cfg.auto || !cfg.owner || !cfg.repo || !cfg.token) return;
      if (!(($("ghPassphrase")?.value) || "")) return;
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => { flushOutbox(); }, 4000);
    } catch {}
  }
  function scheduleAutoPush() {
    if (suppressAuto) return;
    const cfg = readForm();
    if (!cfg.auto) return;
    if (!cfg.owner || !cfg.repo || !cfg.token) return;
    const pw = $("ghPassphrase")?.value || "";
    if (!pw) return; // don't auto-push without passphrase in memory
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => { pushBackup(false); }, 3000);
  }

  function hookAutoSave() {
    // Wrap global saveDB so local edits trigger debounced encrypted push.
    try {
      if (typeof saveDB === "function" && !saveDB.__ghHooked) {
        const orig = saveDB;
        const wrapped = function () {
          const r = orig.apply(this, arguments);
          try { scheduleAutoPush(); } catch {}
          return r;
        };
        wrapped.__ghHooked = true;
        // Reassign global (function declaration -> window property in browsers)
        window.saveDB = wrapped;
        saveDB = wrapped;
      }
    } catch {}
  }

  function pwaStatus() {
    const el = document.getElementById("pwaStatus");
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const sw = ("serviceWorker" in navigator) ? "SW supported" : "SW not supported";
    const msg = standalone ? `Running as installed app ✓ (${sw})` : `Running in browser (${sw}). On iPhone: Share → Add to Home Screen.`;
    if (el) el.textContent = msg;
    else alert(msg);
  }

  function initSyncUI() {
    fillForm(loadCfg());
    updateResolvedLine();
    if ($("ghSaveBtn")) $("ghSaveBtn").onclick = () => {
      const cfg = readForm();
      saveCfg(cfg);
      renderSyncTimes();
      setStatus(cfg.token ? "Settings saved on this device (token stored locally)." : "Settings saved (no token entered).");
    };
    if ($("ghUseRemoteBtn")) $("ghUseRemoteBtn").onclick = fillFromRemote;
    if ($("ghRemoteUrl")) $("ghRemoteUrl").addEventListener("change", () => {
      if (($("ghRemoteUrl").value || "").trim()) fillFromRemote();
      else { saveCfg(readForm()); updateResolvedLine(); }
    });
    if ($("ghVerifyBtn")) $("ghVerifyBtn").onclick = verifyConnection;
    if ($("ghPushBtn")) $("ghPushBtn").onclick = () => pushBackup(true);
    if ($("ghPullBtn")) $("ghPullBtn").onclick = () => {
      if (!confirm("Replace local data with the decrypted GitHub backup?")) return;
      try { Haptics.tap("warning"); } catch {}
      pullBackup();
    };
    if ($("ghExportEncBtn")) $("ghExportEncBtn").onclick = exportEncFile;
    if ($("ghImportEncBtn")) $("ghImportEncBtn").onclick = () => $("ghImportEncFile").click();
    if ($("ghImportEncFile")) $("ghImportEncFile").onchange = (e) => {
      const f = e.target.files[0];
      if (f && confirm("Replace local data with this encrypted file (needs passphrase)?")) importEncFile(f);
      e.target.value = "";
    };
    if ($("ghPushMsgsBtn")) $("ghPushMsgsBtn").onclick = flushOutbox;
    if ($("ghPullMsgsBtn")) $("ghPullMsgsBtn").onclick = () => {
      try {
        if (typeof Inbox !== "undefined" && Inbox.refreshRemote) Inbox.refreshRemote();
        else setMsgStatus("Inbox module not ready.", true);
      } catch (e) { setMsgStatus(e?.message || e, true); }
    };
    if ($("ghAuto")) $("ghAuto").onchange = () => { saveCfg(readForm()); renderSyncTimes(); };
    if ($("ghAutoPull")) $("ghAutoPull").onchange = () => { saveCfg(readForm()); renderSyncTimes(); };
    ["ghRemoteUrl","ghPath","ghMsgFolder","ghBranch","ghToken","ghPassphrase"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("change", () => { saveCfg(readForm()); renderSyncTimes(); });
    });
    if ($("installHelpBtn")) $("installHelpBtn").onclick = pwaStatus;
    renderSyncTimes();
    hookAutoSave();
  }

  // init after DOM ready; database.js init() runs separately
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSyncUI);
  } else {
    initSyncUI();
  }

  return { pushBackup, pullBackup, loadCfg, readForm, resolveCfg, storedCfg, passphrase, msgFolder, flushOutbox, fetchMessages, saveMessageRecord, deleteMessageRecord, migrateLocalMessages, outboxCount, notifyLocalChange, isConfiguredForSync, autoPullIfConfigured, markSync, renderSyncTimes, clearDatabaseEverywhere, nukeEverything };
})();
