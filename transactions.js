// Transaction management functionality

// Ledger month state + helpers (reference: dense day-grouped ledger)
let txMonth = null;
let sheetWired = false;
let editingTxId = null; // set while the bottom sheet edits an existing row
let splitLines = null; // null = single-row mode, else [{ cat, amt }] split lines
let filterTouched = false; // once the user toggles the bar, stop auto collapsing
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pad2 = n => String(n).padStart(2, "0");
const isoDay = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const monthEndDay = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
const inr2 = n => "₹ " + (Number(n || 0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function weekdayOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  if (!m) return "";
  return WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()];
}
// Shared ledger row builders (used by the Transactions list and Dashboard recents)
function txDayHTML(dateStr, dInc, dExp) {
  const dd = dateStr.slice(8, 10);
  const wd = weekdayOf(dateStr);
  return `<div class="txday"><span class="dd">${esc(dd)}</span>`
    + `<span class="pill ${wd === "Sun" ? "exp" : ""}">${esc(wd)}</span>`
    + `<span class="spacer"></span>`
    + `<span class="day-inc">${inr2(dInc)}</span>`
    + `<span class="day-exp">${inr2(dExp)}</span></div>`;
}

function txRowHTML(r, withDelete) {
  const letter = ((r.cat || r.acc || "?").trim()[0] || "?").toUpperCase();
  const isXfer = r.type === "transfer";
  const sub = isXfer
    ? `${r.acc || ""} → ${r.toAcc || ""}`
    : [r.cat || "", r.acc || ""].filter(Boolean).join(" · ");
  const splitPill = r.splitId ? ` <span class="pill split">split</span>` : "";
  return `<div class="txrow" data-edit="${esc(r.id)}" tabindex="0" role="button" aria-label="Edit transaction ${esc(r.note || r.cat || "")} ${inr2(r.amount || 0)}">`
    + `<span class="tile" title="${esc(isXfer ? "Transfer" : (r.cat || ""))}">${isXfer ? "⇄" : esc(letter)}</span>`
    + `<span class="t-main"><span class="t-note">${esc(r.note || (isXfer ? "Transfer" : (r.cat || "-")))}</span>`
    + `<span class="t-sub">${esc(sub)}${splitPill}</span></span>`
    + `<span class="t-amt ${r.type === "income" ? "inc" : r.type === "expense" ? "exp" : ""}">${inr2(r.amount || 0)}</span>`
    + (withDelete ? `<button class="txdel" data-del="${r.id}" aria-label="Delete transaction">×</button>` : "")
    + `</div>`;
}

// Group already-sorted rows (date DESC) into day-grouped ledger HTML
function txGroupsHTML(rows, withDelete) {
  let html = "";
  let cur = null, dInc = 0, dExp = 0, buf = [];
  const flushDay = () => {
    if (!cur) return;
    html += `<div class="daycard">` + txDayHTML(cur, dInc, dExp) + buf.join("") + `</div>`;
  };
  for (const r of rows) {
    if (r.date !== cur) { flushDay(); cur = r.date; dInc = 0; dExp = 0; buf = []; }
    if (r.type === "income") dInc += r.amount || 0; else dExp += r.amount || 0;
    buf.push(txRowHTML(r, withDelete));
  }
  flushDay();
  return html;
}

function txRangeTitle(from, to) {  const m = /^(\d{4})-(\d{2})-01$/.exec(from || "");
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
  try { Haptics.tap("selection"); } catch {}
  syncTxMonthInputs();
  applyFilters();
}

// Filter bar: dot when narrowed, auto-collapse on plain full-month views
// (unless the user toggled it manually this session).
function updateFilterBar(from, to, acc, cat, type, q) {
  const card = document.querySelector(".filtercard");
  const dot = $("#filterDot");
  const toggle = $("#filterToggle");
  if (!card || !dot || !toggle) return;
  const narrowed = txRangeTitle(from, to) === "Custom range" || !!(acc || cat || type || q);
  dot.classList.toggle("on", narrowed);
  // Desktop shows the filter panel expanded; only phones auto-collapse it.
  const desktop = window.matchMedia && window.matchMedia("(min-width: 901px)").matches;
  if (!filterTouched && !desktop) {
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

// Bottom-sheet quick add (native iOS sheet pattern). Doubles as the editor:
// openTxEdit(id) pre-fills the same form and flips the sheet into edit mode.
function setSheetMode() {
  const editing = !!editingTxId;
  const title = $("#txSheetTitle");
  if (title) title.textContent = editing ? "Edit Transaction" : "Add Transaction";
  const save = $("#txAddBtn");
  if (save) save.textContent = editing ? "Save" : "Add";
  const clear = $("#txClearBtn");
  if (clear) clear.style.display = editing ? "none" : "";
  const sheet = $("#txSheet");
  if (sheet) sheet.setAttribute("aria-label", editing ? "Edit transaction" : "Add transaction");
}
function openTxSheet() {
  editingTxId = null;
  setSplitMode(false);
  $("#txSplitHint").style.display = "none";
  setSheetMode();
  try { Haptics.tap("medium"); } catch {}
  $("#txSheet").classList.add("open");
  $("#sheetBackdrop").classList.add("open");
  document.body.classList.add("sheet-open");
  setTimeout(() => { try { $("#txAmount").focus({ preventScroll: true }); } catch {} }, 280);
}
function openTxEdit(id) {
  const r = queryOne("SELECT * FROM transactions WHERE id=?", [id]);
  if (!r || !r.id) return;
  editingTxId = r.id;
  setSplitMode(false);
  $("#txDate").value = r.date || todayISO();
  $("#txType").value = r.type === "income" ? "income" : r.type === "transfer" ? "transfer" : "expense";
  updateSheetTypeUI();
  // account / category may have been deleted since: fall back to first option
  const accSel = $("#txAccount"), catSel = $("#txCategory");
  accSel.value = r.accountId || "";
  if (!accSel.value && accSel.options.length) accSel.selectedIndex = 0;
  if (r.type === "transfer") {
    $("#txToAccount").value = r.toAccountId || "";
  } else {
    catSel.value = r.categoryId || "";
    if (!catSel.value && catSel.options.length) catSel.selectedIndex = 0;
  }
  $("#txAmount").value = r.amount ?? "";
  $("#txNote").value = r.note || "";
  $("#txSplitHint").style.display = r.splitId ? "" : "none";
  setSheetMode();
  try { Haptics.tap("medium"); } catch {}
  $("#txSheet").classList.add("open");
  $("#sheetBackdrop").classList.add("open");
  document.body.classList.add("sheet-open");
  setTimeout(() => { try { $("#txAmount").focus({ preventScroll: true }); } catch {} }, 280);
}
// ---- Split mode: one payment across several categories ----
function setSplitMode(on) {
  splitLines = on ? (splitLines && splitLines.length ? splitLines : [{ cat: "", amt: "" }, { cat: "", amt: "" }]) : null;
  $("#txSplitWrap").style.display = on ? "" : "none";
  $("#txAmount").disabled = !!on;
  const btn = $("#txSplitBtn");
  if (btn) btn.textContent = on ? "Unsplit" : "Split";
  if (on) renderSplitLines();
  else updateSplitTotal();
}
function renderSplitLines() {
  const box = $("#txSplitLines");
  const type = $("#txType").value || "expense";
  const opts = txCatOptionsFor(type);
  box.innerHTML = splitLines.map((ln, i) => `
    <div class="split-line" data-i="${i}">
      <select data-splitcat aria-label="Split category ${i + 1}">
        <option value="">Category…</option>
        ${opts.map(o => `<option value="${esc(o.id)}"${o.id === ln.cat ? " selected" : ""}>${esc(o.name)}</option>`).join("")}
      </select>
      <input type="number" data-splitamt step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(ln.amt)}" aria-label="Split amount ${i + 1}">
      <button type="button" class="txdel" data-splitdel="${i}" aria-label="Remove split line">×</button>
    </div>`).join("");
  box.querySelectorAll("[data-splitcat]").forEach(sel => {
    sel.onchange = () => { splitLines[+sel.closest(".split-line").dataset.i].cat = sel.value; };
  });
  box.querySelectorAll("[data-splitamt]").forEach(inp => {
    inp.oninput = () => { splitLines[+inp.closest(".split-line").dataset.i].amt = inp.value; updateSplitTotal(); };
  });
  box.querySelectorAll("[data-splitdel]").forEach(b => {
    b.onclick = () => {
      splitLines.splice(+b.dataset.splitdel, 1);
      if (splitLines.length < 2) setSplitMode(false);
      else renderSplitLines();
    };
  });
  updateSplitTotal();
}
function updateSplitTotal() {
  const total = (splitLines || []).reduce((s, ln) => s + (Number(ln.amt) || 0), 0);
  $("#txAmount").value = total ? String(Math.round(total * 100) / 100) : "";
}
function wireTxEdit(scope) {
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  scope.querySelectorAll("[data-edit]").forEach((row) => {
    if (row.dataset.editWired) return;
    row.dataset.editWired = "1";
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-del]")) return;
      openTxEdit(row.dataset.edit);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTxEdit(row.dataset.edit); }
    });
  });
}
function closeTxSheet() {
  const s = $("#txSheet"), b = $("#sheetBackdrop");
  if (s) s.classList.remove("open");
  if (b) b.classList.remove("open");
  document.body.classList.remove("sheet-open");
}
function wireTxSheet() {
  if (sheetWired) return;
  sheetWired = true;
  $("#txFab").onclick = openTxSheet;
  $("#txSheetClose").onclick = closeTxSheet;
  const x = $("#txSheetX");
  if (x) x.onclick = closeTxSheet;
  $("#sheetBackdrop").onclick = closeTxSheet;
  const splitBtn = $("#txSplitBtn");
  if (splitBtn && !splitBtn.dataset.wired) {
    splitBtn.dataset.wired = "1";
    splitBtn.onclick = () => setSplitMode(!splitLines);
  }
  const splitAdd = $("#txSplitAdd");
  if (splitAdd && !splitAdd.dataset.wired) {
    splitAdd.dataset.wired = "1";
    splitAdd.onclick = () => { splitLines.push({ cat: "", amt: "" }); renderSplitLines(); };
  }
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
  const cats = query("SELECT id,name,type FROM categories WHERE id != 'c_transfer' ORDER BY name");
  
  // Format account names with group info
  const formattedAccs = accs.map(acc => ({
    id: acc.id,
    name: `${acc.name} (${acc.groupName})`
  }));
  
  // add form
  fillSelect($("#txAccount"), formattedAccs, "id","name");
  fillSelect($("#txToAccount"), formattedAccs, "id","name");
  // filter categories by current selected type for add form
  updateSheetTypeUI();
  // filters
  fillSelect($("#fAccount"), [{id:"",name:"All"}, ...formattedAccs], "id","name");
  fillSelect($("#fCategory"), [{id:"",name:"All"}, ...cats], "id","name");

  // react to type change on add form
  const typeSel = $("#txType");
  if(typeSel){ typeSel.onchange = ()=>updateSheetTypeUI(); }

  // global search across the ledger (debounced)
  const searchEl = $("#txSearch");
  if (searchEl && !searchEl.dataset.wired) {
    searchEl.dataset.wired = "1";
    let deb = null;
    searchEl.addEventListener("input", () => {
      clearTimeout(deb);
      deb = setTimeout(() => applyFilters(), 300);
    });
  }

  // recurring templates live on their own page (opened from the filter bar)
  const recBtn = $("#recurringBtn");
  if (recBtn) recBtn.onclick = () => goToPage("recurring");

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

// Save the sheet form: INSERT in add mode, UPDATE in edit mode.
// Transfer and split rows are handled as variants of the same form.
function addTransaction(){
  const date = $("#txDate").value || todayISO();
  const accountId = $("#txAccount").value;
  const type = $("#txType").value;
  const note = $("#txNote").value||"";
  const fail = (msg) => { try { Haptics.tap("error"); } catch {} Notify.alert(msg, "error"); };

  // Transfers move money between own accounts (never income/expense).
  if (type === "transfer") {
    const toAccountId = $("#txToAccount").value;
    const amount = Number($("#txAmount").value||0);
    if (!accountId || !toAccountId || !amount) { fail("Please fill from-account, to-account, amount"); return; }
    if (accountId === toAccountId) { fail("From and To accounts must differ."); return; }
    const wasEdit = !!editingTxId;
    if (editingTxId) {
      exec("UPDATE transactions SET date=?, accountId=?, categoryId='c_transfer', type='transfer', amount=?, note=?, toAccountId=? WHERE id=?",
        [date, accountId, amount, note, toAccountId, editingTxId]);
      editingTxId = null;
    } else {
      exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note,toAccountId) VALUES (?,?,?,?,?,?,?,?)",
        [uuid(), date, accountId, "c_transfer", type, amount, note, toAccountId]);
    }
    return afterTxSave(wasEdit ? "Transfer updated." : "Transfer added.");
  }

  // Splits fan one payment out across several categories.
  if (splitLines) {
    if (editingTxId) { fail("Split parts are edited one by one."); return; }
    const lines = splitLines
      .map((ln) => ({ cat: ln.cat, amt: Number(ln.amt) || 0 }))
      .filter((ln) => ln.cat && ln.amt > 0);
    if (lines.length < 2) { fail("A split needs at least two filled lines."); return; }
    const sid = uuid();
    const stmt = db.prepare("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note,splitId) VALUES (?,?,?,?,?,?,?,?)");
    for (const ln of lines) {
      const cat = queryOne("SELECT type FROM categories WHERE id=?", [ln.cat]);
      if (cat && !(cat.type===type || cat.type==='both')) { stmt.free(); fail("A split line uses a category of the wrong type."); return; }
      stmt.run([uuid(), date, accountId, ln.cat, type, ln.amt, note, sid]);
    }
    stmt.free();
    return afterTxSave("Split added.");
  }

  const categoryId = $("#txCategory").value;
  const amount = Number($("#txAmount").value||0);
  if(!accountId || !categoryId || !amount){ fail("Please fill account, category, amount"); return; }
  // validate category matches selected type (or is 'both')
  const cat = queryOne("SELECT type FROM categories WHERE id=?", [categoryId]);
  if(cat && !(cat.type===type || cat.type==='both')){
    fail("Selected category does not match the chosen type.");
    return;
  }
  if (editingTxId) {
    exec("UPDATE transactions SET date=?, accountId=?, categoryId=?, type=?, amount=?, note=?, toAccountId=NULL WHERE id=?",
      [date, accountId, categoryId, type, amount, note, editingTxId]);
    editingTxId = null;
    afterTxSave("Transaction updated.");
  } else {
    const id = uuid();
    const stmt = db.prepare("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)");
    stmt.run([id,date,accountId,categoryId,type,amount,note]); stmt.free();
    afterTxSave("Transaction added.");
  }
}

// Shared post-save: persist, reset the sheet, refresh every surface.
function afterTxSave(label){
  saveDB();
  setSheetMode();
  clearTxForm(false);
  closeTxSheet();
  try { Haptics.tap("success"); } catch {}
  Notify.toast(label || "Saved.", "success");
  applyFilters();
  refreshDashboardBits();
}

// Clear transaction form
function clearTxForm(clearAll=true){
  if (splitLines) setSplitMode(false);
  $("#txAmount").disabled = false;
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
  const q = ($("#txSearch").value || "").trim();
  let sql = `
    SELECT t.*, a.name as acc, a2.name as toAcc, g.name as groupName, c.name as cat
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN accounts a2 ON a2.id=t.toAccountId
    LEFT JOIN account_groups g ON a.groupId=g.id
    LEFT JOIN categories c ON c.id=t.categoryId
    WHERE 1=1`;
  const params = [];
  if(from){ sql += " AND t.date >= ?"; params.push(from); }
  if(to){ sql += " AND t.date <= ?"; params.push(to); }
  if(acc){ sql += " AND (t.accountId = ? OR t.toAccountId = ?)"; params.push(acc, acc); }
  if(cat){ sql += " AND t.categoryId = ?"; params.push(cat); }
  if(type){ sql += " AND t.type = ?"; params.push(type); }
  if(q){
    const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    sql += " AND (t.note LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a2.name LIKE ? ESCAPE '\\' OR CAST(t.amount AS TEXT) LIKE ?)";
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY t.date DESC, t.rowid DESC";

  const rows = query(sql, params);

  // summary strip + month title follow the same filtered range
  // (transfers move money between own accounts: excluded from in/out)
  let sInc = 0, sExp = 0;
  for (const r of rows) { if (r.type === "income") sInc += r.amount || 0; else if (r.type === "expense") sExp += r.amount || 0; }
  $("#txSumInc").textContent = inr2(sInc);
  $("#txSumExp").textContent = inr2(sExp);
  $("#txSumNet").textContent = (sInc - sExp < 0 ? "-" : "") + inr2(Math.abs(sInc - sExp));
  $("#txMonthTitle").textContent = txRangeTitle(from, to);

  // dense day-grouped ledger
  const list = $("#txList");
  if (!rows.length) {
    list.innerHTML = `<div class="tx-empty">No entries in this view.<br/>Tap + to add one.</div>`;
    updateFilterBar(from, to, acc, cat, type, q);
    return;
  }
  list.innerHTML = txGroupsHTML(rows, true);
  updateFilterBar(from, to, acc, cat, type, q);

  // delete handlers
  $$("#txList [data-del]").forEach(b=>{
    b.onclick = async (e)=>{
      try { Haptics.tap("warning"); } catch {}
      if(!(await Notify.confirm("Delete this transaction?", { danger: true }))) return;
      e.stopPropagation();
      exec("DELETE FROM transactions WHERE id=?", [b.dataset.del]);
      recordTombstone(b.dataset.del, "transactions");
      saveDB();
      try { Haptics.tap("success"); } catch {}
      Notify.toast("Transaction deleted.", "success");
      applyFilters();
      refreshDashboardBits();
    };
  });
  // edit handlers (row tap / Enter)
  wireTxEdit(list);
}

// Category options for the sheet form (internal Transfer category excluded;
// transfers lock to it automatically).
function txCatOptionsFor(type) {
  if (type === "transfer") return [{ id: "c_transfer", name: "Transfer" }];
  return query("SELECT id,name FROM categories WHERE (type=? OR type='both') AND id != 'c_transfer' ORDER BY name", [type]);
}

// Show/hide the transfer + split sheet chrome for the chosen type.
function updateSheetTypeUI(){
  const type = $("#txType").value || "expense";
  const isXfer = type === "transfer";
  $("#txToWrap").style.display = isXfer ? "" : "none";
  $("#txCatWrap").style.display = isXfer ? "none" : "";
  $("#txFromLabel").textContent = isXfer ? "From account" : "Account";
  $("#txSplitBtn").style.display = (isXfer || editingTxId) ? "none" : "";
  if (isXfer) setSplitMode(false);
  updateTxCategoryOptions();
}

// Update add-form category options based on selected type
function updateTxCategoryOptions(){
  const type = $("#txType").value || 'expense';
  fillSelect($("#txCategory"), txCatOptionsFor(type), "id", "name");
  if (splitLines) renderSplitLines();
}

// Export transactions to CSV
function exportTransactionsCsv(){
  // gather same data as applyFilters, but CSV
  const from = $("#fFrom").value, to = $("#fTo").value;
  const acc = $("#fAccount").value, cat = $("#fCategory").value, type = $("#fType").value;
  const q = ($("#txSearch").value || "").trim();
  let sql = `
    SELECT t.date, a.name as account, a2.name as toAccount, c.name as category, t.type, t.note, t.amount, t.splitId
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN accounts a2 ON a2.id=t.toAccountId
    LEFT JOIN categories c ON c.id=t.categoryId
    WHERE 1=1`;
  const params = [];
  if(from){ sql+=" AND t.date>=?"; params.push(from); }
  if(to){ sql+=" AND t.date<=?"; params.push(to); }
  if(acc){ sql+=" AND (t.accountId=? OR t.toAccountId=?)"; params.push(acc, acc); }
  if(cat){ sql+=" AND t.categoryId=?"; params.push(cat); }
  if(type){ sql+=" AND t.type=?"; params.push(type); }
  if(q){
    const like = "%" + q.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
    sql += " AND (t.note LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR a2.name LIKE ? ESCAPE '\\' OR CAST(t.amount AS TEXT) LIKE ?)";
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY t.date DESC, t.rowid DESC";
  const rows = query(sql, params);
  const csv = "Date,Account,ToAccount,Category,Type,Note,Amount,SplitId\n" + rows.map(r=>[
    r.date, r.account, r.toAccount, r.category, r.type, (r.note||"").replace(/"/g,'""'), r.amount, r.splitId
  ].map(x=>`"${x??""}"`).join(",")).join("\n");
  downloadBlob(new Blob([csv],{type:"text/csv"}), "transactions.csv");
  Notify.toast("Exported transactions CSV.", "success");
}
