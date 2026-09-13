// Utility functions used across the application

// DOM selectors
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// Date utilities (local timezone: UTC conversions shift the day for +05:30)
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ID generation
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : ('id-'+Date.now()+'-'+Math.random().toString(36).slice(2,9)));

// Formatting
const fmt = n => '₹'+ (Number(n||0)).toLocaleString(undefined,{maximumFractionDigits:2});

// HTML escaping
const esc = s => (s??'').toString().replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

// Fill select dropdown
function fillSelect(sel, rows, valueKey, labelKey){
  sel.innerHTML = rows.map(r=>`<option value="${esc(r[valueKey])}">${esc(r[labelKey])}</option>`).join("");
}

// Download blob as file
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob); 
  const a=document.createElement("a");
  a.href=url; 
  a.download=filename; 
  document.body.appendChild(a); 
  a.click(); 
  a.remove(); 
  URL.revokeObjectURL(url);
}

// Date offset helper for sample data (local, no UTC shift)
const off = n => {
  const d=new Date();
  d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Theme: explicit "dark" (default) or "light". Persisted in localStorage;
// applied pre-paint by the head script so first render never flashes.
const THEME_KEY = "expense_theme_v1";
const THEME_COLORS = { dark: "#04070c", light: "#f4efe6" };
const THEME_ICONS = {
  // Button shows the *action*: sun in dark mode (tap for light),
  // moon in light mode (tap for dark).
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/></svg>',
};
function getTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" ? "light" : "dark";
  } catch { return "dark"; }
}
// Effective dark — the app default. Charts call this (never matchMedia).
function isDarkTheme() {
  return getTheme() === "dark";
}
function syncThemeMeta(mode) {
  try {
    let m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) {
      m = document.createElement("meta");
      m.setAttribute("name", "theme-color");
      document.head.appendChild(m);
    }
    m.setAttribute("content", THEME_COLORS[mode] || THEME_COLORS.dark);
  } catch {}
}
function updateThemeButtons() {
  const mode = getTheme();
  const next = mode === "dark" ? "light" : "dark";
  ["themeBtnM", "themeBtnD"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = THEME_ICONS[mode];
    el.setAttribute("aria-label", `Switch to ${next} mode`);
    el.title = `Switch to ${next} mode`;
  });
  $$("[data-theme-option]").forEach((el) => {
    el.setAttribute("aria-pressed", String(el.getAttribute("data-theme-option") === mode));
  });
}
function applyTheme(mode) {
  const next = mode === "light" ? "light" : "dark";
  try { localStorage.setItem(THEME_KEY, next); } catch {}
  document.documentElement.setAttribute("data-theme", next);
  try { document.documentElement.style.colorScheme = next; } catch {}
  syncThemeMeta(next);
  updateThemeButtons();
  try { if (typeof renderDashboard === "function" && typeof db !== "undefined" && db) renderDashboard(); } catch {}
}
function toggleTheme() {
  applyTheme(getTheme() === "dark" ? "light" : "dark");
}
// Back-compat: the old 3-state (system/dark/light) button called this.
function cycleTheme() {
  toggleTheme();
}
