/* global describe, it, expect, $, $$, todayISO, uuid, fmt, esc, fillSelect */

describe('utils.js', function(){
  it('todayISO returns YYYY-MM-DD', function(){
    const s = todayISO();
    expect(s).to.match(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uuid returns non-empty string', function(){
    const id = uuid();
    expect(id).to.be.a('string').and.to.have.length.greaterThan(5);
  });

  it('fmt formats numbers with currency symbol', function(){
    expect(fmt(0)).to.match(/^₹/);
    expect(fmt(1234.5)).to.match(/^₹/);
  });

  it('esc escapes HTML special characters', function(){
    const input = `<div id="x">"&'</div>`;
    const out = esc(input);
    expect(out).to.not.include('<div');
    expect(out).to.include('&lt;');
    expect(out).to.include('&gt;');
    expect(out).to.include('&quot;');
    expect(out).to.include('&#39;');
    expect(out).to.include('&amp;');
  });

  it('fillSelect populates options', function(){
    const sel = document.createElement('select');
    fillSelect(sel, [{id:'a',name:'A'},{id:'b',name:'B'}], 'id','name');
    expect(sel.querySelectorAll('option')).to.have.length(2);
    expect(sel.querySelector('option[value="a"]').textContent).to.equal('A');
  });
});


