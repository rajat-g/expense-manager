// App lock: optional PIN gate on launch + after 10 minutes away.
//
// The PIN is never stored: only a PBKDF2-SHA256 hash (100k iterations,
// random salt) lives in localStorage. Unlock cost (~0.3s) happens once per
// session. This stops casual snooping; it is not a vault (the ledger itself
// stays encrypted separately by your backup passphrase).
const Lock = (() => {
  const KEY = "expense_pin_v1";
  // Last active moment, persisted so a plain reload/refresh (same browser,
  // seconds later) does NOT lock — only real absence does.
  const ACTIVE_KEY = "expense_lock_active_v1";
  const ITER = 100000;
  const MAX_FAILS = 5;
  const COOLDOWN_MS = 30000;
  const AWAY_MS = 10 * 60 * 1000;
  let fails = 0, lockedUntil = 0;

  const b64 = (buf) => {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function hashPin(pin, saltBytes) {
    if (!crypto.subtle) throw new Error("App lock needs https or localhost.");
    const base = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode("expenselock:" + pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: ITER, hash: "SHA-256" }, base, 256);
    return b64(bits);
  }

  function readRec() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || "null");
      return (r && r.salt && r.hash) ? r : null;
    } catch { return null; }
  }

  function isSet() { return !!readRec(); }
  function validPin(pin) { return /^\d{4,8}$/.test(pin || ""); }

  function touchActive() {
    try { localStorage.setItem(ACTIVE_KEY, String(Date.now())); } catch {}
  }

  // True when the user has been away long enough to require the PIN
  // (or no activity was ever recorded: lock by default).
  function isStale() {
    try {
      const t = Number(localStorage.getItem(ACTIVE_KEY) || 0);
      return !(t > 0) || (Date.now() - t > AWAY_MS);
    } catch { return true; }
  }

  async function setPin(pin) {
    if (!validPin(pin)) throw new Error("PIN must be 4–8 digits.");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const rec = { salt: b64(salt), hash: await hashPin(pin, salt), iter: ITER };
    try { localStorage.setItem(KEY, JSON.stringify(rec)); }
    catch { throw new Error("Could not save PIN (storage full?)."); }
    touchActive();
  }

  function removePin() {
    try { localStorage.removeItem(KEY); } catch {}
  }

  // Constant-time compare; cooldown after repeated failures.
  async function verify(pin) {
    if (Date.now() < lockedUntil) {
      const s = Math.ceil((lockedUntil - Date.now()) / 1000);
      throw new Error(`Too many tries. Wait ${s}s.`);
    }
    const rec = readRec();
    if (!rec) return true;
    let ok = false;
    try {
      const h = await hashPin(pin || "", unb64(rec.salt));
      const a = h, b = rec.hash;
      ok = a.length === b.length;
      for (let i = 0; ok && i < a.length; i++) { if (a[i] !== b[i]) ok = false; }
    } catch { ok = false; }
    if (ok) { fails = 0; lockedUntil = 0; return true; }
    fails++;
    if (fails >= MAX_FAILS) { lockedUntil = Date.now() + COOLDOWN_MS; fails = 0; }
    return false;
  }

  function show() {
    const s = document.getElementById("lockScreen");
    if (!s) return;
    s.style.display = "flex";
    const err = document.getElementById("lockErr");
    if (err) err.textContent = "";
    paintDots();
    setTimeout(() => { try { document.getElementById("lockPin").focus({ preventScroll: true }); } catch {} }, 350);
  }

  function hide() {
    const s = document.getElementById("lockScreen");
    if (s) s.style.display = "none";
    const pin = document.getElementById("lockPin");
    if (pin) pin.value = "";
    touchActive();
    paintDots();
  }

  function paintDots() {
    const d = document.getElementById("lockDots");
    const pin = document.getElementById("lockPin");
    if (!d) return;
    const n = Math.min((pin && pin.value ? pin.value.length : 0), 8);
    d.textContent = "●".repeat(n) + "○".repeat(Math.max(0, 4 - n));
  }

  async function attemptUnlock() {
    const pin = (document.getElementById("lockPin") || {}).value || "";
    const err = document.getElementById("lockErr");
    try {
      if (await verify(pin)) {
        try { Haptics.tap("success"); } catch {}
        hide();
      } else {
        try { Haptics.tap("error"); } catch {}
        if (err) err.textContent = "Wrong PIN. Try again.";
        const p = document.getElementById("lockPin");
        if (p) { p.value = ""; p.focus(); }
        paintDots();
      }
    } catch (e) {
      if (err) err.textContent = e?.message || "Locked. Try again.";
    }
  }

  function wireLockScreen() {
    const pin = document.getElementById("lockPin");
    if (pin) {
      pin.addEventListener("input", paintDots);
      pin.addEventListener("keydown", (e) => { if (e.key === "Enter") attemptUnlock(); });
    }
    const go = document.getElementById("lockGoBtn");
    if (go) go.onclick = attemptUnlock;
  }

  // Settings card: set / change / remove PIN + lock now.
  function initLockUI() {
    const msg = (t) => { const el = document.getElementById("lockMsg"); if (el) el.textContent = t || ""; };
    const curWrap = document.getElementById("lockCurWrap");
    if (curWrap) curWrap.style.display = isSet() ? "" : "none";
    const save = document.getElementById("lockSaveBtn");
    if (save) save.onclick = async () => {
      const cur = (document.getElementById("lockCur") || {}).value || "";
      const nw = (document.getElementById("lockNew") || {}).value || "";
      const cf = (document.getElementById("lockConfirm") || {}).value || "";
      try {
        if (isSet() && !(await verify(cur))) { msg("Current PIN is wrong."); return; }
        if (nw !== cf) { msg("New PIN entries do not match."); return; }
        await setPin(nw);
        for (const id of ["lockCur", "lockNew", "lockConfirm"]) {
          const el = document.getElementById(id);
          if (el) el.value = "";
        }
        if (curWrap) curWrap.style.display = "";
        msg("PIN saved. It will be asked on launch and after 10 minutes away.");
      } catch (e) { msg(e?.message || "Could not save PIN."); }
    };
    const rm = document.getElementById("lockRemoveBtn");
    if (rm) rm.onclick = async () => {
      const cur = (document.getElementById("lockCur") || {}).value || "";
      try {
        if (isSet() && !(await verify(cur))) { msg("Current PIN is wrong."); return; }
        removePin();
        if (curWrap) curWrap.style.display = "none";
        msg("App lock removed.");
      } catch (e) { msg(e?.message || "Could not remove PIN."); }
    };
    const now = document.getElementById("lockNowBtn");
    if (now) now.onclick = () => { if (isSet()) show(); else msg("Set a PIN first."); };
  }

  function trackActivity() {
    try {
      // Reloads and refreshes record themselves; only real absence locks.
      window.addEventListener("pagehide", touchActive);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) { touchActive(); return; }
        if (isSet() && isStale()) show();
      });
      // Idle-but-visible also counts as away: first interaction after the
      // gap locks instead of refreshing the timestamp.
      let lastTouch = 0;
      const active = () => {
        try {
          const s = document.getElementById("lockScreen");
          if (s && s.style.display !== "none") return;
        } catch {}
        if (isSet() && isStale()) { show(); return; }
        const now = Date.now();
        if (now - lastTouch > 60000) { lastTouch = now; touchActive(); }
      };
      document.addEventListener("pointerdown", active);
      document.addEventListener("keydown", active);
    } catch {}
  }

  wireLockScreen();
  trackActivity();
  if (isSet() && isStale()) show();

  return { isSet, setPin, verify, removePin, show, hide, initLockUI };
})();
