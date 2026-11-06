import { afterEach, describe, expect, it, vi } from "vitest";
import type { Assessment } from "../format/schema";
import * as crypto from "../format/crypto";
import {
  checkedStorage,
  dropProgress,
  readProgress,
  rehydrateNotices,
  setEphemeralMode,
  setStorageReadOnly,
  STORAGE_KEY,
  storageWriteFailed,
  UNREADABLE_KEY,
  unreadableBackup,
  writeProgress,
} from "./persistence";
import { setSessionPassphrase } from "./sessionSecrets";
import { emptyAssessment } from "../format/empty";

const named = (name: string): Assessment => ({ ...emptyAssessment(), org: { ...emptyAssessment().org, name } });

/** Hold the first encrypt until released, so a test can do something else while it's in flight. */
function gateFirstEncrypt() {
  const actual = crypto.encrypt;
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(crypto, "encrypt").mockImplementation(async (plaintext, pass) => {
    calls += 1;
    if (calls === 1) await gate;
    return actual(plaintext, pass);
  });
  return { release, spy };
}

/** A localStorage stand-in whose writes can be made to fail like a full quota. */
function fakeDisk() {
  const items = new Map<string, string>();
  const disk = {
    full: false,
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (disk.full) throw new DOMException("quota", "QuotaExceededError");
      items.set(k, v);
    },
    removeItem: (k: string) => void items.delete(k),
  };
  vi.stubGlobal("localStorage", disk);
  return disk;
}

afterEach(() => {
  setSessionPassphrase(null);
  setEphemeralMode(false);
  setStorageReadOnly(false);
  dropProgress(STORAGE_KEY);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("encrypted saves still in flight", () => {
  it("never land after the user removed their progress", async () => {
    const { release } = gateFirstEncrypt();
    setSessionPassphrase("clear-pass-1234");
    const pending = checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Removed Co") }, version: 4 });
    // What "Remove from this browser" does: reset (the save above), drop, forget the passphrase.
    dropProgress(STORAGE_KEY);
    setSessionPassphrase(null);
    release();
    await pending;
    expect(readProgress(STORAGE_KEY)).toBeNull();
  });

  it("never land over a newer plain save after protection is removed", async () => {
    const { release } = gateFirstEncrypt();
    setSessionPassphrase("old-pass-1234");
    const pending = checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Old Co") }, version: 4 });
    setSessionPassphrase(null);
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("New Co") }, version: 4 });
    release();
    await pending;
    const raw = readProgress(STORAGE_KEY)!;
    expect(crypto.isEncryptedEnvelope(JSON.parse(raw))).toBe(false);
    expect((await checkedStorage.getItem(STORAGE_KEY))?.state.assessment?.org.name).toBe("New Co");
  });
});

describe("progress from a newer crownguard", () => {
  it("opens read-only when this build can read it, and writes nothing back", async () => {
    const ahead = { ...named("Future Co"), schemaVersion: 99 };
    const raw = JSON.stringify({ state: { assessment: ahead }, version: 4 });
    writeProgress(STORAGE_KEY, raw);
    const stored = await checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.state.assessment?.org.name).toBe("Future Co");
    expect(stored?.state.readOnly).toBe(true);
    expect(rehydrateNotices().some((n) => n.kind === "warn" && /newer version of crownguard \(format 99/.test(n.text))).toBe(true);

    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Downgraded") }, version: 4 });
    expect(readProgress(STORAGE_KEY)).toBe(raw);
  });

  it("is kept aside, not loaded as nothing, when this build can't read it", async () => {
    const raw = JSON.stringify({ state: { assessment: { schemaVersion: 99, org: "unknowable" } }, version: 4 });
    writeProgress(STORAGE_KEY, raw);
    expect(await checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(unreadableBackup()).toBe(raw);
    expect(rehydrateNotices().at(-1)).toMatchObject({ kind: "error", backup: raw });
  });

  it("never takes the read-only flag from what's stored", async () => {
    writeProgress(STORAGE_KEY, JSON.stringify({ state: { assessment: named("Now Co"), readOnly: true }, version: 4 }));
    const stored = await checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.state.assessment?.org.name).toBe("Now Co");
    expect(stored?.state).not.toHaveProperty("readOnly");
  });
});

describe("the copy kept aside when progress can't be read", () => {
  it("is removed with the progress", async () => {
    writeProgress(STORAGE_KEY, "{not json");
    await checkedStorage.getItem(STORAGE_KEY);
    expect(unreadableBackup()).toBe("{not json");
    dropProgress(STORAGE_KEY);
    expect(unreadableBackup()).toBeNull();

    writeProgress(STORAGE_KEY, "{still not json");
    await checkedStorage.getItem(STORAGE_KEY);
    checkedStorage.removeItem(STORAGE_KEY);
    expect(unreadableBackup()).toBeNull();
  });

  it("stays off disk while the browser isn't keeping the assessment", async () => {
    const disk = fakeDisk();
    writeProgress(STORAGE_KEY, "{not json");
    await checkedStorage.getItem(STORAGE_KEY);
    expect(disk.items.get(UNREADABLE_KEY)).toBe("{not json");

    setEphemeralMode(true);
    expect(disk.items.has(UNREADABLE_KEY)).toBe(false);
    // Still downloadable for this session.
    expect(unreadableBackup()).toBe("{not json");

    writeProgress(STORAGE_KEY, "{again");
    await checkedStorage.getItem(STORAGE_KEY);
    expect(disk.items.has(UNREADABLE_KEY)).toBe(false);
    expect(disk.items.has(STORAGE_KEY)).toBe(false);
  });
});

describe("a browser that won't take the save", () => {
  it("says so until a save gets through", async () => {
    const disk = fakeDisk();
    disk.full = true;
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Full Co") }, version: 4 });
    expect(storageWriteFailed()).toBe(true);
    // The session keeps working from memory.
    expect((await checkedStorage.getItem(STORAGE_KEY))?.state.assessment?.org.name).toBe("Full Co");

    disk.full = false;
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Room Co") }, version: 4 });
    expect(storageWriteFailed()).toBe(false);
    expect(disk.items.get(STORAGE_KEY)).toContain("Room Co");
  });
});
