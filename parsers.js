// parsers.js - pluggable SMS/bank-message parser.
// Goal: keep every raw message now (dataset), add regex rules later.
// parseMessage(text, sender) is pure and testable. Rules run in order,
// first match wins; generic fallback always runs last.

const MsgParser = (() => {
  const rules = [];

  function addMsgRule(rule) {
    // rule: { id, name, when(text, sender) -> bool, parse(text, sender) -> partial }
    if (!rule || !rule.id || typeof rule.when !== "function" || typeof rule.parse !== "function") {
      throw new Error("Invalid rule (need id, when(), parse())");
    }
    const i = rules.findIndex((r) => r.id === rule.id);
    if (i >= 0) rules[i] = rule;
    else rules.push(rule);
  }

  function cleanNum(s) {
    return Number(String(s).replace(/,/g, ""));
  }

  // Find all money mentions like Rs 1,200.50 / INR 1200 / ₹1200 / 1200 Rs
  function extractAmounts(text) {
    const out = [];
    const re = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr|rupees?)/gi;
    let m;
    while ((m = re.exec(text || ""))) {
      const raw = m[1] || m[2];
      if (!raw) continue;
      const v = cleanNum(raw);
      if (Number.isFinite(v) && v > 0) out.push(v);
    }
    return out;
  }

  function detectType(text) {
    const t = (text || "").toLowerCase();
    // "credit card" / "debit card" are account instruments, not income/expense signals
    const t2 = t.replace(/credit\s*card/g, "").replace(/debit\s*card/g, "");
    const expenseRe = /(debited|debit|spent|paid|purchase|purchased|withdrawn|withdrawal|sent|transferred to|upi\/)/;
    const incomeRe = /(credited|credit|received|refund|cashback|neft\/|imps\/.*credit|salary)/;
    const isExp = expenseRe.test(t2);
    const isInc = incomeRe.test(t2);
    if (isExp && !isInc) return "expense";
    if (isInc && !isExp) return "income";
    // explicit "credited" wins even if UPI present, etc.
    if (/credited/.test(t2)) return "income";
    if (/debited/.test(t2)) return "expense";
    if (/spent/.test(t2)) return "expense";
    return "unknown";
  }

  function extractMerchant(text) {
    const t = text || "";
    let m;
    // UPI patterns: UPI/REF/MERCHANT or to merchant@upi / to VPA
    m = t.match(/UPI[\/\s][\w\-.]+\/([\w\-. &@]{2,40})/i);
    if (m) return m[1].trim().slice(0, 60);
    m = t.match(/\b(?:to|at|towards)\s+([A-Z][A-Z0-9 .&\-]{2,40})/);
    if (m) {
      const v = m[1].trim().replace(/\s+on\s*$/i, "");
      if (!/^(a\/c|ac|account)$/i.test(v)) return v.slice(0, 60);
    }
    m = t.match(/from\s+([A-Z][A-Z0-9 .&\-]{2,40})/i);
    if (m && /salary|employer|neft|imps/i.test(t)) return m[1].trim().slice(0, 60);
    return "";
  }

  function extractUpiRef(text) {
    const m = (text || "").match(/\b(?:ref(?:erence)?(?:\s*no\.?)?|utr|upi\s*ref|txn\s*id)\s*[:\-]?\s*(\d{6,22})/i);
    return m ? m[1] : "";
  }

  function genericParse(text, sender) {
    const amounts = extractAmounts(text);
    const amount = amounts.length ? amounts[0] : null;
    const type = detectType(text);
    const merchant = extractMerchant(text);
    const upiRef = extractUpiRef(text);
    let confidence = "low";
    if (amount && type !== "unknown" && merchant) confidence = "high";
    else if (amount && type !== "unknown") confidence = "medium";
    const noteBits = [];
    if (merchant) noteBits.push(merchant);
    if (upiRef) noteBits.push("Ref " + upiRef);
    if (sender) noteBits.push("via " + sender);
    return {
      amount,
      type,
      merchant,
      upiRef,
      note: noteBits.join(" · ").slice(0, 140),
      confidence,
    };
  }

  // ---- built-in rules (generic first set; add bank-specific ones later) ----
  addMsgRule({
    id: "generic-upi-bank",
    name: "Generic UPI / bank debit-credit SMS",
    when: (text) => extractAmounts(text).length > 0,
    parse: (text, sender) => ({ ...genericParse(text, sender), rule: "generic-upi-bank" }),
  });

  function parseMessage(rawText, sender) {
    const text = String(rawText || "");
    for (const r of rules) {
      let hit = false;
      try { hit = r.when(text, sender); } catch { hit = false; }
      if (hit) {
        const p = r.parse(text, sender) || {};
        return {
          amount: p.amount ?? null,
          type: p.type || "unknown",
          merchant: p.merchant || "",
          upiRef: p.upiRef || "",
          note: p.note || text.slice(0, 140),
          confidence: p.confidence || "low",
          rule: p.rule || r.id,
        };
      }
    }
    return {
      amount: null, type: "unknown", merchant: "", upiRef: "",
      note: text.slice(0, 140), confidence: "low", rule: "no-match",
    };
  }

  function listRules() {
    return rules.map((r) => ({ id: r.id, name: r.name }));
  }

  return { addMsgRule, parseMessage, extractAmounts, detectType, listRules };
})();

// Node export for tests (browser ignores)
if (typeof module !== "undefined" && module.exports) {
  module.exports = MsgParser;
}
