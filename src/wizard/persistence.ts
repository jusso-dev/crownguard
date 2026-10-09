import type { PersistStorage, StorageValue } from "zustand/middleware";
import type { Assessment } from "../engine/types";
import { questionIdSet } from "../content/questionIds";
import { parseAssessment } from "./parseAssessment";

export const STORAGE_KEY = "crownguard:v1";
/** Where a stored assessment is moved when it can't be read, so the user can still download it. */
export const UNREADABLE_KEY = `${STORAGE_KEY}:unreadable`;

/**
 * Opened a file this build must not overwrite: every write to storage is dropped until the page is reloaded.
 * The assessment the user is looking at is never written back over their own progress.
 */
let readOnly = false;
export const setStorageReadOnly = (value: boolean) => {
  readOnly = value;
};

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
const read = (name: string): string | null => {
  try {
    return disk()?.getItem(name) ?? memory.get(name) ?? null;
  } catch {
    return memory.get(name) ?? null;
  }
};
const write = (name: string, value: string) => {
  memory.set(name, value);
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

/** The stored value kept aside when progress couldn't be read, if there is one. */
export const unreadableBackup = (): string | null => read(UNREADABLE_KEY);

export interface Persisted {
  assessment?: Assessment;
}

/** The storage is synchronous (it is `localStorage`, or memory), whatever `PersistStorage` allows. */
export type CheckedStorage = Omit<PersistStorage<Persisted>, "getItem"> & {
  getItem: (name: string) => StorageValue<Persisted> | null;
};

const decode = (value: string | null): StorageValue<Persisted> | null => {
  if (!value) return null;
  try {
    return JSON.parse(value) as StorageValue<Persisted>;
  } catch {
    return null;
  }
};

/**
 * Progress storage, checked on the way in and gated on the way out.
 *
 * Anything in this key is untrusted input: it can be stale, hand-edited, or written by another app that shares the
 * origin's storage. It is migrated and validated exactly like an opened file before it reaches the UI. When it can't
 * be read it is moved aside rather than deleted, and the app starts clean with a notice and a copy to download.
 */
export const checkedStorage: CheckedStorage = {
  getItem: (name) => {
    const raw = read(name);
    if (raw === null) return null;
    const stored = decode(raw);
    if (!stored) {
      setAside(name, raw, "The progress saved in this browser couldn't be read (it isn't valid JSON).");
      return null;
    }

    const assessment = stored.state?.assessment;
    if (!assessment) return stored;

    const parsed = parseAssessment(assessment, { questionIds: questionIdSet() });
    if (parsed.kind === "error") {
      setAside(name, raw, `The progress saved in this browser couldn't be read (${parsed.issues[0] ?? parsed.message}).`);
      return null;
    }

    for (const n of parsed.notices) rehydration.push({ kind: n.kind === "warn" ? "warn" : "info", text: n.text });
    return { ...stored, state: { ...stored.state, assessment: parsed.assessment } };
  },
  setItem: (name, value) => {
    if (readOnly) return;
    write(name, JSON.stringify(value));
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
  rehydration.push({ kind: "error", text: `${text} It has been kept aside so you can download it, and a fresh assessment has been started.`, backup: raw });
}
