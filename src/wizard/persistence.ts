import { allQuestionIds } from "../content/catalogue";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { SCHEMA_VERSION, type Assessment } from "../format/schema";
import { autosaveKeys, EPHEMERAL_ON, platform, type AutosaveStore } from "../platform";
import { decrypt, encrypt, isEncryptedEnvelope } from "../format/crypto";
import { parseAssessment } from "../format/parse";
import { getSessionPassphrase, onPassphraseChange, setSessionPassphrase, setLockedEnvelope } from "./sessionSecrets";
import { HERE } from "./where";

export const STORAGE_KEY = autosaveKeys.progress;
export const UNREADABLE_KEY = autosaveKeys.unreadable;
const EPHEMERAL_FLAG_KEY = autosaveKeys.ephemeral;

/**
 * Opened a file this build must not overwrite: every write to storage is dropped until the page is reloaded.
 * The assessment the user is looking at is never written back over their own progress.
 */
let readOnly = false;
export const setStorageReadOnly = (value: boolean) => {
  if (readOnly !== value) invalidateProtection();
  readOnly = value;
};

/**
 * Bumps on every save and every removal, so a slower, older PBKDF2 can't land over a newer save, a plain save, or
 * progress the user has just removed.
 */
let encryptGeneration = 0;

/** Small session status shared by forms, save status and recovery downloads. */
export type ProtectionStatus = "idle" | "pending" | "protected" | "session" | "plain" | "error";
let protectionStatus: ProtectionStatus = "idle";
let protectionRevision = 0;
let recoveryBlocked = false;
let recovering = false;
let restoreSessionBackup = false;
let explicitRevision: number | undefined;
const removals = new Set<Promise<void>>();
const listeners = new Set<() => void>();
export const protectionSnapshot = () => protectionStatus;
export const protectionOperation = () => protectionRevision;
export const subscribeProtection = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const protectionError = "Protection is incomplete. Local storage may still contain unprotected data or data under an earlier passphrase. Keep the entered passphrase and any earlier backup passphrase. Retry, or save your work to a file.";
function status(next: ProtectionStatus) {
  protectionStatus = next;
  for (const listener of listeners) listener();
}
export function invalidateProtection() {
  protectionRevision++;
  encryptGeneration++;
  backupWork = undefined;
  // Invalidation cancels earlier completion; only an actual failure stays sticky until explicit retry.
  status(protectionStatus === "error" ? "error" : "idle");
}
onPassphraseChange(invalidateProtection);
const cancelled = () => new Error("Protection changed or was cancelled. Retry with the current settings.");
function guard(revision: number) {
  if (revision !== protectionRevision || readOnly || recoveryBlocked) throw cancelled();
}

/** The last write of the assessment to the autosave store failed (usually full); cleared by the next one that works. */
let writeFailed = false;
export const storageWriteFailed = () => writeFailed;

interface RehydrateNotice {
  kind: "error" | "warn" | "info";
  text: string;
  /** Recovery data is resolved from storage at click time, never captured here. */
  backup?: boolean;
}

const rehydration: RehydrateNotice[] = [];
/** What the last rehydrate found wrong with the stored progress. Read as often as you like. */
export const rehydrateNotices = (): readonly RehydrateNotice[] => rehydration;

/**
 * The platform's autosave store where it offers one: `localStorage` in the browser, SQLite on desktop (see
 * src/platform/). Memory otherwise (private windows, and the unit tests). Either way the app behaves the same and
 * nothing throws just because storage said no.
 */
const memory = new Map<string, string>();
const disk = (): AutosaveStore | undefined => platform.autosave();

/**
 * Don't keep the assessment in this browser: flag survives reload; the assessment does not. Read on first use rather
 * than at import, so the desktop build reads it from SQLite once the platform is ready.
 */
let ephemeralFlag: boolean | undefined;
const ephemeral = () =>
  (ephemeralFlag ??= (() => {
    let on = false;
    try { on = disk()?.getItem(EPHEMERAL_FLAG_KEY) === EPHEMERAL_ON; } catch { /* No readable flag. */ }
    // Keep the user's mode even when stale local data could not be removed.
    if (on) {
      try {
        observeRemoval(STORAGE_KEY);
        observeRemoval(UNREADABLE_KEY);
      } catch {
        writeFailed = true;
        status("error");
      }
    }
    return on;
  })());

export const isEphemeralMode = () => ephemeral();

export function setEphemeralMode(on: boolean) {
  invalidateProtection();
  // Preserve committed recovery bytes in session memory before removing disk copies.
  const backup = unreadableBackup();
  restoreSessionBackup = !on && ephemeral() && backup !== null;
  if (backup !== null) memory.set(UNREADABLE_KEY, backup);
  ephemeralFlag = on;
  if (on) {
    writeFlag(EPHEMERAL_FLAG_KEY, EPHEMERAL_ON);
    // Drop any autosaved assessment from disk; keep the in-memory Map copy for this session.
    try {
      observeRemoval(STORAGE_KEY);
      observeRemoval(UNREADABLE_KEY);
    } catch {
      writeFailed = true;
      status("error");
    }
  } else {
    try {
      disk()?.removeItem(EPHEMERAL_FLAG_KEY);
    } catch {
      // Locked storage never held the flag; the in-memory copy below is the one that counts.
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

const memoryOnly = (name: string) => ephemeral() && (name === STORAGE_KEY || name === UNREADABLE_KEY);

const read = (name: string): string | null => {
  if (memoryOnly(name)) {
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
  if (memoryOnly(name)) return;
  try {
    const store = disk();
    const result = store?.setItem(name, value);
    if (result) void result.then(() => { if (name === STORAGE_KEY) writeFailed = false; }, () => { writeFailed = true; });
    else if (store && name === STORAGE_KEY) writeFailed = false;
  } catch {
    // Full or locked: the in-memory copy still keeps this session working, but the save status must not say "Saved".
    if (name === STORAGE_KEY) writeFailed = true;
  }
};
const drop = (name: string) => {
  // Whatever encrypted save is still in flight was for the value being removed; it must not land afterwards.
  invalidateProtection();
  memory.delete(name);
  if (name === UNREADABLE_KEY) restoreSessionBackup = false;
  try {
    observeRemoval(name);
  } catch {
    writeFailed = true;
    status("error");
  }
};

/** Raw access to progress storage, for seeding it with something a hand would write and reading it back. */
export const readProgress = read;
export const writeProgress = (name: string, value: string) => {
  if (name === UNREADABLE_KEY) invalidateProtection();
  write(name, value);
};
/** Remove progress, and the unreadable copy kept beside it: the user asked for this browser to forget it. */
export const dropProgress = (name: string) => {
  recoveryBlocked = false;
  drop(name);
  if (name === STORAGE_KEY) drop(UNREADABLE_KEY);
  const revision = protectionRevision;
  const generation = encryptGeneration;
  void Promise.all(removals).then(() => {
    if (revision !== protectionRevision || generation !== encryptGeneration) return;
    try {
      const store = disk();
      if (!store) return;
      const get = (key: string) => store.getCommittedItem ? store.getCommittedItem(key) : store.getItem(key);
      if (get(STORAGE_KEY) === null && get(UNREADABLE_KEY) === null) {
        recoveryBlocked = false;
        writeFailed = false;
        status("idle");
      }
    } catch { /* Absence cannot be confirmed. Keep the failure visible. */ }
  });
};

export const unreadableBackup = (): string | null => {
  try { return committed(UNREADABLE_KEY); } catch { return memory.get(UNREADABLE_KEY) ?? null; }
};

function committed(name: string): string | null {
  if (memoryOnly(name)) return memory.get(name) ?? null;
  const store = disk();
  if (!store) throw new Error("Local storage unavailable.");
  return store.getCommittedItem ? store.getCommittedItem(name) : store.getItem(name);
}

function observeRemoval(name: string) {
  const store = disk();
  if (!store) throw new Error("Local storage unavailable.");
  const result = store.removeItem(name);
  if (result) {
    const handled = result.catch(() => { writeFailed = true; status("error"); });
    removals.add(handled);
    void handled.then(() => removals.delete(handled));
  }
}

async function confirmEphemeralRemoval() {
  await Promise.all(removals);
  const store = disk();
  if (!store) throw new Error("Local storage absence cannot be confirmed.");
  for (const key of [STORAGE_KEY, UNREADABLE_KEY]) {
    const raw = store.getCommittedItem ? store.getCommittedItem(key) : store.getItem(key);
    if (raw !== null) throw new Error("Local data could not be removed.");
  }
}

async function strictWrite(name: string, value: string) {
  const revision = protectionRevision;
  if (!memoryOnly(name)) {
    const store = disk();
    if (!store) throw new Error("Local storage unavailable.");
    await store.setItem(name, value);
  }
  if (revision === protectionRevision) {
    memory.set(name, value);
    if (name === UNREADABLE_KEY && !memoryOnly(name)) restoreSessionBackup = false;
  }
}

export function backupIsEncrypted(raw: string): boolean {
  try { return isEncryptedEnvelope(JSON.parse(raw)); } catch { return false; }
}

// Shared preparation/commit prevents ordinary active edits from restarting backup encryption.
let backupWork: { source: string | null; raw: string; revision: number; prepared: Promise<string>; commit?: Promise<void> } | undefined;
function prepareBackup(pass: string | null, revision: number, raw = committed(UNREADABLE_KEY) ?? (restoreSessionBackup ? memory.get(UNREADABLE_KEY) ?? null : null)) {
  const source = committed(UNREADABLE_KEY);
  if (raw === null) return undefined;
  if (backupWork?.revision === revision && backupWork.source === source && backupWork.raw === raw) return backupWork;
  const prepared = (async () => {
    if (!pass || backupIsEncrypted(raw)) return raw;
    if (new TextDecoder().decode(new TextEncoder().encode(raw)) !== raw) throw new Error("Recovery data cannot be encoded without loss.");
    return JSON.stringify(await encrypt(raw, pass));
  })();
  // Preparation can run alongside active encryption. Handle rejection even if that encryption fails first.
  void prepared.catch(() => {
    if (backupWork?.prepared === prepared) backupWork = undefined;
  });
  return backupWork = { source, raw, revision, prepared };
}
async function commitBackup(work: NonNullable<typeof backupWork> | undefined, revision: number) {
  if (!work) return;
  const protectedRaw = await work.prepared;
  guard(revision);
  if (!work.commit) {
    if (committed(UNREADABLE_KEY) !== work.source) throw cancelled();
    work.commit = protectedRaw === work.source ? Promise.resolve() : strictWrite(UNREADABLE_KEY, protectedRaw);
  }
  try {
    await work.commit;
  } catch (error) {
    if (backupWork === work) backupWork = undefined;
    throw error;
  }
  guard(revision);
  if (committed(UNREADABLE_KEY) !== protectedRaw) throw cancelled();
}

/** Resolve current recovery bytes, never the original notice's plaintext closure. */
export function recoveryDownload(): string | null {
  if (protectionStatus === "pending") return null;
  // No memory fallback for a removed/failed durable backup.
  try { return committed(UNREADABLE_KEY); } catch { return null; }
}

interface Persisted {
  assessment?: Assessment;
  /** Only ever set on the way in, for progress written by a newer crownguard; merged into the store's flag. */
  readOnly?: boolean;
}

/** The storage is async when a passphrase is set (WebCrypto); plain path stays a resolved promise. */
type CheckedStorage = PersistStorage<Persisted>;

const decode = (value: string | null): StorageValue<Persisted> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as StorageValue<Persisted>;
  } catch {
    return null;
  }
};

async function validateStored(stored: StorageValue<Persisted>, raw: string, name: string): Promise<StorageValue<Persisted> | null> {
  // `readOnly` is decided here, never taken from what's stored.
  const state: Persisted = { ...stored.state };
  delete state.readOnly;
  stored = { ...stored, state };
  const assessment = state.assessment;
  if (!assessment) return stored;

  const parsed = parseAssessment(assessment, { questionIds: allQuestionIds });
  if (parsed.kind === "error") {
    await setAside(name, raw, `The progress saved ${HERE} couldn't be read (${parsed.issues[0] ?? parsed.message}).`);
    return null;
  }

  if (parsed.kind === "newer") {
    const ahead = `The progress saved ${HERE} was written by a newer version of crownguard (format ${parsed.schemaVersion}; this one reads format ${SCHEMA_VERSION}).`;
    if (!parsed.assessment) {
      await setAside(name, raw, `${ahead} This version can't read it${parsed.issues[0] ? ` (${parsed.issues[0]})` : ""}.`);
      return null;
    }
    // Same as opening a newer file: show it, but never write this build's understanding of it back over the original.
    setStorageReadOnly(true);
    rehydration.push({ kind: "warn", text: `${ahead} It has been opened read-only, so nothing will be saved over it. Reload the page to update crownguard.` });
    for (const n of parsed.notices) rehydration.push({ kind: n.kind === "warn" ? "warn" : "info", text: n.text });
    return { ...stored, state: { ...state, assessment: parsed.assessment, readOnly: true } };
  }

  for (const n of parsed.notices) rehydration.push({ kind: n.kind === "warn" ? "warn" : "info", text: n.text });
  return { ...stored, state: { ...state, assessment: parsed.assessment } };
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
      await setAside(name, raw, `The progress saved ${HERE} couldn't be read (it isn't valid JSON).`);
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
          text: `Wrong passphrase, or the encrypted progress ${HERE} is damaged. Nothing has been loaded.`,
        });
        return null;
      }
      setLockedEnvelope(null);
      const stored = decode(plain);
      if (!stored) {
        await setAside(name, raw, `The encrypted progress ${HERE} couldn't be read after decrypting.`);
        return null;
      }
      return validateStored(stored, raw, name);
    }

    const stored = parsed as StorageValue<Persisted>;
    if (!stored || typeof stored !== "object") {
      await setAside(name, raw, `The progress saved ${HERE} couldn't be read (it isn't valid JSON).`);
      return null;
    }
    return validateStored(stored, raw, name);
  },
  setItem: (name, value) => {
    if (readOnly || recoveryBlocked || recovering) return;
    const pass = getSessionPassphrase();
    if (!pass) {
      encryptGeneration++;
      write(name, JSON.stringify(value));
      return;
    }
    const revision = protectionRevision;
    const mayConfirm = protectionStatus !== "error" && explicitRevision !== revision;
    if (mayConfirm) status("pending");
    return saveProtected(name, value, pass, revision).then((saved) => {
      if (saved && mayConfirm && revision === protectionRevision && protectionStatus !== "error") status(ephemeral() ? "session" : "protected");
    }).catch(() => {
      if (revision === protectionRevision) { writeFailed = true; status("error"); }
    });
  },
  removeItem: (name) => {
    if (readOnly) return;
    dropProgress(name);
  },
};

/** Prepare both ciphertexts before replacing either key; acknowledge backup before active progress. */
async function saveProtected(name: string, value: StorageValue<Persisted>, pass: string | null, revision: number): Promise<boolean> {
  guard(revision);
  if (removals.size) await Promise.all(removals);
  guard(revision);
  const generation = ++encryptGeneration;
  // Leaving ephemeral mode must restore recovery even when active progress has no passphrase.
  const work = pass || restoreSessionBackup ? prepareBackup(pass, revision) : undefined;
  const json = JSON.stringify(value);
  const active = pass ? JSON.stringify(await encrypt(json, pass)) : json;
  guard(revision);
  if (pass && !work && committed(UNREADABLE_KEY) !== null) throw cancelled();
  await commitBackup(work, revision);
  guard(revision);
  if (generation !== encryptGeneration) return false;
  await strictWrite(name, active);
  guard(revision);
  // A changed or newly introduced recovery copy during active IPC invalidates completion too.
  if (pass && !work && committed(UNREADABLE_KEY) !== null) throw cancelled();
  await commitBackup(work, revision);
  guard(revision);
  if (generation !== encryptGeneration) return false;
  if (ephemeral()) await confirmEphemeralRemoval();
  guard(revision);
  writeFailed = false;
  return true;
}

/** Explicit Apply/clear, using the store's current partialisation and version on every retry. */
export async function rewriteProtection(pass: string | null, value: () => StorageValue<Persisted>): Promise<boolean> {
  if (readOnly || recoveryBlocked || recovering) {
    status("error");
    return false;
  }
  const previousPass = getSessionPassphrase();
  invalidateProtection();
  setSessionPassphrase(pass);
  const revision = protectionRevision;
  explicitRevision = revision;
  status("pending");
  try {
    if (ephemeral()) await confirmEphemeralRemoval();
    // Edits may supersede active encryption, but do not restart the shared backup conversion.
    while (!await saveProtected(STORAGE_KEY, value(), pass, revision)) guard(revision);
    guard(revision);
    status(ephemeral() ? "session" : pass ? "protected" : "plain");
    return true;
  } catch {
    if (revision === protectionRevision) {
      // A failed clear may have left active ciphertext on disk. Keep its key for retry and file saving.
      if (pass === null) setSessionPassphrase(previousPass);
      writeFailed = true;
      status("error");
    }
    return false;
  } finally {
    if (explicitRevision === revision) explicitRevision = undefined;
  }
}

/** Acknowledge recovery before removing its source. A different existing backup is never disposable. */
async function setAside(name: string, raw: string, text: string) {
  const revision = protectionRevision;
  recovering = true;
  try {
    guard(revision);
    const existing = committed(UNREADABLE_KEY);
    if (existing !== null && existing !== raw) throw new Error("Another recovery copy already exists.");
    const work = prepareBackup(getSessionPassphrase(), revision, raw);
    await work?.prepared;
    guard(revision);
    if (committed(name) !== raw) throw cancelled();
    await commitBackup(work, revision);
    guard(revision);
    if (committed(name) !== raw) throw cancelled();
    if (!memoryOnly(name)) {
      const store = disk();
      if (!store) throw new Error("Local storage unavailable.");
      await store.removeItem(name);
    }
    guard(revision);
    memory.delete(name);
    setLockedEnvelope(null);
    rehydration.push({ kind: "error", text: `${text} It has been kept aside so you can download it, and a fresh assessment has been started.`, backup: true });
  } catch {
    if (revision !== protectionRevision) {
      // An explicit removal already owns the source. Its own acknowledgement reports failure.
      if (removals.size) return;
      try { if (committed(name) !== raw) return; } catch { /* Keep writes blocked when source cannot be checked. */ }
    }
    recoveryBlocked = true;
    writeFailed = true;
    status("error");
    rehydration.push({ kind: "error", text: `${text} Recovery could not be saved safely. Existing data has been retained. Local writes are blocked until you explicitly forget this data or reload to retry.`, backup: unreadableBackup() !== null });
  } finally {
    recovering = false;
  }
}
