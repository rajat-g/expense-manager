// Dashboard functionality and chart rendering

let monthChart = null;
let categoryChart = null;

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

  drawMonthChart();
  drawCategoryChart();
}

// Draw chart for last 6 months
function drawMonthChart(){
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
      height: 350,
      toolbar: {
        show: false
      }
    },
    colors: ['#2ecc71', '#e74c3c'],
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
    }
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

  const options = {
    series: cats.map(c => c.total),
    labels: cats.map(c => c.name),
    chart: {
      type: 'donut',
      height: 350
    },
    colors: ['#e74c3c', '#3498db', '#9b59b6', '#f1c40f', '#2ecc71', '#e67e22', '#1abc9c', '#34495e'],
    legend: {
      position: 'bottom'
    },
    responsive: [{
      breakpoint: 480,
      options: {
        chart: {
          width: 200
        },
        legend: {
          position: 'bottom'
        }
      }
    }]
  };

  if (categoryChart) {
    categoryChart.updateOptions(options);
  } else {
    categoryChart = new ApexCharts(document.querySelector("#categoryChart"), options);
    categoryChart.render();
  }
}