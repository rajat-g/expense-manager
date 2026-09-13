// Notify — themed replacements for alert()/confirm()/prompt().
//
// Built on vendored SweetAlert2 v11.26.25 (MIT (c) SweetAlert2, loaded from
// vendor/). Follows the app theme (dark/light) via colorScheme + customClass
// hooks styled in styles.css. All async: alert() resolves when dismissed,
// confirm() resolves true/false, prompt() resolves the string or null.
// If the library ever fails to load, calls fall back to native dialogs
// rather than failing silently.
const Notify = (() => {
  function dark() {
    try {
      if (typeof isDarkTheme === "function") return isDarkTheme();
    } catch {}
    try {
      return (document.documentElement.getAttribute("data-theme") || "dark") !== "light";
    } catch {
      return true;
    }
  }

  function base(opts) {
    return {
      background: "var(--card)",
      color: "var(--text)",
      colorScheme: dark() ? "dark" : "light",
      customClass: {
        popup: "x-popup",
        title: "x-title",
        htmlContainer: "x-html",
        confirmButton: "x-ok",
        cancelButton: "x-cancel",
        input: "x-input",
        validationMessage: "x-valid",
      },
      buttonsStyling: false,
      reverseButtons: true,
      ...opts,
    };
  }

  async function fire(opts) {
    try {
      if (typeof Swal === "undefined" || !Swal || typeof Swal.fire !== "function") throw 0;
      return await Swal.fire(base(opts));
    } catch {
      // NOTE: globalThis on purpose — bare alert()/confirm()/prompt() here
      // would recurse into the wrappers below.
      if (opts.showCancelButton && !opts.input) {
        return { isConfirmed: globalThis.confirm(opts.text || opts.title || "") };
      }
      if (opts.input) {
        const v = globalThis.prompt(opts.title || "", opts.inputValue || "");
        return v === null ? { isConfirmed: false } : { isConfirmed: true, value: v };
      }
      globalThis.alert(opts.text || opts.title || "");
      return { isConfirmed: true };
    }
  }

  // Info or error message. Icon: "success" | "error" | "info" | undefined.
  function alert(msg, icon) {
    return fire({
      text: String(msg ?? ""),
      icon: icon || undefined,
      confirmButtonText: "OK",
    }).then(() => undefined);
  }

  // Returns Promise<boolean>. danger=true gets a warning icon + Delete button.
  function confirm(msg, opts) {
    const o = opts || {};
    return fire({
      text: String(msg ?? ""),
      icon: o.danger ? "warning" : "question",
      showCancelButton: true,
      confirmButtonText: o.okText || (o.danger ? "Delete" : "Confirm"),
      cancelButtonText: "Cancel",
    }).then((r) => !!(r && r.isConfirmed));
  }

  // Returns Promise<string|null> (null on cancel; empty blocked by validator).
  function prompt(title, initial) {
    return fire({
      title: String(title ?? ""),
      input: "text",
      inputValue: initial || "",
      showCancelButton: true,
      confirmButtonText: "Save",
      cancelButtonText: "Cancel",
      inputValidator: (v) => (!String(v || "").trim() ? "Enter a value" : undefined),
    }).then((r) => (r && r.isConfirmed ? String(r.value ?? "") : null));
  }

  // Non-blocking toast (bottom, above the tab bar on phones). Icon:
  // "success" | "error" | "info" | "warning" | undefined. Without the
  // library this is a silent no-op — a native popup for a toast would be
  // worse, and the underlying UI update already happened.
  function toast(msg, icon) {
    try {
      if (typeof Swal === "undefined" || !Swal || typeof Swal.fire !== "function") return Promise.resolve();
      return Swal.fire(base({
        toast: true,
        position: "bottom",
        title: String(msg ?? ""),
        icon: icon || undefined,
        showConfirmButton: false,
        timer: 2600,
        timerProgressBar: true,
        customClass: { popup: "x-toast", title: "x-toast-title", container: "x-toast-wrap" },
      })).then(
        () => undefined,
        () => undefined
      );
    } catch {
      return Promise.resolve();
    }
  }

  // Choice dialog: everything visible at once — a target select with
  // Move/Cancel, plus the destructive alternative as a quiet footer link
  // (a third button crowds mobile and reads as disabled). Resolves
  // { action: "ok", value }, { action: "danger" }, or null on cancel.
  // options: [{ value, label }].
  function choose(title, text, options, cfg) {
    const o = cfg || {};
    const inputOptions = {};
    for (const opt of options || []) inputOptions[opt.value] = opt.label;
    let dangerTapped = false;
    return fire({
      title: String(title ?? ""),
      text: String(text ?? ""),
      input: "select",
      inputOptions,
      inputValidator: (v) => (!v ? "Pick one" : undefined),
      showCancelButton: true,
      confirmButtonText: o.okText || "Move",
      cancelButtonText: "Cancel",
      footer: o.dangerText
        ? `<button type="button" class="x-danger-link">${String(o.dangerText).replace(/</g, "&lt;")}</button>`
        : "",
      didOpen: (popup) => {
        try {
          const b = popup && popup.querySelector(".x-danger-link");
          if (b) b.onclick = () => {
            dangerTapped = true;
            if (typeof Swal !== "undefined" && Swal && typeof Swal.close === "function") Swal.close();
          };
        } catch {}
      },
    }).then((r) => {
      if (dangerTapped) return { action: "danger" };
      if (!r || !r.isConfirmed) return null;
      return { action: "ok", value: r.value };
    });
  }

  return { alert, confirm, prompt, choose, toast };
})();
