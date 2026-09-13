// Database management and SQLite operations

let SQL, db;
const DB_KEY = "expenseDB_sqlite_b64";
const PAGE_KEY = "expense_current_page";
const locateSqlWasm = f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${f}`;

// Initialize the application
async function init(){
  // Drop one-time cache-buster param (see clear-cache reload in settings.js)
  try {
    const u = new URL(window.location.href);
    if (u.searchParams.has("fresh")) {
      u.searchParams.delete("fresh");
      window.history.replaceState({}, "", u.pathname + (u.search ? "?" + u.searchParams.toString() : "") + u.hash);
    }
  } catch {}
  SQL = await initSqlJs({ locateFile: locateSqlWasm });
  const saved = localStorage.getItem(DB_KEY);
  if(saved){
    let bytes;
    if (typeof Vault !== "undefined" && Vault.b64ToBytes) {
      bytes = Vault.b64ToBytes(saved);
    } else {
      bytes = Uint8Array.from(atob(saved), c=>c.charCodeAt(0));
    }
    db = new SQL.Database(bytes);
  }else{
    db = new SQL.Database();
    createSchema();
    seedDefaults();
    saveDB();
  }
  // migrate older DBs (new tables are IF NOT EXISTS)
  try { createSchema(); } catch (e) { console.warn("schema migrate failed", e); }
  // Opt-in startup sync: pulls the backup + messages only when the GitHub
  // connection is fully configured and verifies live. Runs before first render.
  try {
    if (typeof GhSync !== "undefined" && GhSync.autoPullIfConfigured) {
      await GhSync.autoPullIfConfigured();
    }
  } catch (e) { console.warn("auto-pull failed", e); }
  initNav();
  initEvents();
  initMobileNav();
  setDefaultDates();
  renderTxSelectors();
  renderAccountGroups();
  renderAccounts();
  renderCategories();
  applyFilters();
  try { if (typeof Inbox !== "undefined") { Inbox.initInboxUI(); Inbox.renderInbox(); } } catch (e) { console.warn("inbox init failed", e); }
  // Shortcuts intake (?inbox=1&body=...) takes precedence over saved page
  let shortcutId = null;
  try { if (typeof Inbox !== "undefined") shortcutId = Inbox.ingestFromQueryParams(); } catch (e) { console.warn(e); }
  try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {}
  const savedPage = shortcutId
    ? "inbox"
    : (localStorage.getItem(PAGE_KEY) || 'dashboard');
  document.querySelector(`nav button[data-page="${savedPage}"]`).click();
}

// Create database schema
function createSchema(){
  db.run(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE IF NOT EXISTS account_groups (id TEXT PRIMARY KEY, name TEXT, type TEXT);
    CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT, groupId TEXT);
    CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT, type TEXT);
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT,
      accountId TEXT,
      categoryId TEXT,
      type TEXT,
      amount REAL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(accountId);
    CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(categoryId);
    CREATE INDEX IF NOT EXISTS idx_account_group ON accounts(groupId);
    -- Deletion log for sync: deleted ids stay listed so merges on other
    -- devices drop them too (prevents deleted rows resurrecting on push).
    CREATE TABLE IF NOT EXISTS tombstones (id TEXT PRIMARY KEY, tbl TEXT, deleted_at TEXT);
  `);
}

// Messages are NOT kept in local SQLite (GitHub encrypted folder is their home,
// plus a temporary localStorage outbox until upload). Older DBs may still carry
// a raw_messages table until the user runs the one-time migration in Settings;
// fresh installs never create it.

// Seed default data
function seedDefaults(){
  const groups=[
    ["g_cash","Cash & Wallet","cash"],
    ["g_bank","Bank Accounts","bank"],
    ["g_debit","Debit Cards","debit"],
    ["g_credit","Credit Cards","credit"]
  ];
  const accs=[
    ["a_cash","Cash","g_cash"],
    ["a_bank","Main Bank Account","g_bank"],
    ["a_debit","Primary Debit Card","g_debit"],
    ["a_credit","Main Credit Card","g_credit"]
  ];
  const cats=[
    ["c_food","Food","expense"],
    ["c_transport","Transport","expense"],
    ["c_util","Utilities","expense"],
    ["c_shop","Shopping","expense"],
    ["c_ent","Entertainment","expense"],
    ["c_salary","Salary","income"],
    ["c_other","Other","both"]
  ];
  
  const insG = db.prepare("INSERT OR IGNORE INTO account_groups(id,name,type) VALUES (?,?,?)");
  for(const g of groups) insG.run(g);
  insG.free();
  
  const insA = db.prepare("INSERT OR IGNORE INTO accounts(id,name,groupId) VALUES (?,?,?)");
  for(const a of accs) insA.run(a);
  insA.free();
  
  const insC = db.prepare("INSERT OR IGNORE INTO categories(id,name,type) VALUES (?,?,?)");
  for(const c of cats) insC.run(c);
  insC.free();
}

// Save database to localStorage
function saveDB(){
  const data = db.export();
  let b64;
  if (typeof Vault !== "undefined" && Vault.bufToB64) {
    b64 = Vault.bufToB64(data);
  } else {
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < data.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, data.subarray(i, i + CHUNK));
    }
    b64 = btoa(s);
  }
  try {
    localStorage.setItem(DB_KEY, b64);
  } catch (e) {
    console.warn("localStorage full, DB not persisted:", e);
  }
}

// Database query helpers
function query(sql, params=[]){
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows=[];
  while(stmt.step()){
    const o = {}; 
    const rec = stmt.getAsObject();
    for(const k in rec) o[k]=rec[k];
    rows.push(o);
  }
  stmt.free();
  return rows;
}

function queryOne(sql,params=[]){
  const r = query(sql,params);
  return r[0] || {};
}

function exec(sql, params=[]){
  const stmt = db.prepare(sql); 
  stmt.run(params); 
  stmt.free();
}

// Log a deletion so sharded sync drops the id everywhere (not just here).
function recordTombstone(id, tbl){
  try {
    exec("INSERT OR IGNORE INTO tombstones(id, tbl, deleted_at) VALUES (?,?,?)",
      [id, tbl, new Date().toISOString()]);
  } catch (e) { console.warn("tombstone failed", e); }
}

// Snapshot every sync id (call BEFORE a wholesale replace like Clear/Import).
function snapshotSyncIds(){
  const out = new Map();
  for (const t of ["account_groups", "accounts", "categories", "transactions"]) {
    try {
      for (const r of query(`SELECT id FROM ${t}`)) {
        if (r && r.id != null && !out.has(r.id)) out.set(r.id, t);
      }
    } catch {}
  }
  return out;
}

// After a wholesale replace, tombstone every previously known id that no
// longer exists — EXCEPT ids that live again (re-seeded defaults). Without
// this the next pull-before-push merge resurrects the wiped rows from the
// backup, while manual deletes (which tombstone) stay deleted.
function tombstoneWipedIds(before){
  const live = new Set();
  for (const t of ["account_groups", "accounts", "categories", "transactions"]) {
    try {
      for (const r of query(`SELECT id FROM ${t}`)) {
        if (r && r.id != null) live.add(r.id);
      }
    } catch {}
  }
  for (const [id, tbl] of before) {
    if (!live.has(id)) recordTombstone(id, tbl);
  }
}

// Enhance nav for mobile toggle
function toggleNav(open){
  if(open===undefined){ document.body.classList.toggle('nav-open'); }
  else{
    if(open) document.body.classList.add('nav-open'); else document.body.classList.remove('nav-open');
  }
}

function initMobileNav(){
  const btn = document.getElementById('menuToggle');
  const overlay = document.getElementById('overlay');
  if(btn){ btn.onclick = ()=>toggleNav(); }
  if(overlay){ overlay.onclick = ()=>toggleNav(false); }
}

// Override initNav to also close menu on navigation (mobile)
function initNav(){
  $$("nav button").forEach(btn=>{
    btn.onclick = ()=>{
      try { if (typeof Haptics !== "undefined") Haptics.tap("selection"); } catch {}
      $$("nav button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const page = btn.dataset.page;
      document.body.dataset.page = page;
      $$(".page").forEach(p=>p.style.display="none");
      $("#"+page).style.display="block";
      if(page==="dashboard") renderDashboard();
      if(page==="inbox") { try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {} }
      // close mobile nav if open
      toggleNav(false);
      // persist selected page
      try{ localStorage.setItem(PAGE_KEY, page); }catch(e){}
    }
  });
  // Restore previously selected page
  try{
    const savedPage = localStorage.getItem(PAGE_KEY);
    if(savedPage && document.querySelector(`nav button[data-page="${savedPage}"]`)){
      $$("nav button").forEach(b=>b.classList.remove("active"));
      const btn = document.querySelector(`nav button[data-page="${savedPage}"]`);
      if(btn){
        btn.classList.add("active");
        $$(".page").forEach(p=>p.style.display="none");
        $("#"+savedPage).style.display="block";
        if(savedPage==="dashboard") renderDashboard();
      }
    }
  }catch(e){}
}

// Show any page by id (also used for pages with no nav button, like FAQ).
// Optionally jumps to + flashes an in-page anchor (details element).
function showPage(id, anchor){
  $$(".page").forEach(p=>p.style.display="none");
  const el = document.getElementById(id);
  if(!el) return;
  el.style.display="block";
  document.body.dataset.page = id;
  const navBtn = document.querySelector(`nav button[data-page="${id}"]`);
  $$("nav button").forEach(b=>b.classList.remove("active"));
  if(navBtn) navBtn.classList.add("active");
  const scroller = (window.innerWidth >= 901) ? document.querySelector("main") : null;
  if (scroller) scroller.scrollTop = 0; else window.scrollTo(0, 0);
  if (anchor) {
    const t = document.getElementById(anchor);
    if (t) {
      if (t.tagName === "DETAILS" && !t.open) t.open = true;
      setTimeout(() => {
        try { t.scrollIntoView({ block: "start" }); } catch {}
        t.classList.remove("flash");
        void t.offsetWidth;
        t.classList.add("flash");
      }, 60);
    }
  }
  try { if (navBtn) localStorage.setItem(PAGE_KEY, id); } catch(e) {}
}

// Set default dates for forms
function setDefaultDates(){
  $("#txDate").value = todayISO();
  // Filter defaults: current month (local dates)
  const d = new Date();
  $("#fFrom").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  $("#fTo").value = todayISO();
}

// Refresh all components
function refreshAll(){
  renderTxSelectors();
  renderAccountGroups();
  renderAccounts();
  renderCategories();
  applyFilters();
  try { if (typeof Inbox !== "undefined") Inbox.renderInbox(); } catch {}
}

// Refresh dashboard components
function refreshDashboardBits(){
  renderDashboard();
}
