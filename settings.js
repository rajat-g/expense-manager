// Settings, events, and utility functionality

// Initialize all event handlers
function initEvents(){
  // Add transaction
  $("#txAddBtn").onclick = addTransaction;
  $("#txClearBtn").onclick = ()=>clearTxForm();

  // Filters
  $("#applyFilters").onclick = () => { try { Haptics.tap("light"); } catch {} applyFilters(); };
  $("#filterToggle").onclick = () => { try { Haptics.tap("light"); } catch {} toggleFilterBar(); };

  // Dashboard hero quick actions
  const qa = $("#quickAddBtn");
  if (qa) qa.onclick = () => { try { openTxSheet(); } catch {} };
  const sn = $("#syncNowBtn");
  if (sn) sn.onclick = () => { try { if (typeof GhSync !== "undefined") GhSync.pushBackup(true); } catch {} };
  const chip = $("#syncChip");
  if (chip) chip.onclick = () => {
    try { goToPage("settings"); } catch {}
  };

  // Theme: topbar + sidebar toggle, plus the explicit Dark/Light
  // segmented control in Settings. All stay in sync via updateThemeButtons.
  ["themeBtnM", "themeBtnD"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = () => { try { Haptics.tap("light"); } catch {} toggleTheme(); };
  });
  $$("[data-theme-option]").forEach((el) => {
    el.onclick = () => { try { Haptics.tap("light"); } catch {} applyTheme(el.getAttribute("data-theme-option")); };
  });

  // FAQ: any [data-faq] button opens the FAQ page (empty value = top),
  // focused on the referenced entry when given.
  document.addEventListener("click", (e) => {
    const b = e.target && e.target.closest ? e.target.closest("[data-faq]") : null;
    if (!b || typeof showPage !== "function") return;
    showPage("faq", b.getAttribute("data-faq") || null);
  });
  const back = $("#faqBackBtn");
  if (back) back.onclick = () => showPage("settings");
  try { if (typeof Lock !== "undefined") Lock.initLockUI(); } catch {}
  try { updateThemeButtons(); } catch {}

  // CSV export
  $("#exportCsvBtn").onclick = exportTransactionsCsv;

  // DB export
  $("#exportDbBtn").onclick = ()=>{
    const data = db.export();
    const blob = new Blob([data], {type:"application/x-sqlite3"});
    downloadBlob(blob, "expenses.sqlite");
  };

  // DB import (restore point: rows missing from the file are tombstoned so the
  // next push deletes them from the backup instead of resurrecting them)
  $("#importDbBtn").onclick = ()=>$("#importDbFile").click();  $("#importDbFile").onchange = async e=>{
    const f = e.target.files[0]; if(!f) return;
    const buf = await f.arrayBuffer();
    const before = snapshotSyncIds();
    db = new SQL.Database(new Uint8Array(buf));
    // Ensure schema exists (older backups safety)
    createSchema();
    seedDefaults();
    tombstoneWipedIds(before);
    saveDB();
    refreshAll();
    e.target.value="";
    alert("Database imported.");
  };

  // Clear cached app files (service worker + caches) and reload fresh.
  // Local data is untouched: only re-downloaded code changes.
  $("#clearCacheBtn").onclick = async ()=>{
    if(!confirm("Reload fresh app files from the server? Your data stays on this device.")) return;
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch(e) { console.warn("cache clear incomplete", e); }
    // cache-busting navigation (cleaned from the URL on boot); plain reload
    // could otherwise serve the browser HTTP cache again.
    const u = new URL(window.location.href);
    u.searchParams.set("fresh", Date.now().toString(36));
    window.location.href = u.toString();
  };

  // Danger Zone: two wipe buttons (heavy lifting lives in GhSync so auto-push
  // can be suppressed while wiping; otherwise the wipe itself re-uploads).
  // Buttons disable while a wipe runs — results appear in the status line
  // right below them.
  function setDangerBusy(busy) {
    for (const btnId of ["wipeBtn", "wipeAllBtn", "delShardsBtn", "delMsgsBtn", "delGhAllBtn", "delDeviceBtn", "delBrowserBtn"]) {
      const el = document.getElementById(btnId);
      if (el) el.disabled = busy;
    }
  }
  $("#seedBtn").onclick = ()=>{ if(confirm("Create sample data?")) { seedSample(); saveDB(); refreshAll(); }};
  $("#wipeBtn").onclick = async ()=>{
    try { Haptics.tap("warning"); } catch {}
    if(!confirm("Clear the GitHub data AND this device's database? No tombstones are kept, so other devices will re-upload on next sync. Cannot be undone.")) return;
    if (typeof GhSync === "undefined" || !GhSync.clearGithubAndDevice) { alert("Sync module not ready."); return; }
    setDangerBusy(true);
    try { await GhSync.clearGithubAndDevice(); }
    finally { setDangerBusy(false); }
  };
  const ghWipe = [
    ["delShardsBtn", "Delete the monthly shards and dimensions from GitHub? This device keeps its data and will re-upload on next push.", "deleteShardBackup"],
    ["delMsgsBtn", "Delete all message files from GitHub? Pending outbox items will re-upload.", "deleteMessageBackup"],
    ["delGhAllBtn", "Delete ALL GitHub data (shards, dimensions, messages)? This device keeps its data and will re-upload on next push.", "deleteAllGithubData"],
  ];
  for (const [btnId, msg, fn] of ghWipe) {
    const el = document.getElementById(btnId);
    if (!el) continue;
    el.onclick = async () => {
      try { Haptics.tap("warning"); } catch {}
      if (!confirm(msg)) return;
      if (typeof GhSync === "undefined" || !GhSync[fn]) { alert("Sync module not ready."); return; }
      setDangerBusy(true);
      try { await GhSync[fn](); }
      finally { setDangerBusy(false); }
    };
  }
  const devDb = document.getElementById("delDeviceBtn");
  if (devDb) devDb.onclick = async () => {
    try { Haptics.tap("warning"); } catch {}
    if (!confirm("Clear this device's database? GitHub backup untouched — it syncs back on next push/pull.")) return;
    if (typeof GhSync === "undefined" || !GhSync.deleteDeviceDatabase) { alert("Sync module not ready."); return; }
    setDangerBusy(true);
    try { await GhSync.deleteDeviceDatabase(); }
    finally { setDangerBusy(false); }
  };
  const browStore = document.getElementById("delBrowserBtn");
  if (browStore) browStore.onclick = async () => {
    try { Haptics.tap("warning"); } catch {}
    if (!confirm("Clear this browser's storage (settings, token, theme, PIN, outbox) and reload? The saved database goes with it.")) return;
    if (typeof GhSync === "undefined" || !GhSync.deleteBrowserStorage) { alert("Sync module not ready."); return; }
    setDangerBusy(true);
    try { await GhSync.deleteBrowserStorage(); }
    finally { setDangerBusy(false); }
  };
  const wipeAll = $("#wipeAllBtn");
  if (wipeAll) wipeAll.onclick = async ()=>{
    try { Haptics.tap("warning"); } catch {}
    if(!confirm("Clear GitHub data, device database AND this browser's storage (settings, token, theme, PIN), then reload? Cannot be undone.")) return;
    if (typeof GhSync === "undefined" || !GhSync.clearEverything) { alert("Sync module not ready."); return; }
    setDangerBusy(true);
    try { await GhSync.clearEverything(); }
    finally { setDangerBusy(false); }
  };
}

// Seed sample data
function seedSample(){
  const accs = query("SELECT id FROM accounts");
  const cats = query("SELECT id,name,type FROM categories");
  const find = (re,t)=> (cats.find(c=>re.test(c.name) && (c.type===t||c.type==='both'))||cats[0])?.id;
  const idFood = find(/Food/i,'expense'), idTrans=find(/Transport/i,'expense'), idShop=find(/Shopping/i,'expense'), idUtil=find(/Utilities/i,'expense'), idSalary=find(/Salary/i,'income');
  const a0 = accs[0]?.id, a1=accs[1]?.id, a2=accs[2]?.id, a3=accs[3]?.id;
  const list = [
    {d:off(-2), a:a0, c:idFood, t:'expense', amt:240, note:'Lunch'},
    {d:off(-5), a:a1, c:idSalary, t:'income', amt:52000, note:'Salary'},
    {d:off(-1), a:a2, c:idTrans, t:'expense', amt:120, note:'Auto'},
    {d:off(-15), a:a3, c:idShop, t:'expense', amt:3100, note:'Shoes'},
    {d:off(-20), a:a1, c:idUtil, t:'expense', amt:1600, note:'Electricity'}
  ];
  const stmt = db.prepare("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)");
  for(const it of list){ stmt.run([uuid(), it.d, it.a, it.c, it.t, it.amt, it.note]); }
  stmt.free();
}
