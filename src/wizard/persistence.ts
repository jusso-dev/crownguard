import type { PersistStorage, StorageValue } from "zustand/middleware";
import type { Assessment } from "../engine/types";
import { questionIdSet } from "../content/questionIds";
import { decrypt, encrypt, isEncryptedEnvelope } from "./crypto";
import { parseAssessment } from "./parseAssessment";
import { getSessionPassphrase, hasSessionPassphrase, setLockedEnvelope } from "./sessionSecrets";

export const STORAGE_KEY = "crownguard:v1";
/** Where a stored assessment is moved when it can't be read, so the user can still download it. */
export const UNREADABLE_KEY = `${STORAGE_KEY}:unreadable`;
/** Mode flag only: assessment itself stays out of localStorage when this is "1". */
export const EPHEMERAL_FLAG_KEY = `${STORAGE_KEY}:ephemeral`;

/**
 * Opened a file this build must not overwrite: every write to storage is dropped until the page is reloaded.
 * The assessment the user is looking at is never written back over their own progress.
 */
let readOnly = false;
export const setStorageReadOnly = (value: boolean) => {
  readOnly = value;
};

/** Bumps on every encrypted save so a slower, older PBKDF2 cannot overwrite a newer one. */
let encryptGeneration = 0;

export interface RehydrateNotice {
  kind: "error" | "warn" | "info";
  text: string;
  /** The stored value, kept verbatim when it couldn't be read, so the user can still download it. */
  backup?: string;
}

const rehydration: RehydrateNotice[] = [];
/** What the last rehydrate found wrong with the stored progress. Read as often as you like. */
export const rehydrateNotices = (): readonly RehydrateNotice[] => rehydration;

/**
 * `localStorage` where the browser offers one; memory otherwise (private windows, and the unit tests). Either way
 * the app behaves the same and nothing throws just because the browser said no.
 */
const memory = new Map<string, string>();
const disk = (): Storage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

/** Don't keep the assessment in this browser: flag survives reload; the assessment does not. */
let ephemeralMode = (() => {
  try {
    const on = disk()?.getItem(EPHEMERAL_FLAG_KEY) === "1";
    // A previous session may have left a stale assessment on disk; drop it when the mode is on.
    if (on) disk()?.removeItem(STORAGE_KEY);
    return on;
  } catch {
    return false;
  }
})();

export const isEphemeralMode = () => ephemeralMode;

export function setEphemeralMode(on: boolean) {
  ephemeralMode = on;
  if (on) {
    writeFlag(EPHEMERAL_FLAG_KEY, "1");
    // Drop any autosaved assessment from disk; keep the in-memory Map copy for this session.
    try {
      disk()?.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  } else {
    try {
      disk()?.removeItem(EPHEMERAL_FLAG_KEY);
    } catch {
      /* ignore */
    }
    memory.delete(EPHEMERAL_FLAG_KEY);
  }
}

const writeFlag = (name: string, value: string) => {
  memory.set(name, value);
  try {
    disk()?.setItem(name, value);
  } catch {
    /* Full or locked: flag stays in memory for this session. */
  }
};

const read = (name: string): string | null => {
  // Ephemeral: assessment never comes back from disk after a reload.
  if (name === STORAGE_KEY && ephemeralMode) {
    return memory.get(name) ?? null;
  }
  try {
    return disk()?.getItem(name) ?? memory.get(name) ?? null;
  } catch {
    return memory.get(name) ?? null;
  }
};
const write = (name: string, value: string) => {
  memory.set(name, value);
  if (name === STORAGE_KEY && ephemeralMode) return;
  try {
    disk()?.setItem(name, value);
  } catch {
    // Full or locked: the in-memory copy still keeps this session working.
  }
};
const drop = (name: string) => {
  memory.delete(name);
  try {
    disk()?.removeItem(name);
  } catch {
    // Nothing to do; the user has already been told why their progress isn't being kept.
  }
};

/** Raw access to progress storage, for seeding it with something a hand would write and reading it back. */
export const readProgress = read;
export const writeProgress = write;
export const dropProgress = drop;

/** The stored value kept aside when progress couldn't be read, if there is one. */
export const unreadableBackup = (): string | null => read(UNREADABLE_KEY);

/** True when localStorage holds an encrypted envelope (locked or not). */
export function peekEncryptedProgress(): boolean {
  const raw = (() => {
    try {
      return disk()?.getItem(STORAGE_KEY) ?? memory.get(STORAGE_KEY) ?? null;
    } catch {
      return memory.get(STORAGE_KEY) ?? null;
    }
  })();
  if (!raw) return false;
  try {
    return isEncryptedEnvelope(JSON.parse(raw));
  } catch {
    return false;
  }
}

export interface Persisted {
  assessment?: Assessment;
}

/** The storage is async when a passphrase is set (WebCrypto); plain path stays a resolved promise. */
export type CheckedStorage = PersistStorage<Persisted>;

const decode = (value: string | null): StorageValue<Persisted> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as StorageValue<Persisted>;
  } catch {
    return null;
  }
};

async function validateStored(stored: StorageValue<Persisted>, raw: string, name: string): Promise<StorageValue<Persisted> | null> {
  const assessment = stored.state?.assessment;
  if (!assessment) return stored;

  const parsed = parseAssessment(assessment, { questionIds: questionIdSet() });
  if (parsed.kind === "error") {
    setAside(name, raw, `The progress saved in this browser couldn't be read (${parsed.issues[0] ?? parsed.message}).`);
    return null;
  }

  for (const n of parsed.notices) rehydration.push({ kind: n.kind === "warn" ? "warn" : "info", text: n.text });
  return { ...stored, state: { ...stored.state, assessment: parsed.assessment } };
}

/**
 * Progress storage, checked on the way in and gated on the way out.
 *
 * Anything in this key is untrusted input: it can be stale, hand-edited, or written by another app that shares the
 * origin's storage. It is migrated and validated exactly like an opened file before it reaches the UI. When it can't
 * be read it is moved aside rather than deleted, and the app starts clean with a notice and a copy to download.
 *
 * With a session passphrase the on-disk value is only the encryption envelope — no org name, answers or notes.
 */
export const checkedStorage: CheckedStorage = {
  getItem: async (name) => {
    const raw = read(name);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setAside(name, raw, "The progress saved in this browser couldn't be read (it isn't valid JSON).");
      return null;
    }

    if (isEncryptedEnvelope(parsed)) {
      const pass = getSessionPassphrase();
      if (!pass) {
        setLockedEnvelope(raw);
        return null;
      }
      let plain: string;
      try {
        plain = await decrypt(parsed, pass);
      } catch {
        setLockedEnvelope(raw);
        rehydration.push({
          kind: "error",
          text: "Wrong passphrase, or the encrypted progress in this browser is damaged. Nothing has been loaded.",
        });
        return null;
      }
      setLockedEnvelope(null);
      const stored = decode(plain);
      if (!stored) {
        setAside(name, raw, "The encrypted progress in this browser couldn't be read after decrypting.");
        return null;
      }
      return validateStored(stored, raw, name);
    }

    const stored = parsed as StorageValue<Persisted>;
    if (!stored || typeof stored !== "object") {
      setAside(name, raw, "The progress saved in this browser couldn't be read (it isn't valid JSON).");
      return null;
    }
    return validateStored(stored, raw, name);
  },
  setItem: (name, value) => {
    if (readOnly) return;
    const json = JSON.stringify(value);
    // Plain writes stay synchronous so a later tab/load cannot race an in-flight Promise.
    // Encrypted writes must await WebCrypto; callers that need durability should wait on the returned Promise.
    if (hasSessionPassphrase()) {
      const generation = ++encryptGeneration;
      const pass = getSessionPassphrase()!;
      return encrypt(json, pass).then((envelope) => {
        // A later save already started. Its ciphertext is the one that must land.
        if (generation !== encryptGeneration) return;
        write(name, JSON.stringify(envelope));
      });
    }
    write(name, json);
  },
  removeItem: (name) => {
    if (readOnly) return;
    drop(name);
  },
};

/** Keep unreadable progress to one side rather than deleting it, and say so. */
function setAside(name: string, raw: string, text: string) {
  write(UNREADABLE_KEY, raw);
  drop(name);
  setLockedEnvelope(null);
  rehydration.push({ kind: "error", text: `${text} It has been kept aside so you can download it, and a fresh assessment has been started.`, backup: raw });
}
