// Transaction management functionality

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
  $("#txTable").innerHTML = rows.map(r=>`
    <tr>
      <td>${esc(r.date)}</td>
      <td>${esc(r.acc||"-")} ${r.groupName ? `(${esc(r.groupName)})` : ''}</td>
      <td>${esc(r.cat||"-")}</td>
      <td><span class="pill ${r.type==='income'?'inc':'exp'}">${esc(r.type)}</span></td>
      <td>${esc(r.note||"")}</td>
      <td class="right ${r.type==='income'?'money-pos':'money-neg'}">${r.type==='income'?'+':'-'} ${fmt(r.amount||0)}</td>
      <td class="right">
        <button class="btn btn-ghost" data-del="${r.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  // delete handlers
  $$("#txTable [data-del]").forEach(b=>{
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
