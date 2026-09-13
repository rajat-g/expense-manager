// Haptics — tactile feedback for taps, saves and errors.
//
// Engine: web-haptics v0.0.6 (MIT (c) Lochie Axon), vendored in
// vendor/web-haptics.js so it works offline. It uses the Vibration API on
// Android and the Taptic Engine (hidden switch trick) on iOS, and silently
// no-ops on desktop/unsupported browsers. Defaults create no visible UI.
//
// Usage: Haptics.tap("success" | "warning" | "error" | "light" | "medium"
//   | "heavy" | "soft" | "rigid" | "selection" | "nudge" | "buzz").
// Keep it sparse (nav, sheets, saves, deletes, sync outcomes) — never on
// passive/background events, and always alongside visual feedback.
const Haptics = (() => {
  let inst = null;
  function engine() {
    try {
      if (typeof WebHaptics === "undefined" || !WebHaptics) return null;
      if (!inst) inst = new WebHaptics();
      return inst;
    } catch {
      return null;
    }
  }
  function tap(type) {
    try {
      const h = engine();
      if (!h) return;
      const r = h.trigger(type || "medium");
      if (r && typeof r.catch === "function") r.catch(() => {});
    } catch {
      // haptics must never break the action it accompanies
    }
  }
  return { tap };
})();
