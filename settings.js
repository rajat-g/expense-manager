// Settings, events, and utility functionality

// Initialize all event handlers
function initEvents(){
  // Add transaction
  $("#txAddBtn").onclick = addTransaction;
  $("#txClearBtn").onclick = ()=>clearTxForm();

  // Filters
  $("#applyFilters").onclick = applyFilters;
  $("#filterToggle").onclick = toggleFilterBar;

  // Dashboard hero quick actions
  const qa = $("#quickAddBtn");
  if (qa) qa.onclick = () => { try { openTxSheet(); } catch {} };
  const sn = $("#syncNowBtn");
  if (sn) sn.onclick = () => { try { if (typeof GhSync !== "undefined") GhSync.pushBackup(); } catch {} };
  const chip = $("#syncChip");
  if (chip) chip.onclick = () => {
    const btn = document.querySelector('nav button[data-page="settings"]');
    if (btn) btn.click();
  };

  // Theme: topbar + sidebar toggle, plus the explicit Dark/Light
  // segmented control in Settings. All stay in sync via updateThemeButtons.
  ["themeBtnM", "themeBtnD"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.onclick = toggleTheme;
  });
  $$("[data-theme-option]").forEach((el) => {
    el.onclick = () => applyTheme(el.getAttribute("data-theme-option"));
  });
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

  // Seed + Clear (clear tombstones the wipe so the next push deletes the rows
  // from the encrypted backup instead of pulling them back)
  $("#seedBtn").onclick = ()=>{ if(confirm("Create sample data?")) { seedSample(); saveDB(); refreshAll(); }};
  $("#clearBtn").onclick = ()=>{
    if(!confirm("Clear ALL data on this device? The empty state replaces the encrypted backup on the next push.")) return;
    const before = snapshotSyncIds();
    db = new SQL.Database(); createSchema(); seedDefaults();
    tombstoneWipedIds(before);
    saveDB(); refreshAll();
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
