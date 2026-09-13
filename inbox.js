// inbox.js - SMS inbox backed by the GitHub encrypted folder.
// Messages are NEVER kept in local SQLite. New SMS waits in a temporary
// localStorage outbox until upload; the GitHub messages folder
// (<folder>/<id>.enc.json, one ciphertext file per message) is their home.
// Local SQLite keeps only accounts / categories / transactions.

const Inbox = (() => {
  const PREFS_KEY = "expense_inbox_prefs_v1";
  const OUTBOX_KEY = "expense_msg_outbox_v1";

  // Session-only cache of decrypted remote records: [{rec, sha}]. Never persisted.
  let remoteCache = [];
  let fetching = false;
  let fetchError = "";

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      return { deleteAfterConvert: !!p.deleteAfterConvert };
    } catch { return { deleteAfterConvert: false }; }
  }

  function savePrefs(p) {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ deleteAfterConvert: !!p.deleteAfterConvert }));
  }

  function notifyMsgSync() {
    try { if (typeof GhSync !== "undefined" && GhSync.notifyLocalChange) GhSync.notifyLocalChange(); } catch {}
  }

  // ---- temporary outbox (localStorage, NOT SQLite) ----
  function getOutbox() {
    try {
      const a = JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch { return []; }
  }

  function setOutbox(items) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch {}
  }

  function outboxCount() {
    return getOutbox().length;
  }

  // Queue a raw message for upload + parser snapshot. De-dupes identical
  // body+sender queued in the last 24h.
  function saveRawMessage({ body, sender = "", source = "manual", receivedAt = null }) {
    const text = String(body || "").trim();
    if (!text) throw new Error("Empty message.");
    const senderNorm = String(sender || "").trim();
    const dayAgo = Date.now() - 24 * 3600 * 1000;
    const box = getOutbox();
    const dup = box.find((o) =>
      o.body === text && (o.sender || "") === senderNorm &&
      (Date.parse(o.created_at) || 0) >= dayAgo);
    if (dup) return dup.id;
    const parsed = MsgParser.parseMessage(text, senderNorm);
    const now = new Date().toISOString();
    const item = {
      id: uuid(), body: text, sender: senderNorm,
      received_at: receivedAt || now.slice(0, 10),
      source, created_at: now, status: "pending", tx_id: null,
      parsed: {
        amount: parsed.amount ?? null, type: parsed.type || "unknown",
        merchant: parsed.merchant || "", rule: parsed.rule || "",
        confidence: parsed.confidence || "",
      },
    };
    box.push(item);
    setOutbox(box);
    notifyMsgSync();
    try { renderInbox(); } catch {}
    return item.id;
  }

  function removeFromOutbox(id) {
    setOutbox(getOutbox().filter((o) => o.id !== id));
  }

  function patchOutbox(id, patch) {
    setOutbox(getOutbox().map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  // ---- unified view: outbox items + fetched remote records ----
  function combinedItems() {
    const githubIds = new Set(remoteCache.map((c) => c.rec.id));
    // Opportunistically drop outbox items already uploaded (flush removes them
    // on success; this covers the stale-view edge without another fetch).
    const box = getOutbox().filter((o) => !githubIds.has(o.id));
    const out = box.map((o) => ({
      id: o.id, body: o.body, sender: o.sender, received_at: o.received_at,
      source: o.source, amount: o.parsed ? o.parsed.amount : null,
      type: o.parsed ? o.parsed.type : "unknown",
      merchant: o.parsed ? o.parsed.merchant : "",
      rule: o.parsed ? o.parsed.rule : "", confidence: o.parsed ? o.parsed.confidence : "",
      status: o.status || "pending", tx_id: o.tx_id || null,
      created_at: o.created_at, location: "outbox",
    }));
    for (const c of remoteCache) {
      const r = c.rec;
      out.push({
        id: r.id, body: r.body, sender: r.sender, received_at: r.received_at,
        source: r.source, amount: r.amount ?? null, type: r.type || "unknown",
        merchant: r.merchant || "", rule: r.rule || "", confidence: r.confidence || "",
        status: r.status || "pending", tx_id: r.tx_id || null,
        created_at: r.created_at, location: "github", sha: c.sha,
      });
    }
    out.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return out;
  }

  function ghReady() {
    try {
      if (typeof GhSync === "undefined") return { ok: false, reason: "sync module not loaded" };
      // Prefer the live form, fall back to stored settings (startup refresh
      // runs before the form is filled from storage).
      let cfg = GhSync.readForm();
      if ((!cfg.token || !cfg.owner) && GhSync.storedCfg) cfg = GhSync.storedCfg();
      if (!cfg.owner || !cfg.repo || !cfg.token) return { ok: false, reason: "not configured" };
      return { ok: true, cfg };
    } catch { return { ok: false, reason: "not configured" }; }
  }

  function ghPassphrase() {
    const el = document.getElementById("ghPassphrase");
    const live = (el && el.value) || "";
    if (live) return live;
    try {
      if (typeof GhSync !== "undefined" && GhSync.storedCfg) return GhSync.storedCfg().passphrase || "";
    } catch {}
    return "";
  }

  // Fetch + decrypt the whole messages folder into the session cache.
  async function refreshRemote() {
    const ready = ghReady();
    if (!ready.ok) {
      fetchError = "Set the git remote URL + token in Settings → Encrypted GitHub Backup first.";
      try { renderInbox(); } catch {}
      return [];
    }
    if (!ghPassphrase()) {
      fetchError = "Enter your encryption passphrase in Settings, then refresh.";
      try { renderInbox(); } catch {}
      return [];
    }
    fetching = true;
    fetchError = "";
    try { renderInbox(); } catch {}
    try {
      const items = await GhSync.fetchMessages(ready.cfg, ghPassphrase(), () => {
        try { renderInbox(); } catch {}
      });
      remoteCache = items;
      try { if (typeof GhSync !== "undefined" && GhSync.markSync) GhSync.markSync("pull"); } catch {}
    } catch (e) {
      fetchError = e?.message || String(e);
    }
    fetching = false;
    try { renderInbox(); } catch {}
    return remoteCache;
  }

  function setRemoteCache(items) {
    remoteCache = Array.isArray(items) ? items : [];
  }

  // Convert one inbox message into a real local transaction.
  // Default (keep dataset): the converted state is uploaded to GitHub.
  // If "delete after converting" is ON: the queued/remote copy is dropped.
  async function convertMessage(id, location, { accountId, categoryId, type, amount, date, note }) {
    const item = combinedItems().find((m) => m.id === id && m.location === location);
    if (!item) throw new Error("Message not found.");
    const amt = Number(amount);
    if (!accountId || !categoryId || !amt) throw new Error("Pick account, category and amount.");
    const t = type || (item.type !== "unknown" ? item.type : "expense");
    const cat = queryOne("SELECT type FROM categories WHERE id=?", [categoryId]);
    if (cat && !(cat.type === t || cat.type === "both")) {
      throw new Error("Category does not match the chosen type.");
    }
    const txId = uuid();
    exec(
      "INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)",
      [txId, date || todayISO(), accountId, categoryId, t, amt, note || String(item.body || "").slice(0, 140)]
    );
    saveDB();
    const prefs = loadPrefs();
    if (location === "outbox") {
      if (prefs.deleteAfterConvert) removeFromOutbox(id);
      else patchOutbox(id, { status: "converted", tx_id: txId });
      notifyMsgSync();
    } else {
      if (prefs.deleteAfterConvert) {
        await GhSync.deleteMessageRecord(id);
        remoteCache = remoteCache.filter((c) => c.rec.id !== id);
      } else {
        const cached = remoteCache.find((c) => c.rec.id === id);
        const rec = { ...(cached ? cached.rec : item), status: "converted", tx_id: txId };
        const sha = await GhSync.saveMessageRecord(rec);
        if (cached) { cached.rec = rec; cached.sha = sha; }
      }
    }
    return txId;
  }

  async function setRemoteStatus(id, location, status) {
    if (location === "outbox") {
      patchOutbox(id, { status });
      notifyMsgSync();
      return;
    }
    const cached = remoteCache.find((c) => c.rec.id === id);
    if (!cached) throw new Error("Message not found.");
    cached.rec = { ...cached.rec, status };
    cached.sha = await GhSync.saveMessageRecord(cached.rec);
  }

  async function deleteMessage(id, location) {
    if (location === "outbox") {
      removeFromOutbox(id);
      return;
    }
    await GhSync.deleteMessageRecord(id);
    remoteCache = remoteCache.filter((c) => c.rec.id !== id);
  }

  // Dataset export: remote archive + queued items, plaintext CSV for rule building.
  async function exportMessagesCsv() {
    const rows = [];
    const box = getOutbox();
    for (const o of box) {
      rows.push({
        id: o.id, created_at: o.created_at, received_at: o.received_at,
        sender: o.sender, source: (o.source || "") + " (queued)", status: o.status || "pending",
        rule: o.parsed ? o.parsed.rule : "", confidence: o.parsed ? o.parsed.confidence : "",
        amount: o.parsed ? o.parsed.amount : "", type: o.parsed ? o.parsed.type : "",
        merchant: o.parsed ? o.parsed.merchant : "", body: o.body,
      });
    }
    const ready = ghReady();
    if (ready.ok && ghPassphrase()) {
      try {
        const items = await GhSync.fetchMessages(ready.cfg, ghPassphrase());
        for (const { rec } of items) {
          if (box.some((o) => o.id === rec.id)) continue;
          rows.push({
            id: rec.id, created_at: rec.created_at, received_at: rec.received_at,
            sender: rec.sender, source: rec.source || "github", status: rec.status,
            rule: rec.rule, confidence: rec.confidence, amount: rec.amount,
            type: rec.type, merchant: rec.merchant, body: rec.body,
          });
        }
      } catch (e) { alert("Remote export failed (" + (e?.message || e) + ") — exporting queued items only."); }
    }
    rows.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const head = "id,created_at,received_at,sender,source,status,rule,confidence,parsed_amount,parsed_type,merchant,body";
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head].concat(rows.map((r) =>
      [r.id, r.created_at, r.received_at, r.sender, r.source, r.status, r.rule, r.confidence, r.amount, r.type, r.merchant, r.body].map(q).join(",")
    )).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), "messages-dataset.csv");
  }

  // --- Shortcuts intake via URL: ?inbox=1&body=...&sender=...&date=... ---
  function ingestFromQueryParams() {
    let params;
    try { params = new URLSearchParams(window.location.search); }
    catch { return null; }
    const body = params.get("body") || params.get("sms") || params.get("text") || params.get("message");
    if (!body && params.get("inbox") == null) return null;
    if (!body) return null;
    const sender = params.get("sender") || "";
    const date = params.get("date") || params.get("receivedAt") || null;
    const source = params.get("source") || "shortcut";
    let id = null;
    try {
      id = saveRawMessage({ body, sender, source, receivedAt: date });
    } catch (e) {
      console.warn("inbox ingest failed", e);
      return null;
    } finally {
      // clean the URL so refresh doesn't re-ingest
      try {
        const u = new URL(window.location.href);
        ["inbox", "body", "sms", "text", "message", "sender", "date", "receivedAt", "source"].forEach((k) => u.searchParams.delete(k));
        window.history.replaceState({}, "", u.pathname + (u.search ? "?" + u.searchParams.toString() : "") + u.hash);
      } catch {}
    }
    return id;
  }

  // Build the URL a Shortcut should open (used by Settings helper + docs).
  function buildShortcutUrl(body, sender = "") {
    const base = window.location.href.split("?")[0].split("#")[0];
    const u = new URL(base);
    u.searchParams.set("inbox", "1");
    u.searchParams.set("body", body);
    if (sender) u.searchParams.set("sender", sender);
    u.searchParams.set("source", "shortcut");
    return u.toString();
  }

  // --- rendering ---
  function accountOptions(selected = "") {
    const accs = query(`
      SELECT a.id, a.name, g.name as groupName FROM accounts a
      LEFT JOIN account_groups g ON a.groupId=g.id ORDER BY g.name, a.name`);
    return accs.map((a) =>
      `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.name)} (${esc(a.groupName || "")})</option>`).join("");
  }

  function categoryOptions(type, selected = "") {
    const t = type || "expense";
    const rows = query("SELECT id,name FROM categories WHERE type=? OR type='both' ORDER BY name", [t]);
    return rows.map((c) =>
      `<option value="${esc(c.id)}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  }

  function updateBadge() {
    const pendingOut = getOutbox().filter((o) => (o.status || "pending") === "pending").length;
    const pendingRemote = remoteCache.filter((c) => (c.rec.status || "pending") === "pending").length;
    const pending = pendingOut + pendingRemote;
    document.querySelectorAll('nav button[data-page="inbox"]').forEach((btn) => {
      const label = btn.querySelector("span");
      const text = pending > 0 ? `Inbox (${pending})` : "Inbox";
      if (label) label.textContent = text;
      else btn.textContent = text;
    });
    const pill = document.getElementById("inboxCount");
    if (pill) {
      const parts = [];
      if (pendingOut) parts.push(`${pendingOut} queued`);
      parts.push(`${remoteCache.length} on GitHub`);
      pill.textContent = parts.join(" · ") + (pending ? ` · ${pending} pending` : "");
    }
  }

  function renderInbox() {
    updateBadge();
    const wrap = document.getElementById("inboxList");
    if (!wrap) return;
    const filterEl = document.getElementById("inboxFilter");
    const status = filterEl ? filterEl.value : "pending";
    const ready = ghReady();

    let notice = "";
    if (!ready.ok) {
      notice = `<div class="card" style="margin-bottom:10px"><p class="muted" style="font-size:13px;line-height:1.5">
        GitHub sync is not configured yet — new messages wait in the outbox below and upload automatically once
        Settings → Encrypted GitHub Backup is filled in.</p></div>`;
    } else if (fetchError) {
      notice = `<div class="card" style="margin-bottom:10px"><p style="font-size:13px;color:#b42318">${esc(fetchError)}</p></div>`;
    } else if (!remoteCache.length && !fetching) {
      notice = `<div class="card" style="margin-bottom:10px"><p class="muted" style="font-size:13px">
        Inbox loads from your encrypted GitHub folder. Press Refresh to load.</p></div>`;
    }

    const msgs = combinedItems().filter((m) => status === "all" || m.status === status);
    if (!msgs.length) {
      wrap.innerHTML = notice + `<p class="muted" style="font-size:13px">No ${esc(status)} messages${fetching ? " (loading…)" : "."}</p>`;
      return;
    }
    wrap.innerHTML = notice + msgs.map((m) => {
      const defType = m.type !== "unknown" ? m.type : "expense";
      const where = m.location === "outbox" ? "queued for upload" : "on GitHub (encrypted)";
      return `
      <div class="card" style="margin-bottom:10px" data-msg="${esc(m.id)}" data-loc="${m.location}">
        <div style="font-size:13px;line-height:1.5">${esc(m.body)}</div>
        <div class="toolbar" style="margin-top:6px">
          <span class="pill ${m.type === "income" ? "inc" : m.type === "expense" ? "exp" : ""}">${esc(m.type)}${m.amount ? " · " + esc(String(m.amount)) : ""}</span>
          <span class="pill">${esc(m.rule || "no-match")} · ${esc(m.confidence || "low")}</span>
          ${m.sender ? `<span class="pill">${esc(m.sender)}</span>` : ""}
          <span class="pill">${esc(where)}</span>
          <span class="muted" style="font-size:12px">${esc(m.received_at || "")} · ${esc(m.status)}</span>
        </div>
        ${m.status === "pending" ? `
        <div class="grid-3" style="margin-top:8px">
          <div><label>Type</label><select data-f="type">
            <option value="expense" ${defType === "expense" ? "selected" : ""}>Expense</option>
            <option value="income" ${defType === "income" ? "selected" : ""}>Income</option>
          </select></div>
          <div><label>Amount</label><input type="number" step="0.01" data-f="amount" value="${m.amount ?? ""}"/></div>
          <div><label>Date</label><input type="date" data-f="date" value="${esc(m.received_at && /^\d{4}-\d{2}-\d{2}$/.test(m.received_at) ? m.received_at : todayISO())}"/></div>
          <div><label>Account (you pick)</label><select data-f="account">${accountOptions()}</select></div>
          <div><label>Category (you pick)</label><select data-f="category">${categoryOptions(defType)}</select></div>
          <div><label>Note</label><input type="text" data-f="note" value="${esc(m.merchant ? m.merchant + " · " + String(m.body || "").slice(0, 60) : String(m.body || "").slice(0, 80))}"/></div>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button class="btn btn-primary" data-act="convert">Save transaction</button>
          <button class="btn btn-ghost" data-act="ignore">Ignore</button>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-act="del">Delete message</button>
        </div>` : `
        <div class="toolbar" style="margin-top:8px">
          <button class="btn btn-ghost" data-act="reopen">Move back to pending</button>
          <div class="spacer"></div>
          <button class="btn btn-ghost" data-act="del">Delete message</button>
        </div>`}
      </div>`;
    }).join("");

    // wire per-card controls
    wrap.querySelectorAll("[data-msg]").forEach((card) => {
      const id = card.getAttribute("data-msg");
      const loc = card.getAttribute("data-loc");
      const get = (f) => card.querySelector(`[data-f="${f}"]`);
      const typeSel = get("type");
      const catSel = get("category");
      if (typeSel && catSel) {
        typeSel.onchange = () => { catSel.innerHTML = categoryOptions(typeSel.value); };
      }
      card.querySelectorAll("[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const act = btn.getAttribute("data-act");
          btn.disabled = true;
          try {
            if (act === "convert") {
              await convertMessage(id, loc, {
                accountId: get("account").value,
                categoryId: get("category").value,
                type: get("type").value,
                amount: get("amount").value,
                date: get("date").value,
                note: get("note").value,
              });
              refreshAll();
              renderInbox();
            } else if (act === "ignore") {
              if (!confirm("Mark this message as ignored? (Remote archive keeps it for your dataset.)")) { btn.disabled = false; return; }
              await setRemoteStatus(id, loc, "ignored");
              renderInbox();
            } else if (act === "reopen") {
              await setRemoteStatus(id, loc, "pending");
              renderInbox();
            } else if (act === "del") {
              if (!confirm("Delete this message permanently?")) { btn.disabled = false; return; }
              await deleteMessage(id, loc);
              renderInbox();
            }
          } catch (e) { alert(e.message || e); btn.disabled = false; }
        };
      });
    });
  }

  function initInboxUI() {
    const addBtn = document.getElementById("inboxAddBtn");
    if (addBtn) {
      addBtn.onclick = () => {
        const body = document.getElementById("inboxBody").value || "";
        const sender = document.getElementById("inboxSender").value || "";
        try {
          saveRawMessage({ body, sender, source: "manual" });
          document.getElementById("inboxBody").value = "";
          renderInbox();
        } catch (e) { alert(e.message || e); }
      };
    }
    const filterEl = document.getElementById("inboxFilter");
    if (filterEl) filterEl.onchange = renderInbox;
    const refreshBtn = document.getElementById("inboxRefreshBtn");
    if (refreshBtn) refreshBtn.onclick = () => refreshRemote();
    const expBtn = document.getElementById("inboxExportBtn");
    if (expBtn) expBtn.onclick = () => exportMessagesCsv();
    const copyBtn = document.getElementById("inboxCopyUrlBtn");
    if (copyBtn) {
      copyBtn.onclick = async () => {
        const sample = document.getElementById("inboxBody").value?.trim() || "Rs.250 debited via UPI to SWIGGY. Ref 123456.";
        const url = buildShortcutUrl(sample, document.getElementById("inboxSender").value?.trim() || "HDFCBK");
        try { await navigator.clipboard.writeText(url); alert("Sample Shortcut URL copied. Open it to test ingest."); }
        catch { prompt("Copy this URL:", url); }
      };
    }
    // settings prefs
    const delChk = document.getElementById("inboxDeleteAfter");
    if (delChk) {
      delChk.checked = loadPrefs().deleteAfterConvert;
      delChk.onchange = () => {
        savePrefs({ deleteAfterConvert: delChk.checked });
        const hint = document.getElementById("inboxDeleteHint");
        if (hint) hint.textContent = delChk.checked
          ? "ON: converting deletes the message from GitHub too."
          : "OFF (dataset mode): converted messages are kept on GitHub as converted.";
      };
      delChk.dispatchEvent(new Event("change"));
    }
    const clearBtn = document.getElementById("inboxClearConvertedBtn");
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (!confirm("Drop converted + ignored items from the local outbox? (GitHub archive is untouched.)")) return;
        setOutbox(getOutbox().filter((o) => (o.status || "pending") === "pending"));
        renderInbox();
      };
    }
  }

  return {
    loadPrefs, savePrefs, saveRawMessage, getOutbox, outboxCount,
    convertMessage, setRemoteStatus, deleteMessage, exportMessagesCsv,
    refreshRemote, setRemoteCache,
    ingestFromQueryParams, buildShortcutUrl, renderInbox, initInboxUI,
  };
})();
