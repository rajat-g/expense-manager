// tests/run-node-tests.js — `npm test`. Fast Node checks for the pure modules
// (parsers + vault). Browser mocha suite in tests.html covers the rest.
const assert = require("assert");
const MsgParser = require("../parsers.js");
const Vault = require("../vault.js");
const GitRemote = require("../gitremote.js");
const Ledger = require("../ledger.js");

async function main() {
  // --- parsers ---
  const debit = MsgParser.parseMessage(
    "Rs.250.00 debited from A/c XX1234 via UPI to SWIGGY on 12-Sep-26. Ref 123456.", "HDFCBK");
  assert.strictEqual(debit.amount, 250);
  assert.strictEqual(debit.type, "expense");
  assert.match(debit.merchant, /SWIGGY/i);

  const salary = MsgParser.parseMessage(
    "INR 52,000 credited to A/c XX5678 towards Salary - ACME CORP.", "SBIINB");
  assert.strictEqual(salary.amount, 52000);
  assert.strictEqual(salary.type, "income");

  const otp = MsgParser.parseMessage("Your OTP is 482913. Do not share.", "HDFCBK");
  assert.strictEqual(otp.amount, null);
  assert.strictEqual(otp.rule, "no-match");
  console.log("parsers: PASS (3 cases)");

  // --- vault ---
  const rec = JSON.stringify({ kind: "expense-manager-message", id: "abc", body: "hello" });
  const payload = await Vault.encryptText("correct horse battery staple", rec);
  assert.strictEqual(payload.app, "expense-manager");
  assert.strictEqual(payload.kind, "message");
  assert.strictEqual(await Vault.decryptText("correct horse battery staple", payload), rec);
  await assert.rejects(Vault.decryptText("wrong passphrase!!", payload));
  const dbPayload = await Vault.encryptDb("correct horse battery staple", new Uint8Array([1, 2, 3]));
  assert.strictEqual(dbPayload.kind, "database");
  assert.deepStrictEqual(Array.from(await Vault.decryptDb("correct horse battery staple", dbPayload)), [1, 2, 3]);
  console.log("vault: PASS (roundtrips + wrong-passphrase rejection)");

  // --- gitremote ---
  assert.deepStrictEqual(
    GitRemote.parseGitRemote("https://github.com/myuser/expense-vault"),
    { host: "github.com", owner: "myuser", repo: "expense-vault" });
  assert.deepStrictEqual(
    GitRemote.parseGitRemote("git@github.com:myuser/expense-vault.git"),
    { host: "github.com", owner: "myuser", repo: "expense-vault" });
  assert.deepStrictEqual(
    GitRemote.parseGitRemote("myuser/expense-vault"),
    { host: "github.com", owner: "myuser", repo: "expense-vault" });
  assert.strictEqual(GitRemote.parseGitRemote("https://github.com/onlyowner"), null);
  assert.strictEqual(GitRemote.parseGitRemote("not a url at all!!!"), null);
  assert.strictEqual(GitRemote.isGitHubHost("github.com"), true);
  assert.strictEqual(GitRemote.isGitHubHost("gitlab.com"), false);
  console.log("gitremote: PASS (6 cases)");

  // --- ledger ---
  assert.strictEqual(Ledger.monthKey("2026-09-14"), "2026-09");
  assert.strictEqual(Ledger.monthKey("nope"), "undated");
  const merged = Ledger.mergeLedgers(
    { dims: { account_groups: [], accounts: [], categories: [], tombstones: [{ id: "gone" }] },
      months: { "2026-09": [{ id: "t1", date: "2026-09-01" }] } },
    { dims: { account_groups: [], accounts: [], categories: [], tombstones: [] },
      months: { "2026-09": [{ id: "t2", date: "2026-09-02" }], "2026-08": [{ id: "gone", date: "2026-08-01" }] } });
  assert.deepStrictEqual(Object.keys(merged.months), ["2026-09"]);
  assert.deepStrictEqual(merged.months["2026-09"].map((t) => t.id).sort(), ["t1", "t2"]);
  const flat = Ledger.flattenLedger(merged);
  assert.strictEqual(flat.transactions.length, 2);
  assert.strictEqual(Ledger.shardPaths("expenses/expenses.enc.json").month("2026-09"), "expenses/months/2026-09.enc.json");
  console.log("ledger: PASS (merge + tombstones + sharding)");

  console.log("ALL NODE TESTS PASS");
}

main().catch((e) => { console.error("NODE TESTS FAILED:", e); process.exit(1); });
