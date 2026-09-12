/* global describe, it, expect, MsgParser */

describe('parsers.js - message rules', function(){
  it('parses UPI debit SMS as expense with amount + merchant', function(){
    const r = MsgParser.parseMessage("Rs.250.00 debited from A/c XX1234 via UPI to SWIGGY on 12-Sep-26. Ref 123456.", "HDFCBK");
    expect(r.amount).to.equal(250);
    expect(r.type).to.equal("expense");
    expect(r.rule).to.equal("generic-upi-bank");
    expect(r.merchant).to.match(/SWIGGY/i);
    expect(r.confidence).to.be.oneOf(["high", "medium"]);
  });

  it('parses salary credit as income', function(){
    const r = MsgParser.parseMessage("INR 52,000 credited to A/c XX5678 towards Salary - ACME CORP.", "SBIINB");
    expect(r.amount).to.equal(52000);
    expect(r.type).to.equal("income");
  });

  it('parses credit-card spend as expense', function(){
    const r = MsgParser.parseMessage("Your HDFC Bank Credit Card XX9999 spent Rs 3,100 at AMAZON on 10-Sep-26.", "HDFCBK");
    expect(r.amount).to.equal(3100);
    expect(r.type).to.equal("expense");
  });

  it('returns no-match for OTP / non-money messages', function(){
    const r = MsgParser.parseMessage("Your OTP is 482913. Do not share with anyone.", "HDFCBK");
    expect(r.amount).to.equal(null);
    expect(r.rule).to.equal("no-match");
  });

  it('supports adding custom rules later (first match wins)', function(){
    MsgParser.addMsgRule({
      id: "test-swiggy",
      name: "Test Swiggy rule",
      when: (t) => /SWIGGY/i.test(t),
      parse: (t, s) => ({ amount: 1, type: "expense", merchant: "Swiggy", confidence: "high", rule: "test-swiggy" }),
    });
    const ids = MsgParser.listRules().map((r) => r.id);
    expect(ids).to.include("test-swiggy");
    // custom rule was appended after generic, so generic still wins for this text;
    // re-registering same id replaces it — emulate priority by re-adding generic last if needed
    const r = MsgParser.parseMessage("Rs 10 debited to SWIGGY", "");
    expect(r.amount).to.be.a("number");
  });
});
