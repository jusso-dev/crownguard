import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CryptoError, decrypt, decryptJson, encrypt, isEncryptedEnvelope, ITERATIONS, KDF } from "./crypto";

describe("encrypt / decrypt", () => {
  it("round-trips plaintext", async () => {
    const plain = JSON.stringify({ org: { name: "Riverbend Health" }, answers: { "MS-ID-001": "no" } });
    const env = await encrypt(plain, "correct horse battery staple");
    expect(env.crownguardEncrypted).toBe(1);
    expect(env.kdf).toBe(KDF);
    expect(env.iterations).toBe(600_000);
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

  it("rejects an iteration count that would hang the tab, or isn't a count at all", async () => {
    const env = await encrypt("x", "pass");
    await expect(decrypt({ ...env, iterations: 4e9 }, "pass")).rejects.toThrow(/Invalid encryption parameters/);
    await expect(decrypt({ ...env, iterations: 10 * ITERATIONS + 1 }, "pass")).rejects.toThrow(/Invalid encryption parameters/);
    await expect(decrypt({ ...env, iterations: 1.5 }, "pass")).rejects.toThrow(/Invalid encryption parameters/);
    await expect(decrypt({ ...env, iterations: 0 }, "pass")).rejects.toThrow(/Invalid encryption parameters/);
  });

  it("rejects non-envelopes", async () => {
    await expect(decrypt({ hello: "world" }, "pass")).rejects.toThrow(/Not an encrypted/);
    await expect(decrypt(null, "pass")).rejects.toThrow(/Not an encrypted/);
  });
});

/**
 * A frozen envelope, written once by `encrypt()` at commit 0e5fdf0 and never regenerated: these tests only ever read
 * it. A change that makes them fail has locked people out of files they already hold, so fix the reader, not the
 * fixture. The passphrase is public and synthetic; it protects nothing. The plaintext is the committed
 * `schema5.crownguard.json`, byte for byte.
 */
describe("a frozen envelope from envelope version 1", () => {
  const FIXTURE_PASSPHRASE = "crownguard-public-fixture-passphrase";
  const fixtureText = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
  const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
  const bytes = (b64: string) => Buffer.from(b64, "base64");
  const frozen = () => JSON.parse(fixtureText("encrypted-file-v1.json")) as Record<string, string | number>;

  /** PBKDF2-SHA-256 then AES-256-GCM with the tag in the last 16 bytes, by node:crypto rather than the code under test. */
  const independentDecrypt = (env: { salt: string; iv: string; ciphertext: string; iterations: number }, passphrase: string) => {
    const key = pbkdf2Sync(passphrase, bytes(env.salt), env.iterations, 32, "sha256");
    const data = bytes(env.ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", key, bytes(env.iv));
    decipher.setAuthTag(data.subarray(data.length - 16));
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  };

  it("is byte-for-byte the file that was committed, with the parameters it was written with", () => {
    expect(sha256(fixtureText("encrypted-file-v1.json"))).toBe("072b6dedd2cc09c11cfe77a6ad86db1dd671c8518f2336d936e9f28d2b1545c3");
    const env = frozen();
    expect(Object.keys(env)).toEqual(["crownguardEncrypted", "kdf", "iterations", "salt", "iv", "ciphertext"]);
    expect(env.crownguardEncrypted).toBe(1);
    expect(env.kdf).toBe("PBKDF2-SHA-256");
    expect(env.iterations).toBe(600_000);
    expect(bytes(env.salt as string)).toHaveLength(16);
    expect(bytes(env.iv as string)).toHaveLength(12);
    // AES-GCM adds a 16 byte tag and nothing else.
    expect(bytes(env.ciphertext as string)).toHaveLength(Buffer.byteLength(fixtureText("schema5.crownguard.json")) + 16);
    expect(isEncryptedEnvelope(env)).toBe(true);
  });

  it("decrypts to exactly the bytes that were encrypted", async () => {
    const plain = await decrypt(frozen(), FIXTURE_PASSPHRASE);
    expect(plain).toBe(fixtureText("schema5.crownguard.json"));
    expect(await decryptJson(frozen(), FIXTURE_PASSPHRASE)).toEqual(JSON.parse(fixtureText("schema5.crownguard.json")));
  });

  it("still refuses the wrong passphrase and a tampered copy", async () => {
    await expect(decrypt(frozen(), "crownguard-public-fixture-passphrasE")).rejects.toThrow(/Wrong passphrase, or the encrypted data is damaged/);
    const env = frozen();
    const data = bytes(env.ciphertext as string);
    data[data.length - 1] ^= 0x01;
    await expect(decrypt({ ...env, ciphertext: data.toString("base64") }, FIXTURE_PASSPHRASE)).rejects.toThrow(CryptoError);
  });

  it("agrees with an independent implementation, on the frozen envelope and on one written now", async () => {
    const env = frozen() as unknown as { salt: string; iv: string; ciphertext: string; iterations: number };
    expect(independentDecrypt(env, FIXTURE_PASSPHRASE)).toBe(fixtureText("schema5.crownguard.json"));
    // What this build writes must stay readable by anything that implements envelope version 1, older builds included.
    const fresh = await encrypt("written now: “quotes”, 200–999 staff", FIXTURE_PASSPHRASE);
    expect(Object.keys(fresh)).toEqual(["crownguardEncrypted", "kdf", "iterations", "salt", "iv", "ciphertext"]);
    expect(independentDecrypt(fresh, FIXTURE_PASSPHRASE)).toBe("written now: “quotes”, 200–999 staff");
  });
});


it("forwards the inclusive historical KDF boundary and rejects invalid counts before derivation", async () => {
  const env = JSON.parse(readFileSync(new URL("../../e2e/fixtures/encrypted-file-v1.json", import.meta.url), "utf8"));
  // Intercept WebCrypto: never perform a six-million-iteration workload.
  const derive = vi.spyOn(crypto.subtle, "deriveKey").mockResolvedValue({} as CryptoKey);
  const decode = vi.spyOn(crypto.subtle, "decrypt").mockResolvedValue(new TextEncoder().encode("historical").buffer);
  try {
    expect(await decrypt({ ...env, iterations: 6_000_000 }, "public-test-pass")).toBe("historical");
    expect(derive.mock.calls[0][0]).toMatchObject({ iterations: 6_000_000 });
    derive.mockClear();
    for (const iterations of [6_000_001, 0, 1.5]) {
      await expect(decrypt({ ...env, iterations }, "public-test-pass")).rejects.toThrow("Invalid encryption parameters.");
    }
    expect(derive).not.toHaveBeenCalled();
  } finally { derive.mockRestore(); decode.mockRestore(); }
});
