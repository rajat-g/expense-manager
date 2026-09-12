/* global describe, it, expect, Vault */

describe('vault.js - per-message envelope', function(){
  this.timeout(10000);

  it('encryptText/decryptText roundtrips a message record', async function(){
    const rec = JSON.stringify({ kind: "expense-manager-message", id: "abc", body: "Rs.250 debited via UPI to SWIGGY." });
    const payload = await Vault.encryptText("correct horse battery staple", rec);
    expect(payload.app).to.equal("expense-manager");
    expect(payload.kind).to.equal("message");
    expect(payload.ciphertext).to.be.a("string");
    const back = await Vault.decryptText("correct horse battery staple", payload);
    expect(back).to.equal(rec);
  });

  it('rejects decryption with the wrong passphrase', async function(){
    const payload = await Vault.encryptText("correct horse battery staple", "hello");
    let failed = false;
    try { await Vault.decryptText("wrong passphrase!!", payload); }
    catch (e) { failed = true; }
    expect(failed).to.equal(true);
  });

  it('keeps the whole-DB envelope working (kind database)', async function(){
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const payload = await Vault.encryptDb("correct horse battery staple", bytes);
    expect(payload.kind).to.equal("database");
    const back = await Vault.decryptDb("correct horse battery staple", payload);
    expect(Array.from(back)).to.deep.equal([1, 2, 3, 250]);
  });
});
