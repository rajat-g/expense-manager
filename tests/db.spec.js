/* global describe, it, before, beforeEach, expect, initSqlJs, SQL, db, createSchema, saveDB, query, queryOne, exec, uuid */

describe('database flows', function(){
  this.timeout(5000);

  function resetMemoryDb(){
    // Create a fresh in-memory DB without touching localStorage
    SQL = window.SQL;
    db = new SQL.Database();
    createSchema();
  }

  before(function(done){
    // Ensure sql-wasm is initialized before tests use SQL.Database
    if(window.SQL){ return done(); }
    initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${f}` })
      .then(Module => { window.SQL = Module; done(); })
      .catch(done);
  });

  beforeEach(function(){
    resetMemoryDb();
    // seed minimal data for tests
    exec("INSERT INTO account_groups(id,name,type) VALUES (?,?,?)", ["g1","Wallet","cash"]);
    exec("INSERT INTO accounts(id,name,groupId) VALUES (?,?,?)", ["a1","Cash","g1"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_inc","Salary","income"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_exp","Food","expense"]);
  });

  it('computes totals by type correctly', function(){
    exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)",
      [uuid(), '2024-01-01', 'a1', 'c_inc', 'income', 1000, 'Jan salary']);
    exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)",
      [uuid(), '2024-01-02', 'a1', 'c_exp', 'expense', 250, 'Groceries']);

    const res = query("SELECT type, COALESCE(SUM(amount),0) total FROM transactions GROUP BY type");
    const map = Object.fromEntries(res.map(r=>[r.type, r.total]));
    expect(map.income).to.equal(1000);
    expect(map.expense).to.equal(250);
  });

  it('orders recent transactions by date then rowid desc', function(){
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-01','a1','c_exp','expense',10,'x']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-01','a1','c_exp','expense',20,'y']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-02','a1','c_exp','expense',5,'z']);

    const rows = query("SELECT t.* FROM transactions t ORDER BY t.date DESC, t.rowid DESC");
    expect(rows[0].date).to.equal('2024-01-02');
    // next two share same date; later insert should come first (higher rowid)
    expect(rows[1].date).to.equal('2024-01-01');
    expect(rows[2].date).to.equal('2024-01-01');
  });

  it('prevents deleting category with existing transactions (guard logic)', function(){
    const catId = 'c_exp';
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-03','a1',catId,'expense',12,'test']);
    const cnt = queryOne("SELECT COUNT(*) as c FROM transactions WHERE categoryId=?", [catId]).c;
    expect(cnt).to.equal(1);
    // simulate categories.js guard check
    const canDelete = cnt === 0;
    expect(canDelete).to.equal(false);
  });

  it('filters transactions by date, account, category, and type correctly', function(){
    // additional seed
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_food","Food","expense"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_bonus","Bonus","income"]);
    exec("INSERT INTO accounts(id,name,groupId) VALUES (?,?,?)", ["a2","Bank","g1"]);

    const rows = [
      ['2024-02-01','a1','c_food','expense',50,'A'],
      ['2024-02-10','a1','c_food','expense',30,'B'],
      ['2024-03-05','a2','c_exp','expense',70,'C'],
      ['2024-03-07','a2','c_bonus','income',200,'D']
    ];
    rows.forEach(r=>exec("INSERT INTO transactions(id,date,accountId,categoryId,type,amount,note) VALUES (?,?,?,?,?,?,?)", [uuid(),...r]));

    // Emulate applyFilters logic
    function runFilter({from,to,acc,cat,type}){
      let sql = `
        SELECT t.*
        FROM transactions t
        WHERE 1=1`;
      const params = [];
      if(from){ sql += " AND t.date >= ?"; params.push(from); }
      if(to){ sql += " AND t.date <= ?"; params.push(to); }
      if(acc){ sql += " AND t.accountId = ?"; params.push(acc); }
      if(cat){ sql += " AND t.categoryId = ?"; params.push(cat); }
      if(type){ sql += " AND t.type = ?"; params.push(type); }
      sql += " ORDER BY t.date DESC, t.rowid DESC";
      return query(sql, params);
    }

    expect(runFilter({from:'2024-02-01',to:'2024-02-28'})).to.have.length(2);
    expect(runFilter({acc:'a2'})).to.have.length(2);
    expect(runFilter({cat:'c_food'})).to.have.length(2);
    expect(runFilter({type:'income'})).to.have.length(1);
  });

  it('CSV export escapes quotes and wraps all fields in quotes', function(){
    const r = { date:'2024-01-01', account:'Cash', category:'Food', type:'expense', note:'He said "Hello", then left', amount:12.5 };
    const csv = "Date,Account,Category,Type,Note,Amount\n" + [[
      r.date, r.account, r.category, r.type, (r.note||"").replace(/"/g,'""'), r.amount
    ].map(x=>`"${x??""}"`).join(",")];
    const line = csv.split("\n")[1];
    expect(line).to.match(/^"2024-01-01","Cash","Food","expense","He said ""Hello"", then left","12.5"$/);
  });

  it('computes account group totalBalance correctly', function(){
    // a1 existing, add a2 and some transactions
    exec("INSERT INTO accounts(id,name,groupId) VALUES (?,?,?)", ["a2","Bank","g1"]);
    // a1: +100 -40 = 60
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-10','a1','c_inc','income',100,'']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-11','a1','c_exp','expense',40,'']);
    // a2: -10
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-12','a2','c_exp','expense',10,'']);

    const groups = query(`
      SELECT g.id,
             COALESCE(SUM(
               (SELECT SUM(CASE WHEN t.type='income' THEN t.amount ELSE -t.amount END) 
                FROM transactions t WHERE t.accountId=a.id)
             ), 0) AS totalBalance
      FROM account_groups g
      LEFT JOIN accounts a ON a.groupId = g.id
      GROUP BY g.id
    `);
    expect(groups).to.have.length(1);
    expect(groups[0].totalBalance).to.equal(50); // 60 + (-10)
  });

  it('aggregates last 6 months correctly for chart window', function(){
    // fixed dates around current month window
    const now = new Date();
    const mk = (y,m,d)=> new Date(y,m,d).toISOString().slice(0,10);
    const y = now.getFullYear();
    const m = now.getMonth();
    // insert income in current month, expense last month
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(), mk(y,m,1),'a1','c_inc','income',100,'']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(), mk(y,m-1,1),'a1','c_exp','expense',30,'']);
    // outside window: 12 months ago should not show
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(), mk(y,m-12,1),'a1','c_inc','income',999,'']);

    // Reuse dashboard grouping query logic
    const months=[]; for(let i=5;i>=0;i--){ const d=new Date(y,m-i,1); months.push(d.toISOString().slice(0,7)); }
    const startDate = months[0] + "-01";
    const endDate = new Date(y, m+1, 0).toISOString().slice(0,10);
    const rows = query(`
      SELECT substr(date,1,7) m,
             SUM(CASE WHEN type='income' THEN amount ELSE 0 END) inc,
             SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) exp
      FROM transactions
      WHERE date >= ? AND date <= ?
      GROUP BY substr(date,1,7)
    `,[startDate,endDate]);
    const map = Object.fromEntries(rows.map(r=>[r.m,r]));
    expect(map[months[5]].inc || 0).to.equal(100);
    expect(map[months[4]].exp || 0).to.equal(30);
    // ensure old data excluded
    const oldKey = new Date(y,m-12,1).toISOString().slice(0,7);
    expect(map[oldKey]).to.equal(undefined);
  });

  it('top categories compute income and expense sums', function(){
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_shop","Shopping","expense"]);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-10','a1','c_inc','income',500,'']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-11','a1','c_exp','expense',100,'']);
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-12','a1','c_shop','expense',200,'']);

    const cats = query(`
      SELECT c.name,
             SUM(CASE WHEN t.type='income' THEN t.amount ELSE 0 END) income,
             SUM(CASE WHEN t.type='expense' THEN t.amount ELSE 0 END) expense
      FROM categories c
      LEFT JOIN transactions t ON t.categoryId=c.id
      GROUP BY c.id
    `);
    const map = Object.fromEntries(cats.map(c=>[c.name, c]));
    expect(map.Salary.income).to.equal(500);
    expect(map.Food.expense).to.equal(100);
    expect(map.Shopping.expense).to.equal(200);
  });

  it('prevents deleting account with existing transactions (guard logic)', function(){
    const accId = 'a1';
    exec("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)", [uuid(),'2024-01-15',accId,'c_exp','expense',5,'']);
    const cnt = queryOne("SELECT COUNT(*) as c FROM transactions WHERE accountId=?", [accId]).c;
    expect(cnt).to.equal(1);
    const canDelete = cnt === 0;
    expect(canDelete).to.equal(false);
  });

  it('prevents deleting group with existing accounts (guard logic)', function(){
    const groupId = 'g1';
    const accCount = queryOne("SELECT COUNT(*) as c FROM accounts WHERE groupId=?", [groupId]).c;
    expect(accCount).to.be.greaterThan(0);
    const canDelete = accCount === 0;
    expect(canDelete).to.equal(false);
  });
});


