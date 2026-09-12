// vault.js - client-side encryption, pass-style.
// Philosophy (like passwordstore.org): plaintext never leaves the browser.
// We encrypt the SQLite bytes with AES-256-GCM, key derived from your
// passphrase via PBKDF2-SHA256. Only ciphertext is pushed to GitHub.

const Vault = (() => {
  const ITERATIONS = 210000;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  function bufToB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(s);
  }

  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, saltBytes) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // Encrypt raw sqlite bytes -> portable JSON payload
  async function encryptDb(passphrase, sqliteBytes) {
    return encryptBytes(passphrase, sqliteBytes, "database");
  }

  // Encrypt a UTF-8 string (e.g. one inbox message record) -> portable JSON payload.
  // Same envelope as encryptDb plus kind:"message", so one GitHub folder can hold
  // one encrypted file per message, passwordstore-style.
  async function encryptText(passphrase, text) {
    const data = new TextEncoder().encode(String(text ?? ""));
    return encryptBytes(passphrase, data, "message");
  }

  async function encryptBytes(passphrase, dataBytes, kind) {
    if (!passphrase || passphrase.length < 8) {
      throw new Error("Passphrase must be at least 8 characters.");
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(passphrase, salt);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBytes);
    return {
      app: "expense-manager",
      kind: kind || "database",
      version: 1,
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: bufToB64(salt),
      iv: bufToB64(iv),
      ciphertext: bufToB64(new Uint8Array(ct)),
    };
  }

  // Decrypt payload -> Uint8Array sqlite bytes. Throws on wrong passphrase / tamper.
  async function decryptDb(passphrase, payload) {
    return decryptToBytes(passphrase, payload);
  }

  // Decrypt a payload made by encryptText -> UTF-8 string.
  async function decryptText(passphrase, payload) {
    const bytes = await decryptToBytes(passphrase, payload);
    return new TextDecoder().decode(bytes);
  }

  async function decryptToBytes(passphrase, payload) {
    if (!payload || payload.app !== "expense-manager") {
      throw new Error("Not an expense-manager vault file.");
    }
    const salt = b64ToBytes(payload.salt);
    const iv = b64ToBytes(payload.iv);
    const ct = b64ToBytes(payload.ciphertext);
    const iterations = payload.iterations || ITERATIONS;
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new Uint8Array(pt);
  }

  return { ITERATIONS, bufToB64, b64ToBytes, encryptDb, decryptDb, encryptText, decryptText };
})();

// Node export for tests (browser ignores)
if (typeof module !== "undefined" && module.exports) {
  module.exports = Vault;
}
