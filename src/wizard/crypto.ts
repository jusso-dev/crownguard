/** Optional passphrase protection for browser progress and saved files. WebCrypto only; no recovery. */

export const KDF = "PBKDF2-SHA-256" as const;
export const ITERATIONS = 600_000;
export const ENVELOPE_VERSION = 1 as const;

export interface EncryptedEnvelope {
  crownguardEncrypted: typeof ENVELOPE_VERSION;
  kdf: typeof KDF;
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

/** Errors never include plaintext, passphrase, or ciphertext. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoError";
  }
}

const b64 = {
  enc: (bytes: Uint8Array) => {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  dec: (s: string): Uint8Array<ArrayBuffer> => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.crownguardEncrypted === ENVELOPE_VERSION &&
    v.kdf === KDF &&
    typeof v.iterations === "number" &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.ciphertext === "string"
  );
}

async function deriveKey(passphrase: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a UTF-8 string into a versioned envelope. Fresh salt and IV every call. */
export async function encrypt(plaintext: string, passphrase: string): Promise<EncryptedEnvelope> {
  if (!passphrase) throw new CryptoError("Passphrase required.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return {
    crownguardEncrypted: ENVELOPE_VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: b64.enc(salt),
    iv: b64.enc(iv),
    ciphertext: b64.enc(new Uint8Array(cipher)),
  };
}

/** Decrypt an envelope. Wrong passphrase and tampering both fail cleanly with the same class of error. */
export async function decrypt(envelope: unknown, passphrase: string): Promise<string> {
  if (!passphrase) throw new CryptoError("Passphrase required.");
  if (!envelope || typeof envelope !== "object") throw new CryptoError("Not an encrypted crownguard file.");
  const v = envelope as Record<string, unknown>;
  if (typeof v.crownguardEncrypted === "number" && v.crownguardEncrypted !== ENVELOPE_VERSION) {
    throw new CryptoError(`Unsupported encryption format (version ${v.crownguardEncrypted}).`);
  }
  if (!isEncryptedEnvelope(envelope)) throw new CryptoError("Not an encrypted crownguard file.");
  if (envelope.kdf !== KDF) throw new CryptoError("Unsupported key derivation.");
  if (envelope.iterations < 1) throw new CryptoError("Invalid encryption parameters.");

  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let ciphertext: Uint8Array<ArrayBuffer>;
  try {
    salt = b64.dec(envelope.salt);
    iv = b64.dec(envelope.iv);
    ciphertext = b64.dec(envelope.ciphertext);
  } catch {
    throw new CryptoError("Encrypted data is damaged.");
  }

  try {
    const key = await deriveKey(passphrase, salt, envelope.iterations);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    throw new CryptoError("Wrong passphrase, or the encrypted data is damaged.");
  }
}
