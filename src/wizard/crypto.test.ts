import { describe, expect, it } from "vitest";
import { CryptoError, decrypt, encrypt, isEncryptedEnvelope, ITERATIONS, KDF } from "./crypto";

describe("encrypt / decrypt", () => {
  it("round-trips plaintext", async () => {
    const plain = JSON.stringify({ org: { name: "Riverbend Health" }, answers: { "MS-ID-001": "no" } });
    const env = await encrypt(plain, "correct horse battery staple");
    expect(env.crownguardEncrypted).toBe(1);
    expect(env.kdf).toBe(KDF);
    expect(env.iterations).toBe(ITERATIONS);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(await decrypt(env, "correct horse battery staple")).toBe(plain);
  });

  it("uses a fresh salt and IV each time", async () => {
    const a = await encrypt("same", "pass");
    const b = await encrypt("same", "pass");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects a wrong passphrase without leaking plaintext", async () => {
    const secret = "org-name-must-not-appear-in-errors";
    const env = await encrypt(secret, "right");
    await expect(decrypt(env, "wrong")).rejects.toThrow(CryptoError);
    await expect(decrypt(env, "wrong")).rejects.toThrow(/Wrong passphrase|damaged/);
    try {
      await decrypt(env, "wrong");
    } catch (e) {
      expect(String(e)).not.toContain(secret);
      expect(String(e)).not.toContain("right");
      expect(String(e)).not.toContain(env.ciphertext);
    }
  });

  it("rejects tampered ciphertext (AES-GCM auth)", async () => {
    const env = await encrypt("intact", "pass");
    const bytes = Uint8Array.from(atob(env.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    let tampered = "";
    for (const b of bytes) tampered += String.fromCharCode(b);
    const bad = { ...env, ciphertext: btoa(tampered) };
    await expect(decrypt(bad, "pass")).rejects.toThrow(CryptoError);
    await expect(decrypt(bad, "pass")).rejects.toThrow(/Wrong passphrase|damaged/);
  });

  it("rejects an unknown envelope version with a clear error", async () => {
    const env = await encrypt("x", "pass");
    await expect(decrypt({ ...env, crownguardEncrypted: 99 }, "pass")).rejects.toThrow(/Unsupported encryption format \(version 99\)/);
  });

  it("rejects non-envelopes", async () => {
    await expect(decrypt({ hello: "world" }, "pass")).rejects.toThrow(/Not an encrypted/);
    await expect(decrypt(null, "pass")).rejects.toThrow(/Not an encrypted/);
  });
});
