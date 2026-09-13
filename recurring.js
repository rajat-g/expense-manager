// Recurring templates: monthly transactions that create themselves.
//
// Each materialized instance gets a deterministic id (rec:{template}:{YYYY-MM-DD})
// so two devices materializing the same month never duplicate: the union
// merge dedupes by id. Deleting an instance tombstones it, so it stays gone.
// Templates themselves sync as a dims table.

let editingRecId = null;

function recCadence(t) {
}
function recDateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function recStartDate(t) {
  const raw = t?.startDate;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function recEndDate(t) {
  if (!t?.endMonth || !/^\d{4}-\d{2}$/.test(t.endMonth)) return null;
  const [y, m] = t.endMonth.split("-").map(Number);
  return new Date(y, m, 0);
}
function recOccurrenceDates(t, through, from = recStartDate(t)) {
  if (!from || !through || from > through) return [];
  const end = recEndDate(t);
  const limit = end && end < through ? end : through;
  const out = [];
  const cadence = recCadence(t);
  if (cadence === "weekly") {
    for (let d = new Date(from); d <= limit; d.setDate(d.getDate() + 7)) out.push(new Date(d));
    return out;
  }
  const step = cadence === "quarterly" ? 3 : cadence === "yearly" ? 12 : 1;
  const day = Math.max(1, Number(t.day) || 1);
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= limit; d.setMonth(d.getMonth() + step)) {
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const occurrence = new Date(d.getFullYear(), d.getMonth(), Math.min(day, last));
    if (occurrence >= from && occurrence <= limit) out.push(occurrence);
  }
  return out;
}
function recOccurrenceId(t, date) { return `rec:${t.id}:${recDateISO(date)}`; }

// Create every due instance up to the current month. Idempotent.
// `asOf` (YYYY-MM-DD) pins "today" — used by tests; production omits it.
function materializeDue(asOf) {
  let templates = [];
  try { templates = query("SELECT * FROM recurring WHERE COALESCE(paused,0)=0"); }
  catch { return 0; }
  const through = new Date(asOf || todayISO());
  let added = 0;
  for (const t of templates) {
    if (!t || !t.id || !t.startMonth || !/^\d{4}-\d{2}$/.test(t.startMonth)) continue;
    for (const occurrence of recOccurrenceDates(t, through)) {
      const id = recOccurrenceId(t, occurrence);
      try {
        if (queryOne("SELECT 1 as x FROM transactions WHERE id=?", [id]).x) continue;
        if (queryOne("SELECT 1 as x FROM tombstones WHERE id=?", [id]).x) continue;
        const date = recDateISO(occurrence);
        exec("INSERT OR IGNORE INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)",
          [id, date, t.accountId, t.categoryId, t.type, t.amount, t.note || ""]);
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
  if (!t || t.paused || !recStartDate(t)) return "";
  const today = new Date(todayISO());
  const end = recEndDate(t);
  const dates = recOccurrenceDates(t, new Date(today.getFullYear() + 2, today.getMonth(), today.getDate()), recStartDate(t));
  const next = dates.find((d) => d >= today && (!end || d <= end));
  return next ? recDateISO(next) : "";
}

function recUpcoming(t, count = 6) {
  if (!t || t.paused || !recStartDate(t)) return [];
  const today = new Date(todayISO());
  const dates = recOccurrenceDates(t, new Date(today.getFullYear() + 3, today.getMonth(), today.getDate()), recStartDate(t));
  return dates.filter((d) => d >= today && !queryOne("SELECT 1 as x FROM tombstones WHERE id=?", [recOccurrenceId(t, d)]).x).slice(0, count);
}

function recMissedCount(t) {
  if (!t || t.paused || !recStartDate(t)) return 0;
  const yesterday = new Date(todayISO());
  yesterday.setDate(yesterday.getDate() - 1);
  return recOccurrenceDates(t, yesterday).filter((d) => {
    const id = recOccurrenceId(t, d);
    return !queryOne("SELECT 1 as x FROM transactions WHERE id=?", [id]).x
      && !queryOne("SELECT 1 as x FROM tombstones WHERE id=?", [id]).x;
  }).length;
}

function updateRecScheduleUI() {
  const cadence = $("#recCadence")?.value || "monthly";
  const weekly = cadence === "weekly";
  if ($("#recStartDateWrap")) $("#recStartDateWrap").style.display = weekly ? "" : "none";
  if ($("#recDay")) $("#recDay").disabled = weekly;
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
  $("#recCadence").value = "monthly";
  $("#recDay").value = "1";
  $("#recStart").value = todayISO().slice(0, 7);
  $("#recStartDate").value = todayISO();
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
  updateRecScheduleUI();

  $("#recSaveBtn").onclick = saveRecurring;
  $("#recCancelBtn").onclick = clearRecForm;
  const typeSel = $("#recType");
  if (typeSel) typeSel.onchange = updateRecCatOptions;
  const cadenceSel = $("#recCadence");
  if (cadenceSel) cadenceSel.onchange = updateRecScheduleUI;

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
    const upcoming = recUpcoming(t, 3);
    const missed = recMissedCount(t);
    const when = t.paused ? "paused" : (missed ? `${missed} overdue` : (next ? `next: ${next}` : "ended"));
    const cadence = recCadence(t);
    return `<div class="card" style="margin-bottom:12px">
      <div class="toolbar">
        <div>
          <div style="font-weight:700">${esc(t.note || cat)} · ${inr2(t.amount || 0)}</div>
          <div class="muted small">${t.type === "income" ? "Income" : "Expense"} · ${cadence} · ${cadence === "weekly" ? "every 7 days" : (!t.day ? "last day" : "day " + t.day)} · ${esc(acc)} · ${esc(cat)} · ${esc(when)}</div>
        </div>
        <div class="spacer"></div>
        <button class="btn btn-ghost" data-recpause="${t.id}">${t.paused ? "Resume" : "Pause"}</button>
        <button class="btn btn-ghost" data-recpreview="${t.id}" type="button">Preview</button>
        <button class="btn btn-ghost" data-recskip="${t.id}" type="button">Skip next</button>
        <button class="btn btn-ghost" data-recedit="${t.id}">Edit</button>
        <button class="btn btn-ghost" data-recdel="${t.id}">Delete</button>
      </div>
    </div>`;
  }).join("");

  box.querySelectorAll("[data-recpreview]").forEach((b) => {
    b.onclick = () => {
      const t = queryOne("SELECT * FROM recurring WHERE id=?", [b.dataset.recpreview]);
      const dates = recUpcoming(t, 6);
      const preview = $("#recPreview");
      preview.hidden = false;
      preview.innerHTML = `<h2>Upcoming occurrences</h2><div class="muted small">${dates.length ? dates.map((d) => `${recDateISO(d)} · ${inr2(t.amount)}`).join("<br>") : "No upcoming occurrences."}</div>`;
    };
  });
  box.querySelectorAll("[data-recskip]").forEach((b) => {
    b.onclick = () => {
      const t = queryOne("SELECT * FROM recurring WHERE id=?", [b.dataset.recskip]);
      const next = recUpcoming(t, 1)[0];
      if (!next) { Notify.toast("No upcoming occurrence to skip.", "info"); return; }
      const id = recOccurrenceId(t, next);
      recordTombstone(id, "transactions");
      exec("DELETE FROM transactions WHERE id=?", [id]);
      saveDB(); renderRecurring(); applyFilters();
      Notify.toast(`Skipped ${recDateISO(next)}.`, "success");
    };
  });

  box.querySelectorAll("[data-recpause]").forEach((b) => {
    b.onclick = () => {
      const cur = queryOne("SELECT paused FROM recurring WHERE id=?", [b.dataset.recpause]).paused;
      exec("UPDATE recurring SET paused=? WHERE id=?", [cur ? 0 : 1, b.dataset.recpause]);
      saveDB(); renderRecurring();
      Notify.toast(cur ? "Template resumed." : "Template paused.", "success");
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
      $("#recCadence").value = recCadence(t);
      updateRecCatOptions();
      $("#recCategory").value = t.categoryId || "";
      $("#recAccount").value = t.accountId || "";
      $("#recDay").value = String(t.day ?? 1);
      $("#recStart").value = t.startMonth || "";
      $("#recStartDate").value = t.startDate;
      $("#recEnd").value = t.endMonth || "";
      updateRecScheduleUI();
      $("#recFormTitle").textContent = "Edit template";
      $("#recCancelBtn").style.display = "";
      $("#recAmount").focus();
    };
  });
  box.querySelectorAll("[data-recdel]").forEach((b) => {
    b.onclick = async () => {
      if (!(await Notify.confirm("Delete this template? Already-created transactions stay.", { danger: true }))) return;
      exec("DELETE FROM recurring WHERE id=?", [b.dataset.recdel]);
      recordTombstone(b.dataset.recdel, "recurring");
      saveDB(); renderRecurring();
      Notify.toast("Template deleted.", "success");
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
  const cadence = $("#recCadence").value || "monthly";
  const startMonth = $("#recStart").value || "";
  const startDate = cadence === "weekly" ? ($("#recStartDate").value || "") : `${startMonth}-01`;
  const endMonth = $("#recEnd").value || "";
  if (!accountId || !categoryId || !amount) { Notify.alert("Please fill account, category, amount", "error"); return; }
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) { Notify.alert("Pick a valid start date or month", "error"); return; }
  if (endMonth && (!/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth)) { Notify.alert("End month must be after start month", "error"); return; }
  const cat = queryOne("SELECT type FROM categories WHERE id=?", [categoryId]);
  if (cat && !(cat.type === type || cat.type === "both")) { Notify.alert("Category does not match the chosen type.", "error"); return; }
  const wasEdit = !!editingRecId;
  if (editingRecId) {
    exec("UPDATE recurring SET accountId=?, categoryId=?, type=?, amount=?, note=?, day=?, startMonth=?, endMonth=?, cadence=?, startDate=? WHERE id=?",
      [accountId, categoryId, type, amount, note, day, startMonth, endMonth || null, cadence, startDate, editingRecId]);
    editingRecId = null;
  } else {
    exec("INSERT INTO recurring(id,accountId,categoryId,type,amount,note,day,startMonth,endMonth,paused,cadence,startDate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [uuid(), accountId, categoryId, type, amount, note, day, startMonth, endMonth || null, 0, cadence, startDate]);
  }
  saveDB();
  materializeDue();
  clearRecForm();
  renderRecurring();
  Notify.toast(wasEdit ? "Template updated." : "Template saved.", "success");
  applyFilters();
  refreshAccountViews();
  refreshDashboardBits();
}
