/* global describe, it, before, beforeEach, expect, initSqlJs, SQL, db, createSchema, exec, query, queryOne, fillSelect, document, updateTxCategoryOptions, addTransaction */

describe('transactions category/type behavior', function(){
  this.timeout(5000);

  function resetDom(){
    const container = document.createElement('div');
    container.id = 'test-fixtures';
    container.style.display = 'none';
    container.innerHTML = `
      <input id="txDate" value="2024-01-01" />
      <select id="txAccount"></select>
      <select id="txType"></select>
      <select id="txCategory"></select>
      <input id="txAmount" value="100" />
      <input id="txNote" value="note" />`;
    document.body.appendChild(container);
  }

  function resetDb(){
    SQL = window.SQL;
    db = new SQL.Database();
    createSchema();
    exec("INSERT INTO account_groups(id,name,type) VALUES (?,?,?)", ["g","G","cash"]);
    exec("INSERT INTO accounts(id,name,groupId) VALUES (?,?,?)", ["a","A","g"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_inc","Salary","income"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_exp","Food","expense"]);
    exec("INSERT INTO categories(id,name,type) VALUES (?,?,?)", ["c_both","Other","both"]);
  }

  before(function(done){
    if(window.SQL){ return done(); }
    initSqlJs({ locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.6.2/${f}` })
      .then(Module => { window.SQL = Module; done(); })
      .catch(done);
  });

  beforeEach(function(){
    resetDom();
    resetDb();
    // seed selectors
    fillSelect(document.querySelector('#txAccount'), [{id:'a',name:'A'}], 'id','name');
    fillSelect(document.querySelector('#txType'), [{id:'expense',name:'expense'},{id:'income',name:'income'}], 'id','name');
  });

  it('updateTxCategoryOptions shows only categories matching type or both', function(){
    document.querySelector('#txType').value = 'income';
    updateTxCategoryOptions();
    const optsIncome = Array.from(document.querySelector('#txCategory').querySelectorAll('option')).map(o=>o.value);
    expect(optsIncome).to.include('c_inc');
    expect(optsIncome).to.include('c_both');
    expect(optsIncome).to.not.include('c_exp');

    document.querySelector('#txType').value = 'expense';
    updateTxCategoryOptions();
    const optsExpense = Array.from(document.querySelector('#txCategory').querySelectorAll('option')).map(o=>o.value);
    expect(optsExpense).to.include('c_exp');
    expect(optsExpense).to.include('c_both');
    expect(optsExpense).to.not.include('c_inc');
  });

  it('addTransaction blocks mismatched category/type', function(){
    // set form values
    document.querySelector('#txType').value = 'income';
    updateTxCategoryOptions();
    document.querySelector('#txAccount').value = 'a';
    document.querySelector('#txCategory').value = 'c_exp'; // expense cat chosen
    document.querySelector('#txAmount').value = '100';

    let alerted = false;
    const oldAlert = window.alert;
    window.alert = function(){ alerted = true; };
    try {
      addTransaction();
    } finally {
      window.alert = oldAlert;
    }
    expect(alerted).to.equal(true);
    const count = queryOne('SELECT COUNT(*) as c FROM transactions').c;
    expect(count).to.equal(0);
  });
});


