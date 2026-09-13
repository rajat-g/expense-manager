/* global describe, it, expect, Ledger */

describe('ledger.js - sharded merge', function(){
  it('monthKey buckets dates and quarantines bad ones', function(){
    expect(Ledger.monthKey("2026-09-14")).to.equal("2026-09");
    expect(Ledger.monthKey("2026-13-01")).to.equal("undated");
    expect(Ledger.monthKey("")).to.equal("undated");
    expect(Ledger.monthKey(null)).to.equal("undated");
  });

  it('mergeTables unions by id with local winning conflicts', function(){
    const remote = [{ id: "a", v: 1 }, { id: "b", v: 1 }];
    const local = [{ id: "b", v: 2 }, { id: "c", v: 1 }];
    const out = Ledger.mergeTables(local, remote, new Set());
    expect(out).to.have.length(3);
    expect(out.find((r) => r.id === "b").v).to.equal(2);
  });

  it('tombstones delete from both sides', function(){
    const local = [{ id: "a", v: 1 }];
    const remote = [{ id: "b", v: 1 }];
    const out = Ledger.mergeTables(local, remote, new Set(["a", "b"]));
    expect(out).to.have.length(0);
  });

  it('mergeLedgers unions months and drops emptied ones', function(){
    const L = {
      dims: { account_groups: [], accounts: [], categories: [], tombstones: [{ id: "gone", tbl: "transactions" }] },
      months: { "2026-09": [{ id: "t1", date: "2026-09-01" }] },
    };
    const R = {
      dims: { account_groups: [], accounts: [], categories: [], tombstones: [] },
      months: {
        "2026-09": [{ id: "t2", date: "2026-09-02" }],
        "2026-08": [{ id: "gone", date: "2026-08-01" }],
      },
    };
    const M = Ledger.mergeLedgers(L, R);
    expect(Object.keys(M.months).sort()).to.deep.equal(["2026-09"]);
    expect(M.months["2026-09"].map((t) => t.id).sort()).to.deep.equal(["t1", "t2"]);
  });

  it('flattenLedger round-trips a merged ledger to tables', function(){
    const M = {
      dims: { account_groups: [{ id: "g" }], accounts: [], categories: [], tombstones: [] },
      months: { "2026-09": [{ id: "t1" }], undated: [{ id: "t2" }] },
    };
    const f = Ledger.flattenLedger(M);
    expect(f.transactions.map((t) => t.id).sort()).to.deep.equal(["t1", "t2"]);
    expect(f.account_groups).to.have.length(1);
  });

  it('shardPaths derives sibling paths from the backup path', function(){
    const p = Ledger.shardPaths("expenses/expenses.enc.json");
    expect(p.dir).to.equal("expenses");
    expect(p.dims).to.equal("expenses/dims.enc.json");
    expect(p.month("2026-09")).to.equal("expenses/months/2026-09.enc.json");
    expect(p.monthsDir).to.equal("expenses/months");
    expect(Ledger.shardPaths("backup.enc.json").dims).to.equal("dims.enc.json");
  });
});
