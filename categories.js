// Category management functionality

// Render categories tables
function renderCategories(){
  // The internal Transfer category (c_transfer) stays hidden: transfers pick it automatically.
  const exp = query("SELECT * FROM categories WHERE type IN ('expense','both') AND id != 'c_transfer' ORDER BY name");
  const inc = query("SELECT * FROM categories WHERE type IN ('income','both') AND id != 'c_transfer' ORDER BY name");
  
  const render = (rows, elId) => {
    $(elId).innerHTML = rows.map(r=>`
      <tr>
        <td>${esc(r.name)} <span class="pill ${r.type==='income'?'inc':(r.type==='expense'?'exp':'')}">${esc(r.type)}</span></td>
        <td class="right">
          <button class="btn btn-ghost" data-editcat="${r.id}">Rename</button>
          <button class="btn btn-ghost" data-delcat="${r.id}">Delete</button>
        </td>
      </tr>
    `).join("");
  };
  
  render(exp, "#catExpense");
  render(inc, "#catIncome");

  // Add category handler
  $("#catAddBtn").onclick = ()=>{
    const name = $("#catName").value.trim(); 
    const type = $("#catType").value;
    if(!name) return;
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", [uuid(), name, type]);
    $("#catName").value="";
    saveDB(); 
    Notify.toast("Category added.", "success");
    renderCategories(); 
    renderTxSelectors(); 
    refreshDashboardBits();
  };

  // Edit category handlers
  $$("#categories [data-editcat]").forEach(b=>{
    b.onclick=async ()=>{
      const id=b.dataset.editcat; 
      const old = queryOne("SELECT name FROM categories WHERE id=?", [id]).name;
      const name = (await Notify.prompt("Rename category", old) || "").trim();
      if(!name) return;
      exec("UPDATE categories SET name=? WHERE id=?", [name,id]); 
      saveDB(); 
      Notify.toast("Category renamed.", "success");
      renderCategories(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });

  // Delete category handlers (moves or cascades its transactions first)
  $$("#categories [data-delcat]").forEach(b=>{
    b.onclick=async ()=>{
      const id=b.dataset.delcat;
      const row = queryOne("SELECT name, type FROM categories WHERE id=?", [id]);
      const oldName = row.name || "category";
      const ctype = row.type || "expense";
      const cnt = queryOne("SELECT COUNT(*) as c FROM transactions WHERE categoryId=?", [id]).c;
      let done = "";
      if(cnt>0){
        const others = query(
          "SELECT id,name FROM categories WHERE id != ? AND id != 'c_transfer' AND (type = ? OR type = 'both') ORDER BY name",
          [id, ctype]);
        if (!others.length) {
          if(!(await Notify.confirm(`Delete "${oldName}" and its ${cnt} transaction(s)?`, { danger: true, okText: "Delete all" }))) return;
          deleteCategoryWithTxns(id);
          done = `Category deleted with ${cnt} transaction(s).`;
        } else {
          const r = await Notify.choose(
            `Delete "${oldName}"?`,
            `${cnt} transaction(s) will move to the category you pick.`,
            others.map((c) => ({ value: c.id, label: c.name })),
            { okText: "Move", dangerText: `Delete category and ${cnt} transaction(s) instead` });
          if (!r) return;
          if (r.action === "danger") {
            deleteCategoryWithTxns(id);
            done = `Category deleted with ${cnt} transaction(s).`;
          } else {
            if (!r.value) return;
            exec("UPDATE transactions SET categoryId=? WHERE categoryId=?", [r.value, id]);
            exec("DELETE FROM categories WHERE id=?", [id]);
            recordTombstone(id, "categories");
            const toName = queryOne("SELECT name FROM categories WHERE id=?", [r.value]).name || "category";
            done = `${cnt} transaction(s) moved to ${toName}.`;
          }
        }
      } else {
        if(!(await Notify.confirm(`Delete "${oldName}"?`, { danger: true }))) return;
        exec("DELETE FROM categories WHERE id=?", [id]);
        recordTombstone(id, "categories");
        done = "Category deleted.";
      }
      saveDB();
      Notify.toast(done, "success");
      renderCategories();
      renderTxSelectors();
      refreshDashboardBits();
    };
  });
}

// Delete a category together with its transactions (each tombstoned so the
// delete propagates on next sync).
function deleteCategoryWithTxns(id){
  const rows = query("SELECT id FROM transactions WHERE categoryId=?", [id]);
  for (const r of rows) {
    exec("DELETE FROM transactions WHERE id=?", [r.id]);
    recordTombstone(r.id, "transactions");
  }
  exec("DELETE FROM categories WHERE id=?", [id]);
  recordTombstone(id, "categories");
}
