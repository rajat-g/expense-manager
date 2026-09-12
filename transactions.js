// Transaction management functionality

// Ledger month state + helpers (reference: dense day-grouped ledger)
let txMonth = null;
let sheetWired = false;
let filterTouched = false; // once the user toggles the bar, stop auto collapsing
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pad2 = n => String(n).padStart(2, "0");
const isoDay = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const monthEndDay = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
const inr2 = n => "₹ " + (Number(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function weekdayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
}
function txRangeTitle(from, to) {
  const m = /^(\d{4})-(\d{2})-01$/.exec(from || "");
  if (m) {
    const y = +m[1], mo = +m[2];
    if (to === isoDay(y, mo, monthEndDay(y, mo))) return `${MON[mo - 1]} ${y}`;
    // default view runs month-start → today: still that month
    const t = new Date();
    if (to === todayISO() && y === t.getFullYear() && mo === t.getMonth() + 1) {
      return `${MON[mo - 1]} ${y}`;
    }
  }
  return "Custom range";
}
function syncTxMonthInputs() {
  const y = txMonth.getFullYear(), m = txMonth.getMonth() + 1;
  $("#fFrom").value = isoDay(y, m, 1);
  $("#fTo").value = isoDay(y, m, monthEndDay(y, m));
}
function shiftTxMonth(n) {
  txMonth = new Date(txMonth.getFullYear(), txMonth.getMonth() + n, 1);
  syncTxMonthInputs();
  applyFilters();
}

// Filter bar: dot when narrowed, auto-collapse on plain full-month views
// (unless the user toggled it manually this session).
function updateFilterBar(from, to, acc, cat, type) {
  const card = document.querySelector(".filtercard");
  const dot = $("#filterDot");
  const toggle = $("#filterToggle");
  if (!card || !dot || !toggle) return;
  const narrowed = txRangeTitle(from, to) === "Custom range" || !!(acc || cat || type);
  dot.classList.toggle("on", narrowed);
  if (!filterTouched) {
    const plain = !narrowed;
    card.classList.toggle("collapsed", plain);
    toggle.setAttribute("aria-expanded", String(!plain));
  }
}
function toggleFilterBar() {
  const card = document.querySelector(".filtercard");
  const toggle = $("#filterToggle");
  if (!card || !toggle) return;
  filterTouched = true;
  const collapsed = card.classList.toggle("collapsed");
  toggle.setAttribute("aria-expanded", String(!collapsed));
}

// Bottom-sheet quick add (native iOS sheet pattern)
function openTxSheet() {
  $("#txSheet").classList.add("open");
  $("#sheetBackdrop").classList.add("open");
  setTimeout(() => { try { $("#txAmount").focus({ preventScroll: true }); } catch {} }, 280);
}
function closeTxSheet() {
  const s = $("#txSheet"), b = $("#sheetBackdrop");
  if (s) s.classList.remove("open");
  if (b) b.classList.remove("open");
}
function wireTxSheet() {
  if (sheetWired) return;
  sheetWired = true;
  $("#txFab").onclick = openTxSheet;
  $("#txSheetClose").onclick = closeTxSheet;
  $("#sheetBackdrop").onclick = closeTxSheet;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTxSheet(); });
}

// Render transaction selectors (accounts and categories)
function renderTxSelectors(){
  const accs = query(`
    SELECT a.id, a.name, g.name as groupName, g.type as groupType
    FROM accounts a
    LEFT JOIN account_groups g ON a.groupId = g.id
    ORDER BY g.name, a.name
  `);
  const cats = query("SELECT id,name,type FROM categories ORDER BY name");
  
  // Format account names with group info
  const formattedAccs = accs.map(acc => ({
    id: acc.id,
    name: `${acc.name} (${acc.groupName})`
  }));
  
  // add form
  fillSelect($("#txAccount"), formattedAccs, "id","name");
  // filter categories by current selected type for add form
  updateTxCategoryOptions();
  // filters
  fillSelect($("#fAccount"), [{id:"",name:"All"}, ...formattedAccs], "id","name");
  fillSelect($("#fCategory"), [{id:"",name:"All"}, ...cats], "id","name");

  // react to type change on add form
  const typeSel = $("#txType");
  if(typeSel){ typeSel.onchange = ()=>updateTxCategoryOptions(); }

  // ledger month pager + quick-add sheet (idempotent: renderTxSelectors re-runs)
  if(!txMonth){
    const f = $("#fFrom").value;
    const m = /^(\d{4})-(\d{2})-01$/.exec(f || "");
    txMonth = m ? new Date(+m[1], +m[2] - 1, 1) : (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  }
  $("#txPrevM").onclick = ()=>shiftTxMonth(-1);
  $("#txNextM").onclick = ()=>shiftTxMonth(1);
  $("#txMonthTitle").onclick = ()=>{ const d = new Date(); txMonth = new Date(d.getFullYear(), d.getMonth(), 1); syncTxMonthInputs(); applyFilters(); };
  wireTxSheet();
}

// Add new transaction
function addTransaction(){
  const date = $("#txDate").value || todayISO();
  const accountId = $("#txAccount").value;
  const type = $("#txType").value;
  const categoryId = $("#txCategory").value;
  const amount = Number($("#txAmount").value||0);
  const note = $("#txNote").value||"";
  if(!accountId || !categoryId || !amount){ alert("Please fill account, category, amount"); return; }
  // validate category matches selected type (or is 'both')
  const cat = queryOne("SELECT type FROM categories WHERE id=?", [categoryId]);
  if(cat && !(cat.type===type || cat.type==='both')){
    alert("Selected category does not match the chosen type.");
    return;
  }
  const id = uuid();
  const stmt = db.prepare("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)");
  stmt.run([id,date,accountId,categoryId,type,amount,note]); stmt.free();
  saveDB();
  clearTxForm(false);
  closeTxSheet();
  applyFilters();
  refreshDashboardBits();
}

// Clear transaction form
function clearTxForm(clearAll=true){
  if(clearAll){ 
    $("#txDate").value = todayISO(); 
    $("#txAccount").selectedIndex=0; 
    $("#txType").value="expense"; 
    $("#txCategory").selectedIndex=0; 
  }
  $("#txAmount").value=""; 
  $("#txNote").value="";
}

// Apply filters to transaction table
function applyFilters(){
  const from = $("#fFrom").value, to = $("#fTo").value;
  const acc = $("#fAccount").value, cat = $("#fCategory").value, type = $("#fType").value;
  let sql = `
    SELECT t.*, a.name as acc, g.name as groupName, c.name as cat
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN account_groups g ON a.groupId=g.id
    LEFT JOIN categories c ON c.id=t.categoryId
    WHERE 1=1`;
  const params = [];
  if(from){ sql += " AND t.date >= ?"; params.push(from); }
  if(to){ sql += " AND t.date <= ?"; params.push(to); }
  if(acc){ sql += " AND t.accountId = ?"; params.push(acc); }
  if(cat){ sql += " AND t.categoryId = ?"; params.push(cat); }
  if(type){ sql += " AND t.type = ?"; params.push(type); }
  sql += " ORDER BY t.date DESC, t.rowid DESC";

  const rows = query(sql, params);

  // summary strip + month title follow the same filtered range
  let sInc = 0, sExp = 0;
  for (const r of rows) { if (r.type === "income") sInc += r.amount || 0; else sExp += r.amount || 0; }
  $("#txSumInc").textContent = inr2(sInc);
  $("#txSumExp").textContent = inr2(sExp);
  $("#txSumNet").textContent = (sInc - sExp < 0 ? "-" : "") + inr2(Math.abs(sInc - sExp));
  $("#txMonthTitle").textContent = txRangeTitle(from, to);

  // dense day-grouped ledger
  const list = $("#txList");
  if (!rows.length) {
    list.innerHTML = `<div class="tx-empty">No entries in this view.<br/>Tap + to add one.</div>`;
    updateFilterBar(from, to, acc, cat, type);
    return;
  }
  let html = "";
  let cur = null, dInc = 0, dExp = 0, buf = [];
  const flushDay = () => {
    if (!cur) return;
    const dd = cur.slice(8, 10);
    const wd = weekdayOf(cur);
    html += `<div class="txday"><span class="dd">${esc(dd)}</span>`
      + `<span class="pill ${wd === "Sun" ? "exp" : ""}">${esc(wd)}</span>`
      + `<span class="spacer"></span>`
      + `<span class="day-inc">${inr2(dInc)}</span>`
      + `<span class="day-exp">${inr2(dExp)}</span></div>`;
    html += buf.join("");
  };
  for (const r of rows) {
    if (r.date !== cur) { flushDay(); cur = r.date; dInc = 0; dExp = 0; buf = []; }
    if (r.type === "income") dInc += r.amount || 0; else dExp += r.amount || 0;
    const letter = ((r.cat || r.acc || "?").trim()[0] || "?").toUpperCase();
    const sub = [r.cat || "", r.acc || ""].filter(Boolean).join(" · ");
    buf.push(`<div class="txrow">`
      + `<span class="tile" title="${esc(r.cat || "")}">${esc(letter)}</span>`
      + `<span class="t-main"><span class="t-note">${esc(r.note || r.cat || "-")}</span>`
      + `<span class="t-sub">${esc(sub)}</span></span>`
      + `<span class="t-amt ${r.type === "income" ? "inc" : "exp"}">${inr2(r.amount || 0)}</span>`
      + `<button class="txdel" data-del="${r.id}" aria-label="Delete transaction">×</button>`
      + `</div>`);
  }
  flushDay();
  list.innerHTML = html;
  updateFilterBar(from, to, acc, cat, type);

  // delete handlers
  $$("#txList [data-del]").forEach(b=>{
    b.onclick = ()=>{
      if(!confirm("Delete this transaction?")) return;
      exec("DELETE FROM transactions WHERE id=?", [b.dataset.del]);
      saveDB();
      applyFilters();
      refreshDashboardBits();
    };
  });
}

// Update add-form category options based on selected type
function updateTxCategoryOptions(){
  const type = $("#txType").value || 'expense';
  const rows = query("SELECT id,name FROM categories WHERE type=? OR type='both' ORDER BY name", [type]);
  fillSelect($("#txCategory"), rows, "id", "name");
}

// Export transactions to CSV
function exportTransactionsCsv(){
  // gather same data as applyFilters, but CSV
  const from = $("#fFrom").value, to = $("#fTo").value;
  const acc = $("#fAccount").value, cat = $("#fCategory").value, type = $("#fType").value;
  let sql = `
    SELECT t.date, a.name as account, c.name as category, t.type, t.note, t.amount
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN categories c ON c.id=t.categoryId
    WHERE 1=1`;
  const params = [];
  if(from){ sql+=" AND t.date>=?"; params.push(from); }
  if(to){ sql+=" AND t.date<=?"; params.push(to); }
  if(acc){ sql+=" AND t.accountId=?"; params.push(acc); }
  if(cat){ sql+=" AND t.categoryId=?"; params.push(cat); }
  if(type){ sql+=" AND t.type=?"; params.push(type); }
  sql += " ORDER BY t.date DESC, t.rowid DESC";
  const rows = query(sql, params);
  const csv = "Date,Account,Category,Type,Note,Amount\n" + rows.map(r=>[
    r.date, r.account, r.category, r.type, (r.note||"").replace(/"/g,'""'), r.amount
  ].map(x=>`"${x??""}"`).join(",")).join("\n");
  downloadBlob(new Blob([csv],{type:"text/csv"}), "transactions.csv");
}
