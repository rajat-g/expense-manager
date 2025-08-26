// Settings, events, and utility functionality

// Initialize all event handlers
function initEvents(){
  // Add transaction
  $("#txAddBtn").onclick = addTransaction;
  $("#txClearBtn").onclick = ()=>clearTxForm();

  // Filters
  $("#applyFilters").onclick = applyFilters;

  // CSV export
  $("#exportCsvBtn").onclick = exportTransactionsCsv;

  // DB export
  $("#exportDbBtn").onclick = ()=>{
    const data = db.export();
    const blob = new Blob([data], {type:"application/x-sqlite3"});
    downloadBlob(blob, "expenses.sqlite");
  };

  // DB import
  $("#importDbBtn").onclick = ()=>$("#importDbFile").click();
  $("#importDbFile").onchange = async e=>{
    const f = e.target.files[0]; if(!f) return;
    const buf = await f.arrayBuffer();
    db = new SQL.Database(new Uint8Array(buf));
    // Ensure schema exists (older backups safety)
    createSchema();
    saveDB();
    refreshAll();
    e.target.value="";
    alert("Database imported.");
  };

  // Seed + Clear
  $("#seedBtn").onclick = ()=>{ if(confirm("Create sample data?")) { seedSample(); saveDB(); refreshAll(); }};
  $("#clearBtn").onclick = ()=>{ if(confirm("Clear ALL data?")) { db = new SQL.Database(); createSchema(); seedDefaults(); saveDB(); refreshAll(); }};
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
