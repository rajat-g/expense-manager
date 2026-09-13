// Dashboard functionality and chart rendering

let monthChart = null;

// Render dashboard with statistics and recent transactions
function renderDashboard(){
  // totals
  const res = query("SELECT type, COALESCE(SUM(amount),0) total FROM transactions GROUP BY type");
  let inc=0, exp=0;
  for(const r of res){ if(r.type==="income") inc=r.total; if(r.type==="expense") exp=r.total; }
  $("#dIncome").textContent = fmt(inc);
  $("#dExpense").textContent = fmt(exp);
  $("#dNet").textContent = fmt(inc-exp);

  // recent transactions
  const recent = query(`
    SELECT t.*, a.name as acc, g.name as groupName, c.name as cat
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN account_groups g ON a.groupId=g.id
    LEFT JOIN categories c ON c.id=t.categoryId
    ORDER BY t.date DESC, t.rowid DESC LIMIT 10
  `);
  $("#recentTx").innerHTML = recent.length
    ? txGroupsHTML(recent, false)
    : `<div class="tx-empty">No transactions yet.<br/>Tap + on the Transactions tab to add one.</div>`;

  drawMonthChart();
  drawCategoryChart();
}

// Draw chart for last 6 months
function drawMonthChart(){
  const months = [];
  const now = new Date();
  const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  for(let i=5;i>=0;i--){
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push(ym(d)); // YYYY-MM (local, no UTC shift)
  }

  // compute explicit date range for safety (string compare works for YYYY-MM-DD)
  const startDate = months[0] + "-01";
  const endDateDate = new Date(now.getFullYear(), now.getMonth()+1, 0);
  const endDate = `${endDateDate.getFullYear()}-${String(endDateDate.getMonth() + 1).padStart(2, "0")}-${String(endDateDate.getDate()).padStart(2, "0")}`;
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

  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const INCOME = dark ? '#30d158' : '#1f9d55';
  const EXPENSE = dark ? '#ff453a' : '#d70015';
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

  const options = {
    series: [{
      name: 'Income',
      data: months.map(m => map[m].inc)
    }, {
      name: 'Expense',
      data: months.map(m => map[m].exp)
    }],
    chart: {
      type: 'area',
      height: 320,
      toolbar: {
        show: false
      },
      fontFamily: FONT,
      animations: { enabled: false },
    },
    colors: [INCOME, EXPENSE],
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: 'smooth'
    },
    xaxis: {
      categories: months,
    },
    yaxis: {
      labels: {
        formatter: (value) => { return fmt(value) }
      }
    },
    tooltip: {
      x: {
        format: 'MMM yyyy'
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right'
    },
    responsive: [{
      breakpoint: 560,
      options: {
        chart: { height: 260 },
        legend: { position: 'bottom', horizontalAlign: 'center' }
      }
    }]
  };

  if (monthChart) {
    monthChart.updateOptions(options);
  } else {
    monthChart = new ApexCharts(document.querySelector("#monthChart"), options);
    monthChart.render();
  }
}

function drawCategoryChart(){
    const cats = query(`
    SELECT c.name, SUM(t.amount) total
    FROM categories c
    JOIN transactions t ON t.categoryId=c.id
    WHERE t.type = 'expense'
    GROUP BY c.id
    ORDER BY total DESC
    LIMIT 8
  `);

  const box = $("#categoryChart");
  if (!cats.length) {
    box.innerHTML = `<div class="tx-empty">No expenses yet.</div>`;
    return;
  }
  const max = Math.max(...cats.map(c => c.total || 0), 0);
  box.innerHTML = cats.map(c => `
    <div class="catbar">
      <span class="t-main"><span class="t-note">${esc(c.name)}</span></span>
      <span class="bar" role="img" aria-label="${esc(c.name)} ${fmt(c.total)}"><span style="width:${max ? Math.round((c.total || 0) / max * 100) : 0}%"></span></span>
      <span class="t-amt exp">${fmt(c.total)}</span>
    </div>
  `).join("");
}