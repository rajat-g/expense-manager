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

  // Delete category handlers
  $$("#categories [data-delcat]").forEach(b=>{
    b.onclick=async ()=>{
      const id=b.dataset.delcat;
      const cnt = queryOne("SELECT COUNT(*) as c FROM transactions WHERE categoryId=?", [id]).c;
      if(cnt>0){ Notify.alert("Cannot delete: category has transactions.", "error"); return; }
      if(!(await Notify.confirm("Delete this category?", { danger: true }))) return;
      exec("DELETE FROM categories WHERE id=?", [id]); 
      recordTombstone(id, "categories");
      saveDB(); 
      Notify.toast("Category deleted.", "success");
      renderCategories(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });
}
