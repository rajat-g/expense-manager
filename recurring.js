// Recurring templates: monthly transactions that create themselves.
//
// Each materialized instance gets a deterministic id (rec:{template}:{YYYY-MM})
// so two devices materializing the same month never duplicate: the union
// merge dedupes by id. Deleting an instance tombstones it, so it stays gone.
// Templates themselves sync as a dims table.

let editingRecId = null;

function nextMonthKey(key) {
  const parts = String(key || "").split("-");
  let y = +parts[0], m = +parts[1];
  if (!y || !m) return "";
  m++;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

// Create every due instance up to the current month. Idempotent.
// `asOf` (YYYY-MM-DD) pins "today" — used by tests; production omits it.
function materializeDue(asOf) {
  let templates = [];
  try { templates = query("SELECT * FROM recurring WHERE COALESCE(paused,0)=0"); }
  catch { return 0; }
  const cur = (asOf || todayISO()).slice(0, 7);
  let added = 0;
  for (const t of templates) {
    if (!t || !t.id || !t.startMonth || !/^\d{4}-\d{2}$/.test(t.startMonth)) continue;
    const end = (t.endMonth && /^\d{4}-\d{2}$/.test(t.endMonth)) ? t.endMonth : cur;
    for (let m = t.startMonth; m <= cur && m <= end && m; m = nextMonthKey(m)) {
      const id = `rec:${t.id}:${m}`;
      try {
        if (queryOne("SELECT 1 as x FROM transactions WHERE id=?", [id]).x) continue;
        if (queryOne("SELECT 1 as x FROM tombstones WHERE id=?", [id]).x) continue;
        const [yy, mm] = m.split("-").map(Number);
        const last = new Date(yy, mm, 0).getDate();
        const day = !t.day ? last : Math.min(t.day, last);
        exec("INSERT OR IGNORE INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)",
          [id, `${m}-${String(day).padStart(2, "0")}`, t.accountId, t.categoryId, t.type, t.amount, t.note || ""]);
        added++;
      } catch {}
    }
  }
  if (added) saveDB();
  return added;
}

function updateRecCatOptions() {
  const type = $("#recType").value || "expense";
  const rows = query("SELECT id,name FROM categories WHERE (type=? OR type='both') AND id != 'c_transfer' ORDER BY name", [type]);
  fillSelect($("#recCategory"), rows, "id", "name");
}

// Next month this template will produce ("" when paused/ended).
function recNextRun(t) {
  if (!t || t.paused || !t.startMonth) return "";
  const cur = todayISO().slice(0, 7);
  const m = t.startMonth > cur ? t.startMonth : nextMonthKey(cur);
  if (t.endMonth && m > t.endMonth) return "";
  return m;
}

function recDayOptions() {
  let h = "";
  for (let d = 1; d <= 28; d++) h += `<option value="${d}">${d}</option>`;
  h += `<option value="0">Last day</option>`;
  return h;
}

function clearRecForm() {
  editingRecId = null;
  $("#recAmount").value = "";
  $("#recNote").value = "";
  $("#recType").value = "expense";
  $("#recDay").value = "1";
  $("#recStart").value = todayISO().slice(0, 7);
  $("#recEnd").value = "";
  updateRecCatOptions();
  $("#recFormTitle").textContent = "New template";
  $("#recCancelBtn").style.display = "none";
}

function renderRecurring() {
  const back = $("#recBackBtn");
  if (back) back.onclick = () => goToPage("transactions");
  const accs = query(`
    SELECT a.id, a.name, g.name as groupName
    FROM accounts a LEFT JOIN account_groups g ON a.groupId = g.id
    ORDER BY g.name, a.name
  `);
  fillSelect($("#recAccount"), accs.map((a) => ({ id: a.id, name: `${a.name} (${a.groupName})` })), "id", "name");
  const daySel = $("#recDay");
  if (daySel && !daySel.options.length) daySel.innerHTML = recDayOptions();
  if (!$("#recStart").value) $("#recStart").value = todayISO().slice(0, 7);
  updateRecCatOptions();

  $("#recSaveBtn").onclick = saveRecurring;
  $("#recCancelBtn").onclick = clearRecForm;
  const typeSel = $("#recType");
  if (typeSel) typeSel.onchange = updateRecCatOptions;

  const rows = query("SELECT * FROM recurring ORDER BY startMonth DESC, note");
  const box = $("#recList");
  if (!rows.length) {
    box.innerHTML = `<div class="tx-empty">No recurring templates yet.<br/>Rent, salary, subscriptions — set once, they appear monthly.</div>`;
    return;
  }
  box.innerHTML = rows.map((t) => {
    const acc = queryOne("SELECT name FROM accounts WHERE id=?", [t.accountId]).name || "?";
    const cat = queryOne("SELECT name FROM categories WHERE id=?", [t.categoryId]).name || "?";
    const next = recNextRun(t);
    const when = t.paused ? "paused" : (next ? `next: ${next}` : "ended");
    return `<div class="card" style="margin-bottom:12px">
      <div class="toolbar">
        <div>
          <div style="font-weight:700">${esc(t.note || cat)} · ${inr2(t.amount || 0)}</div>
          <div class="muted small">${t.type === "income" ? "Income" : "Expense"} · monthly on ${!t.day ? "last day" : "day " + t.day} · ${esc(acc)} · ${esc(cat)} · ${esc(when)}</div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-ghost" data-recpause="${t.id}">${t.paused ? "Resume" : "Pause"}</button>
        <button class="btn btn-ghost" data-recedit="${t.id}">Edit</button>
        <button class="btn btn-ghost" data-recdel="${t.id}">Delete</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-recpause]").forEach((b) => {
    b.onclick = () => {
      const cur = queryOne("SELECT paused FROM recurring WHERE id=?", [b.dataset.recpause]).paused;
      exec("UPDATE recurring SET paused=? WHERE id=?", [cur ? 0 : 1, b.dataset.recpause]);
      saveDB(); renderRecurring();
    };
  });
  box.querySelectorAll("[data-recedit]").forEach((b) => {
    b.onclick = () => {
      const t = queryOne("SELECT * FROM recurring WHERE id=?", [b.dataset.recedit]);
      if (!t || !t.id) return;
      editingRecId = t.id;
      $("#recAmount").value = t.amount ?? "";
      $("#recNote").value = t.note || "";
      $("#recType").value = t.type === "income" ? "income" : "expense";
      updateRecCatOptions();
      $("#recCategory").value = t.categoryId || "";
      $("#recAccount").value = t.accountId || "";
      $("#recDay").value = String(t.day ?? 1);
      $("#recStart").value = t.startMonth || "";
      $("#recEnd").value = t.endMonth || "";
      $("#recFormTitle").textContent = "Edit template";
      $("#recCancelBtn").style.display = "";
      $("#recAmount").focus();
    };
  });
  box.querySelectorAll("[data-recdel]").forEach((b) => {
    b.onclick = () => {
      if (!confirm("Delete this template? Already-created transactions stay.")) return;
      exec("DELETE FROM recurring WHERE id=?", [b.dataset.recdel]);
      recordTombstone(b.dataset.recdel, "recurring");
      saveDB(); renderRecurring();
    };
  });
}

function saveRecurring() {
  const amount = Number($("#recAmount").value || 0);
  const accountId = $("#recAccount").value;
  const type = $("#recType").value === "income" ? "income" : "expense";
  const categoryId = $("#recCategory").value;
  const note = ($("#recNote").value || "").trim();
  const day = Number($("#recDay").value || 1);
  const startMonth = $("#recStart").value || "";
  const endMonth = $("#recEnd").value || "";
  if (!accountId || !categoryId || !amount) { alert("Please fill account, category, amount"); return; }
  if (!/^\d{4}-\d{2}$/.test(startMonth)) { alert("Pick a start month"); return; }
  if (endMonth && (!/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth)) { alert("End month must be after start month"); return; }
  const cat = queryOne("SELECT type FROM categories WHERE id=?", [categoryId]);
  if (cat && !(cat.type === type || cat.type === "both")) { alert("Category does not match the chosen type."); return; }
  if (editingRecId) {
    exec("UPDATE recurring SET accountId=?, categoryId=?, type=?, amount=?, note=?, day=?, startMonth=?, endMonth=? WHERE id=?",
      [accountId, categoryId, type, amount, note, day, startMonth, endMonth || null, editingRecId]);
    editingRecId = null;
  } else {
    exec("INSERT INTO recurring(id,accountId,categoryId,type,amount,note,day,startMonth,endMonth,paused) VALUES (?,?,?,?,?,?,?,?,?,0)",
      [uuid(), accountId, categoryId, type, amount, note, day, startMonth, endMonth || null]);
  }
  saveDB();
  materializeDue();
  clearRecForm();
  renderRecurring();
  applyFilters();
  refreshDashboardBits();
}
