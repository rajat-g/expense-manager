// Account management functionality

// Render account groups table
function renderAccountGroups(){
  const groups = query(`
    SELECT g.id, g.name, g.type,
           COUNT(a.id) as accountCount,
           COALESCE(SUM(
             (SELECT SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END) 
              FROM transactions t WHERE t.accountId=a.id)
           ), 0) AS totalBalance
    FROM account_groups g
    LEFT JOIN accounts a ON a.groupId = g.id
    GROUP BY g.id
    ORDER BY g.name
  `);
  
  $("#groupTable").innerHTML = groups.map(r=>`
    <tr>
      <td>${esc(r.name)}</td>
      <td><span class="pill ${r.type}">${esc(r.type)}</span></td>
      <td class="right ${r.totalBalance>=0?'money-pos':'money-neg'}">${fmt(r.totalBalance)}</td>
      <td class="right">
        <button class="btn btn-ghost" data-renamegroup="${r.id}">Rename</button>
        <button class="btn btn-ghost" data-delgroup="${r.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  // Add group handler
  $("#groupAddBtn").onclick = ()=>{
    const name = $("#groupName").value.trim();
    const type = $("#groupType").value;
    if(!name) return;
    exec("INSERT INTO account_groups(id,name,type) VALUES (?,?,?)",[uuid(),name,type]);
    $("#groupName").value="";
    saveDB(); 
    renderAccountGroups(); 
    renderAccounts(); 
    renderTxSelectors(); 
    refreshDashboardBits();
  };

  // Rename group handlers
  $$("#groupTable [data-renamegroup]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.renamegroup; 
      const old = queryOne("SELECT name FROM account_groups WHERE id=?", [id]).name;
      const name = prompt("Rename group", old);
      if(!name) return;
      exec("UPDATE account_groups SET name=? WHERE id=?", [name,id]); 
      saveDB(); 
      renderAccountGroups(); 
      renderAccounts(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });

  // Delete group handlers
  $$("#groupTable [data-delgroup]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.delgroup;
      const accCount = queryOne("SELECT COUNT(*) as c FROM accounts WHERE groupId=?", [id]).c;
      if(accCount>0){ alert("Cannot delete: group has accounts. Please move or delete accounts first."); return; }
      if(!confirm("Delete this group?")) return;
      exec("DELETE FROM account_groups WHERE id=?", [id]); 
      saveDB(); 
      renderAccountGroups(); 
      renderAccounts(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });
}

// Render accounts table with balances grouped by account groups
function renderAccounts(){
  const groups = query(`
    SELECT g.id, g.name, g.type,
           COUNT(a.id) as accountCount,
           COALESCE(SUM(
             (SELECT SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END) 
              FROM transactions t WHERE t.accountId=a.id)
           ), 0) AS totalBalance
    FROM account_groups g
    LEFT JOIN accounts a ON a.groupId = g.id
    GROUP BY g.id
    ORDER BY g.name
  `);
  
  let html = '';
  
  groups.forEach(group => {
    const accounts = query(`
      SELECT a.id, a.name,
        COALESCE((SELECT SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END) FROM transactions t WHERE t.accountId=a.id),0) AS balance
      FROM accounts a 
      WHERE a.groupId = ?
      ORDER BY a.name
    `, [group.id]);
    
    html += `
      <div class="card" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0;">${esc(group.name)} <span class="pill ${group.type}">${esc(group.type)}</span></h3>
          <div class="right ${group.totalBalance>=0?'money-pos':'money-neg'}">${fmt(group.totalBalance)}</div>
        </div>
        <table>
          <thead><tr><th>Account Name</th><th class="right">Balance</th><th></th></tr></thead>
          <tbody>
            ${accounts.map(r=>`
              <tr>
                <td>${esc(r.name)}</td>
                <td class="right ${r.balance>=0?'money-pos':'money-neg'}">${fmt(r.balance)}</td>
                <td class="right">
                  <button class="btn btn-ghost" data-rename="${r.id}">Rename</button>
                  <button class="btn btn-ghost" data-delacc="${r.id}">Delete</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="toolbar" style="margin-top: 8px;">
          <input type="text" id="accName_${group.id}" placeholder="New account name" style="flex: 1;">
          <button class="btn btn-primary" data-addacc="${group.id}">Add Account</button>
        </div>
      </div>
    `;
  });
  
  $("#accTable").innerHTML = html;

  // Add account handlers for each group
  $$("[data-addacc]").forEach(b=>{
    b.onclick = ()=>{
      const groupId = b.dataset.addacc;
      const nameInput = $(`#accName_${groupId}`);
      const name = nameInput.value.trim();
      if(!name) return;
      exec("INSERT INTO accounts(id,name,groupId) VALUES (?,?,?)",[uuid(),name,groupId]);
      nameInput.value="";
      saveDB(); 
      renderAccountGroups(); 
      renderAccounts(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });

  // Rename account handlers
  $$("#accTable [data-rename]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.rename; 
      const old = queryOne("SELECT name FROM accounts WHERE id=?", [id]).name;
      const name = prompt("Rename account", old);
      if(!name) return;
      exec("UPDATE accounts SET name=? WHERE id=?", [name,id]); 
      saveDB(); 
      renderAccountGroups(); 
      renderAccounts(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });

  // Delete account handlers
  $$("#accTable [data-delacc]").forEach(b=>{
    b.onclick=()=>{
      const id=b.dataset.delacc;
      const cnt = queryOne("SELECT COUNT(*) as c FROM transactions WHERE accountId=?", [id]).c;
      if(cnt>0){ alert("Cannot delete: account has transactions."); return; }
      if(!confirm("Delete this account?")) return;
      exec("DELETE FROM accounts WHERE id=?", [id]); 
      saveDB(); 
      renderAccountGroups(); 
      renderAccounts(); 
      renderTxSelectors(); 
      refreshDashboardBits();
    };
  });
}
