// Database management and SQLite operations

let SQL, db;
const DB_KEY = "expenseDB_sqlite_b64";
const PAGE_KEY = "expense_current_page";
const locateSqlWasm = f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${f}`;

// Initialize the application
async function init(){
  SQL = await initSqlJs({ locateFile: locateSqlWasm });
  const saved = localStorage.getItem(DB_KEY);
  if(saved){
    db = new SQL.Database(Uint8Array.from(atob(saved), c=>c.charCodeAt(0)));
  }else{
    db = new SQL.Database();
    createSchema();
    seedDefaults();
    saveDB();
  }
  initNav();
  initEvents();
  initMobileNav();
  setDefaultDates();
  refreshAll();
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
  `);
}

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
  const b64 = btoa(String.fromCharCode(...data));
  localStorage.setItem(DB_KEY, b64);
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
      $$("nav button").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const page = btn.dataset.page;
      $$(".page").forEach(p=>p.style.display="none");
      $("#"+page).style.display="block";
      if(page==="dashboard") drawChart();
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
        if(savedPage==="dashboard") drawChart();
      }
    }
  }catch(e){}
}

// Set default dates for forms
function setDefaultDates(){
  $("#txDate").value = todayISO();
  // Filter defaults: current month
  const d = new Date(); 
  const start = new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10);
  $("#fFrom").value = start; 
  $("#fTo").value = todayISO();
}

// Refresh all components
function refreshAll(){
  renderTxSelectors();
  renderAccountGroups();
  renderAccounts();
  renderCategories();
  applyFilters();
  renderDashboard();
  drawChart();
}

// Refresh dashboard components
function refreshDashboardBits(){
  renderDashboard();
  drawChart();
}
