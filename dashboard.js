// Dashboard functionality and chart rendering

// Render dashboard with statistics and recent transactions
function renderDashboard(){
  // totals
  const res = query("SELECT type, COALESCE(SUM(amount),0) total FROM transactions GROUP BY type");
  let inc=0, exp=0;
  for(const r of res){ if(r.type==="income") inc=r.total; if(r.type==="expense") exp=r.total; }
  $("#dIncome").textContent = fmt(inc);
  $("#dExpense").textContent = fmt(exp);
  $("#dNet").textContent = fmt(inc-exp);

  // top categories (by absolute net magnitude)
  const cats = query(`
    SELECT c.name,
           SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) income,
           SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) expense
    FROM categories c
    LEFT JOIN transactions t ON t.categoryId=c.id
    GROUP BY c.id
    ORDER BY (ABS(SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) -
                  SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END))) DESC
    LIMIT 8
  `);
  const tc = $("#topCats");
  tc.innerHTML = cats.map(c=>`
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed #eef2f7">
      <div>${esc(c.name)}</div>
      <div><span class="pill inc">+ ${fmt(c.income||0)}</span> <span class="pill exp">- ${fmt(c.expense||0)}</span></div>
    </div>
  `).join("");

  // recent transactions
  const recent = query(`
    SELECT t.*, a.name as acc, g.name as groupName, c.name as cat
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN account_groups g ON a.groupId=g.id
    LEFT JOIN categories c ON c.id=t.categoryId
    ORDER BY t.date DESC, t.rowid DESC LIMIT 10
  `);
  $("#recentTx").innerHTML = recent.map(r=>`
    <tr>
      <td>${esc(r.date||"")}</td>
      <td>${esc(r.acc||"-")} ${r.groupName ? `(${esc(r.groupName)})` : ''}</td>
      <td>${esc(r.cat||"-")}</td>
      <td><span class="pill ${r.type==='income'?'inc':'exp'}">${esc(r.type)}</span></td>
      <td>${esc(r.note||"")}</td>
      <td class="right ${r.type==='income'?'money-pos':'money-neg'}">${r.type==='income'?'+':'-'} ${fmt(r.amount||0)}</td>
    </tr>
  `).join("");
}

// Draw chart for last 6 months
function drawChart(){
  const cv = $("#monthChart");
  const ctx = cv.getContext("2d");
  ctx.clearRect(0,0,cv.width,cv.height);

  const months = [];
  const now = new Date();
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(d.toISOString().slice(0,7)); // YYYY-MM
  }

  // compute explicit date range for safety (string compare works for YYYY-MM-DD)
  const startDate = months[0] + "-01";
  const endDateDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const endDate = endDateDate.toISOString().slice(0,10);
  const rows = query(`
    SELECT substr(date,1,7) m,
           SUM(CASE WHEN type='income' THEN amount ELSE 0 END) inc,
           SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) exp
    FROM transactions
    WHERE date >= ? AND date <= ?
    GROUP BY substr(date,1,7)
  `, [startDate, endDate]);
  const map = Object.fromEntries(months.map(m=>[m,{inc:0,exp:0}]));
  for(const r of rows){ if(map[r.m]) { map[r.m].inc = r.inc||0; map[r.m].exp = r.exp||0; } }

  const pad = 32, w=cv.width, h=cv.height, innerH=h-60;
  const barW = (w-pad*2)/months.length;
  const maxVal = Math.max(1, ...months.map(m=>Math.max(map[m].inc, map[m].exp)));
  ctx.font = "12px sans-serif"; ctx.fillStyle="#111"; ctx.textAlign="center";

  months.forEach((m,i)=>{
    const x = pad + i*barW + barW/2;
    ctx.fillText(m, x, h-6);
    // income bar
    const incH = (map[m].inc/maxVal)*innerH;
    ctx.fillStyle = "#2ecc71";
    ctx.fillRect(pad + i*barW + barW*0.15, h-28-incH, barW*0.3, incH);
    // expense bar
    const expH = (map[m].exp/maxVal)*innerH;
    ctx.fillStyle = "#e74c3c";
    ctx.fillRect(pad + i*barW + barW*0.55, h-28-expH, barW*0.3, expH);
  });

  // legend
  ctx.textAlign="left"; ctx.fillStyle="#111";
  ctx.fillText("Income", pad, 14); ctx.fillStyle="#2ecc71"; ctx.fillRect(pad+60,6,10,10);
  ctx.fillStyle="#111"; ctx.fillText("Expense", pad+110, 14); ctx.fillStyle="#e74c3c"; ctx.fillRect(pad+182,6,10,10);
}
