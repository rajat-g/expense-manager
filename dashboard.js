// Dashboard functionality and chart rendering
//
// Performance: totals + recents are cheap synchronous queries and paint
// immediately. The two chart cards load async (requestIdleCallback) behind
// skeleton placeholders, and the heavy ApexCharts bundle itself lazy-loads
// on first use instead of blocking the initial page render. A render token
// drops stale async work (rapid theme toggles, saves while navigating).

let monthChart = null;
let dashToken = 0;
let apexPromise = null;

// Resolve once the ApexCharts global is available (CDN, cached by the
// browser HTTP cache afterwards). Rejects offline on first load.
function ensureApex() {
  if (typeof ApexCharts !== "undefined") return Promise.resolve();
  if (!apexPromise) {
    apexPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/apexcharts";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("chart library failed to load"));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error("chart library timed out")), 15000);
    }).catch((e) => { apexPromise = null; throw e; });
  }
  return apexPromise;
}

function idleRun(fn) {
  try {
    if (typeof requestIdleCallback === "function") { requestIdleCallback(() => fn(), { timeout: 900 }); return; }
  } catch {}
  setTimeout(fn, 0);
}

function setChartSkeletons() {
  const m = document.querySelector("#monthChart");
  if (m) m.innerHTML = `<div class="skel" style="height:100%" aria-hidden="true"></div>`;
  const c = document.querySelector("#categoryChart");
  if (c && !c.innerHTML) c.innerHTML = `<div class="skel" aria-hidden="true"></div>`;
}

// Render dashboard with statistics and recent transactions
function renderDashboard(){
  // totals (transfers move between own accounts: excluded from in/out)
  const res = query("SELECT type, COALESCE(SUM(amount),0) total FROM transactions WHERE type IN ('income','expense') GROUP BY type");
  let inc=0, exp=0;
  for(const r of res){ if(r.type==="income") inc=r.total; if(r.type==="expense") exp=r.total; }
  $("#dIncome").textContent = fmt(inc);
  $("#dExpense").textContent = fmt(exp);
  $("#dNet").textContent = fmt(inc-exp);

  // recent transactions
  const recent = query(`
    SELECT t.*, a.name as acc, a2.name as toAcc, g.name as groupName, c.name as cat
    FROM transactions t
    LEFT JOIN accounts a ON a.id=t.accountId
    LEFT JOIN accounts a2 ON a2.id=t.toAccountId
    LEFT JOIN account_groups g ON a.groupId=g.id
    LEFT JOIN categories c ON c.id=t.categoryId
    ORDER BY t.date DESC, t.rowid DESC LIMIT 10
  `);
  $("#recentTx").innerHTML = recent.length
    ? txGroupsHTML(recent, false)
    : `<div class="tx-empty">No transactions yet.<br/>Tap + on the Transactions tab to add one.</div>`;
  try { if (typeof wireTxEdit === "function") wireTxEdit($("#recentTx")); } catch {}

  // Charts fill in async so totals + recents paint first.
  const token = ++dashToken;
  setChartSkeletons();
  idleRun(() => { if (token === dashToken) drawCategoryChart(); });
  idleRun(() => { if (token === dashToken) drawMonthChart(token); });
}

// Draw chart for last 6 months
async function drawMonthChart(token){
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

  const dark = (typeof isDarkTheme === "function") ? isDarkTheme() : true;
  const box = document.querySelector("#monthChart");
  if (!box) return;
  try {
    await ensureApex();
  } catch {
    box.innerHTML = `<div class="tx-empty">Chart unavailable — connect once to load charts.</div>`;
    return;
  }
  if (token !== undefined && token !== dashToken) return; // superseded
  if (typeof ApexCharts === "undefined") return;
  const shortLandscape = window.matchMedia && window.matchMedia("(orientation: landscape) and (max-height: 500px)").matches;
  const areaH = shortLandscape ? 220 : (window.innerWidth < 560 ? 260 : 320);
  const INCOME = dark ? '#a8d18f' : '#2f6b3c';
  const EXPENSE = dark ? '#f08664' : '#b3402a';
  // ApexCharts defaults to dark-on-light text: pin every text element to the
  // active theme or the legend + axes are unreadable on the dark canvas.
  const TEXT = dark ? '#edf3ff' : '#201a12';
  const MUTED = dark ? '#9db1cc' : '#6b5f4c';
  const GRID = dark ? 'rgba(157,177,204,.14)' : '#e3d9c4';
  const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif';

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
      height: areaH,
      foreColor: MUTED,
      toolbar: {
        show: false
      },
      fontFamily: FONT,
      animations: { enabled: false },
      events: {
        // Tap a month to open it in Transactions.
        dataPointSelection(e, chart, opts) {
          try {
            const idx = opts && opts.dataPointIndex;
            if (idx == null || idx < 0 || idx >= months.length) return;
            const parts = months[idx].split("-");
            txMonth = new Date(+parts[0], +parts[1] - 1, 1);
            syncTxMonthInputs();
            try { Haptics.tap("selection"); } catch {}
            applyFilters();
            goToPage("transactions");
          } catch {}
        }
      }
    },
    colors: [INCOME, EXPENSE],
    grid: {
      borderColor: GRID,
    },
    dataLabels: {
      enabled: false
    },
    stroke: {
      curve: 'smooth'
    },
    xaxis: {
      categories: months,
      labels: {
        style: { colors: MUTED }
      }
    },
    yaxis: {
      labels: {
        style: { colors: MUTED },
        formatter: (value) => { return fmt(value) }
      }
    },
    tooltip: {
      theme: dark ? 'dark' : 'light',
      x: {
        format: 'MMM yyyy'
      },
    },
    legend: {
      position: 'top',
      horizontalAlign: 'right',
      labels: {
        colors: TEXT
      }
    },
    responsive: [{
      breakpoint: 560,
      options: {
        chart: { height: shortLandscape ? 220 : 260 },
        legend: { position: 'bottom', horizontalAlign: 'center' }
      }
    }]
  };

  try {
    // Drop the skeleton placeholder first: otherwise the chart SVG renders
    // underneath it and gets clipped by the fixed-height container.
    const skel = box.querySelector(".skel");
    if (skel) skel.remove();
    if (monthChart) {
      monthChart.updateOptions(options);
    } else {
      monthChart = new ApexCharts(box, options);
      monthChart.render();
    }
  } catch {
    box.innerHTML = `<div class="tx-empty">Chart unavailable right now.</div>`;
    monthChart = null;
  }
}

function drawCategoryChart(){
    const cats = query(`
    SELECT c.id, c.name, SUM(t.amount) total
    FROM categories c
    JOIN transactions t ON t.categoryId=c.id
    WHERE t.type = 'expense'
    GROUP BY c.id
    ORDER BY total DESC
    LIMIT 8
  `);

  const box = $("#categoryChart");
  if (!box) return;
  if (!cats.length) {
    box.innerHTML = `<div class="tx-empty">No expenses yet.</div>`;
    return;
  }
  const max = Math.max(...cats.map(c => c.total || 0), 0);
  box.innerHTML = cats.map(c => `
    <div class="catbar" data-cat="${esc(c.id)}" title="Show in Transactions" role="button" tabindex="0">
      <span class="t-main"><span class="t-note">${esc(c.name)}</span></span>
      <span class="bar" role="img" aria-label="${esc(c.name)} ${fmt(c.total)}"><span style="width:${max ? Math.round((c.total || 0) / max * 100) : 0}%"></span></span>
      <span class="t-amt exp">${fmt(c.total)}</span>
    </div>
  `).join("");
  // Tap a category to open it filtered in Transactions.
  box.querySelectorAll("[data-cat]").forEach((el) => {
    if (el.dataset.catWired) return;
    el.dataset.catWired = "1";
    const open = () => {
      const sel = document.getElementById("fCategory");
      if (sel) sel.value = el.dataset.cat;
      try { Haptics.tap("selection"); } catch {}
      applyFilters();
      goToPage("transactions");
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}