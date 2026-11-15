import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_VERSION, type Assessment } from "../format/schema";
import * as crypto from "../format/crypto";
import {
  checkedStorage,
  invalidateProtection,
  dropProgress,
  readProgress,
  rehydrateNotices,
  protectionSnapshot,
  recoveryDownload,
  rewriteProtection,
  setEphemeralMode,
  setStorageReadOnly,
  STORAGE_KEY,
  storageWriteFailed,
  subscribeProtection,
  UNREADABLE_KEY,
  unreadableBackup,
  writeProgress,
} from "./persistence";
import { getSessionPassphrase, setLockedEnvelope, setSessionPassphrase } from "./sessionSecrets";
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
    removeItem: (k: string): void => { items.delete(k); },
  };
  vi.stubGlobal("localStorage", disk);
  return disk;
}

beforeEach(() => { fakeDisk(); });

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
    expect(rehydrateNotices().at(-1)).toMatchObject({ kind: "error", backup: true });
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

describe("progress saved in this browser", () => {
  it("validates it like an opened file, and keeps the answers it doesn't recognise", async () => {
    const a: Assessment = { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "Stored Co" }, answers: { "MS-ID-001": "no", GONE: "yes" } };
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: a }, version: 2 });
    const stored = await checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.state.assessment).toMatchObject({ org: { name: "Stored Co" } });
    expect(stored?.state.assessment?.answers).toEqual({ "MS-ID-001": "no" });
    expect(stored?.state.assessment?.orphans).toEqual({ GONE: { answer: "yes" } });
  });

  it("starts clean when the stored progress can't be read, and keeps it for download", async () => {
    const unreadable = { org: "nonsense" } as unknown as Assessment;
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: unreadable }, version: 2 });
    expect(await checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(unreadableBackup()).toContain("nonsense");
  });

  it("does the same for progress that isn't even valid JSON", async () => {
    writeProgress(STORAGE_KEY, "{not json");
    expect(await checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(unreadableBackup()).toBe("{not json");
  });

  it("does not let a slower passphrase save overwrite a newer one", async () => {
    const actual = crypto.encrypt;
    let calls = 0;
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const spy = vi.spyOn(crypto, "encrypt").mockImplementation(async (plaintext, pass) => {
      calls += 1;
      if (calls === 1) await gate;
      return actual(plaintext, pass);
    });
    setSessionPassphrase("race-pass-1234");
    const stale = { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "Stale Co" } };
    const fresh = { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "Fresh Co" } };
    const first = checkedStorage.setItem(STORAGE_KEY, { state: { assessment: stale }, version: 3 });
    const second = checkedStorage.setItem(STORAGE_KEY, { state: { assessment: fresh }, version: 3 });
    releaseFirst();
    await Promise.all([first, second]);
    const stored = await checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.state.assessment?.org.name).toBe("Fresh Co");
    setSessionPassphrase(null);
    dropProgress(STORAGE_KEY);
    spy.mockRestore();
  });

  it("writes nothing while a newer file is open read-only", async () => {
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: emptyAssessment() }, version: 2 });
    setStorageReadOnly(true);
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: { ...emptyAssessment(), updatedAt: "later" } }, version: 2 });
    checkedStorage.removeItem(STORAGE_KEY);
    setStorageReadOnly(false);
    expect((await checkedStorage.getItem(STORAGE_KEY))?.state.assessment?.updatedAt).not.toBe("later");
  });
});

/**
 * Progress as this app autosaved it under a passphrase at commit 0e5fdf0: the zustand value
 * `{ state: { assessment }, version: 4 }`, encrypted once and never regenerated. The passphrase is public and
 * synthetic. A change that makes these fail has locked people out of progress already in their browser.
 */
describe("frozen encrypted progress", () => {
  const FIXTURE_PASSPHRASE = "crownguard-public-fixture-passphrase";
  const fixtureText = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
  const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

  it("unlocks with its passphrase and comes back whole", async () => {
    const raw = fixtureText("encrypted-progress-v1.json");
    expect(sha256(raw)).toBe("0181d825ea807f4f6e0dd9372f9d77f856bd12923ad2008e81f9e08bf3054a20");
    const expected = JSON.parse(fixtureText("schema5.crownguard.json")) as Record<string, unknown>;
    expect(await crypto.decrypt(JSON.parse(raw), FIXTURE_PASSPHRASE)).toBe(JSON.stringify({ state: { assessment: expected }, version: 4 }));

    writeProgress(STORAGE_KEY, raw);
    setSessionPassphrase(FIXTURE_PASSPHRASE);
    const stored = await checkedStorage.getItem(STORAGE_KEY);
    expect(stored?.version).toBe(4);
    expect(JSON.parse(JSON.stringify(stored?.state.assessment))).toEqual({ ...expected, schemaVersion: SCHEMA_VERSION });
    expect(stored?.state.assessment?.progress).toEqual({ step: 3, section: "microsoft:identity", socSection: "people", aiSection: "register", layout: 2 });
    // Reading it changes nothing on disk.
    expect(readProgress(STORAGE_KEY)).toBe(raw);
    expect(unreadableBackup()).toBeNull();
  });

  it("stays locked, and is not set aside, under the wrong passphrase", async () => {
    const raw = fixtureText("encrypted-progress-v1.json");
    writeProgress(STORAGE_KEY, raw);
    setSessionPassphrase("not-the-fixture-passphrase");
    expect(await checkedStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readProgress(STORAGE_KEY)).toBe(raw);
    expect(unreadableBackup()).toBeNull();
    setLockedEnvelope(null);
  });
});


describe("opaque recovery protection", () => {
  it("acknowledges encrypted backup on durable storage before completing protection", async () => {
    const disk = fakeDisk();
    const raw = "  {broken: 秘密\r\n";
    writeProgress(STORAGE_KEY, raw);
    await checkedStorage.getItem(STORAGE_KEY);
    setSessionPassphrase("recovery-pass-1234");
    await checkedStorage.setItem(STORAGE_KEY, { state: { assessment: named("Still intact") }, version: 4 });
    const backup = disk.items.get(UNREADABLE_KEY)!;
    expect(backup).not.toBe(raw);
    expect(await crypto.decrypt(JSON.parse(backup), "recovery-pass-1234")).toBe(raw);
    const active = JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "recovery-pass-1234"));
    expect(active.state.assessment.org.name).toBe("Still intact");
  });
});


const currentValue = () => ({ state: { assessment: named("Current Co") }, version: 4 });

describe("recovery protection boundaries", () => {
  it.each(["new assessment", "different file passphrase"])("confirms protection after %s without hiding genuine failures", async (transition) => {
    const disk = fakeDisk();
    const { useStore } = await import("./store");
    await useStore.persist.rehydrate();
    expect(await rewriteProtection("original-passphrase", currentValue)).toBe(true);
    const saves: Promise<unknown>[] = [];
    const setItem = checkedStorage.setItem;
    vi.spyOn(checkedStorage, "setItem").mockImplementation((name, value) => {
      const saved = setItem(name, value);
      saves.push(Promise.resolve(saved));
      return saved;
    });

    if (transition === "new assessment") useStore.getState().reset();
    else {
      setSessionPassphrase("file-passphrase");
      useStore.getState().load(named("Opened file"));
    }
    expect(saves).toHaveLength(1);
    await Promise.all(saves);
    const saved = JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), getSessionPassphrase()!));
    expect(saved.state.assessment.org.name).toBe(transition === "new assessment" ? "" : "Opened file");
    expect(storageWriteFailed()).toBe(false);
    expect(protectionSnapshot()).toBe("protected");
  });

  it.each(["plaintext", "encrypted"])("restores %s recovery after leaving ephemeral mode without an active passphrase", async (kind) => {
    const disk = fakeDisk();
    const raw = kind === "plaintext" ? "  {original recovery\r\n" : readFileSync(new URL("../../e2e/fixtures/encrypted-progress-v1.json", import.meta.url), "utf8");
    disk.items.set(UNREADABLE_KEY, raw);
    setEphemeralMode(true);
    expect(await rewriteProtection(null, currentValue)).toBe(true);
    expect(recoveryDownload()).toBe(raw);
    expect(disk.items.has(UNREADABLE_KEY)).toBe(false);

    setEphemeralMode(false);
    expect(await rewriteProtection(null, currentValue)).toBe(true);
    expect(protectionSnapshot()).toBe("plain");
    expect(disk.items.get(UNREADABLE_KEY)).toBe(raw);
    expect(unreadableBackup()).toBe(raw);
    expect(recoveryDownload()).toBe(raw);
  });

  it.each(["", " \r\n{bad 秘密 🐦", '{"state":{"assessment":{"schemaVersion":99,"org":"unknown"}}}', '{"crownguardEncrypted":7,"unknown":true}'])("round-trips opaque bytes %j", async (raw) => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, raw);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(true);
    expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "new-passphrase")).toBe(raw);
    expect(protectionSnapshot()).toBe("protected");
  });

  it("preserves a frozen encrypted backup through apply, change and clear", async () => {
    const disk = fakeDisk();
    const raw = readFileSync(new URL("../../e2e/fixtures/encrypted-progress-v1.json", import.meta.url), "utf8");
    disk.items.set(UNREADABLE_KEY, raw);
    for (const pass of ["new-passphrase", "another-passphrase", null]) {
      expect(await rewriteProtection(pass, currentValue)).toBe(true);
      expect(disk.items.get(UNREADABLE_KEY)).toBe(raw);
    }
    expect(await crypto.decrypt(JSON.parse(raw), "crownguard-public-fixture-passphrase")).toContain("Schema Five Co");
    await expect(crypto.decrypt(JSON.parse(raw), "new-passphrase")).rejects.toThrow();
  });

  it("protects set-aside data when a session already has a key", async () => {
    const disk = fakeDisk();
    disk.items.set(STORAGE_KEY, "{unreadable");
    setSessionPassphrase("existing-passphrase");
    await checkedStorage.getItem(STORAGE_KEY);
    expect(disk.items.has(STORAGE_KEY)).toBe(false);
    expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "existing-passphrase")).toBe("{unreadable");
  });

  it("shares backup conversion across a newer active edit", async () => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "{raw");
    const gate = gateFirstEncrypt();
    let value = currentValue();
    const applied = rewriteProtection("new-passphrase", () => value);
    value = { state: { assessment: named("Newest Co") }, version: 4 };
    const edit = checkedStorage.setItem(STORAGE_KEY, value);
    gate.release();
    await edit;
    expect(await applied).toBe(true);
    expect((await checkedStorage.getItem(STORAGE_KEY))?.state.assessment?.org.name).toBe("Newest Co");
    expect(gate.spy.mock.calls.filter(([raw]) => raw === "{raw")).toHaveLength(1);
  });

  it.each(["clear", "new key", "forget", "read-only", "ephemeral", "replace"])("cancels pending conversion on %s", async (change) => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "{raw");
    const gate = gateFirstEncrypt();
    const old = rewriteProtection("old-passphrase", currentValue);
    let newer: Promise<boolean> | undefined;
    if (change === "clear") newer = rewriteProtection(null, currentValue);
    if (change === "new key") newer = rewriteProtection("new-passphrase", currentValue);
    if (change === "forget") { dropProgress(STORAGE_KEY); setSessionPassphrase(null); }
    if (change === "read-only") setStorageReadOnly(true);
    if (change === "ephemeral") setEphemeralMode(true);
    if (change === "replace") disk.items.set(UNREADABLE_KEY, "{replacement");
    if (newer) expect(await newer).toBe(true);
    gate.release();
    expect(await old).toBe(false);
    if (change === "forget" || change === "ephemeral") {
      expect(disk.items.has(UNREADABLE_KEY)).toBe(false);
      expect(disk.items.has(STORAGE_KEY)).toBe(false);
    } else if (change === "new key") {
      expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "new-passphrase")).toBe("{raw");
    } else expect(disk.items.get(UNREADABLE_KEY)).toBe(change === "replace" ? "{replacement" : "{raw");
  });

  it.each(["backup", "active", "encrypt"])("keeps recovery on %s failure and retries", async (failure) => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "{original");
    disk.items.set(STORAGE_KEY, JSON.stringify(currentValue()));
    const set = disk.setItem;
    const spy = vi.spyOn(disk, "setItem").mockImplementation((key, value) => {
      if (key === (failure === "backup" ? UNREADABLE_KEY : STORAGE_KEY) && failure !== "encrypt") throw new Error("quota");
      set(key, value);
    });
    const encryption = failure === "encrypt" ? vi.spyOn(crypto, "encrypt").mockRejectedValue(new Error("crypto unavailable")) : undefined;
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    expect(protectionSnapshot()).toBe("error");
    expect(disk.items.get(STORAGE_KEY)).toContain("Current Co");
    if (failure === "active") expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "new-passphrase")).toBe("{original");
    else expect(disk.items.get(UNREADABLE_KEY)).toBe("{original");
    spy.mockRestore();
    encryption?.mockRestore();
    // Later ordinary saves cannot erase the failed privacy operation's status.
    await checkedStorage.setItem(STORAGE_KEY, currentValue());
    expect(protectionSnapshot()).toBe("error");
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(true);
  });

  it.each(["backup write", "active removal", "different backup"])("retains source and blocks blank autosave after %s failure", async (failure) => {
    const disk = fakeDisk();
    disk.items.set(STORAGE_KEY, "{source");
    if (failure === "different backup") disk.items.set(UNREADABLE_KEY, "{earlier");
    if (failure === "backup write") disk.full = true;
    if (failure === "active removal") vi.spyOn(disk, "removeItem").mockImplementation(() => { throw new Error("locked"); });
    await checkedStorage.getItem(STORAGE_KEY);
    await checkedStorage.setItem(STORAGE_KEY, currentValue());
    expect(disk.items.get(STORAGE_KEY)).toBe("{source");
    expect(disk.items.get(UNREADABLE_KEY)).toBe(failure === "different backup" ? "{earlier" : failure === "active removal" ? "{source" : undefined);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    expect(rehydrateNotices().at(-1)?.text).toContain("Local writes are blocked");
  });

  it("rejects lossy encoding and unavailable or throwing storage", async () => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "bad \ud800");
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    expect(disk.items.get(UNREADABLE_KEY)).toBe("bad \ud800");
    vi.spyOn(disk, "getItem").mockImplementation(() => { throw new Error("denied"); });
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    vi.stubGlobal("localStorage", undefined);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
  });

  it("keeps read-only keys unchanged and protects ephemeral downloads without claiming durability", async () => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "{raw");
    disk.items.set(STORAGE_KEY, "original");
    setStorageReadOnly(true);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    expect([...disk.items.values()]).toEqual(["{raw", "original"]);
    setStorageReadOnly(false);
    setEphemeralMode(true);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(true);
    expect(protectionSnapshot()).toBe("session");
    expect(disk.items.has(UNREADABLE_KEY)).toBe(false);
    expect(disk.items.has(STORAGE_KEY)).toBe(false);
    expect(await crypto.decrypt(JSON.parse(recoveryDownload()!), "new-passphrase")).toBe("{raw");
    setEphemeralMode(false);
    expect(protectionSnapshot()).not.toBe("protected");
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(true);
    expect(disk.items.get(UNREADABLE_KEY)).toBe(recoveryDownload());
  });

  it("does not report session-only safety after failed disk removal", async () => {
    const disk = fakeDisk();
    disk.items.set(UNREADABLE_KEY, "{raw");
    vi.spyOn(disk, "removeItem").mockImplementation(() => { throw new Error("locked"); });
    setEphemeralMode(true);
    expect(await rewriteProtection("new-passphrase", currentValue)).toBe(false);
    expect(disk.items.get(UNREADABLE_KEY)).toBe("{raw");
  });
});


it("failed clear retains the key for active ciphertext and can retry", async () => {
  const disk = fakeDisk();
  disk.items.set(UNREADABLE_KEY, "{raw");
  expect(await rewriteProtection("original-passphrase", currentValue)).toBe(true);
  const before = new Map(disk.items);
  disk.full = true;
  expect(await rewriteProtection(null, currentValue)).toBe(false);
  expect(getSessionPassphrase()).toBe("original-passphrase");
  expect(disk.items).toEqual(before);
  expect(protectionSnapshot()).toBe("error");
  disk.full = false;
  expect(await rewriteProtection(null, currentValue)).toBe(true);
  expect(disk.items.get(UNREADABLE_KEY)).toBe(before.get(UNREADABLE_KEY));
});

it("a cancelled set-aside cannot permit blank autosave over its retained source", async () => {
  const disk = fakeDisk();
  disk.items.set(STORAGE_KEY, "{source");
  setSessionPassphrase("original-passphrase");
  const gate = gateFirstEncrypt();
  const hydration = checkedStorage.getItem(STORAGE_KEY);
  setSessionPassphrase("new-passphrase");
  gate.release();
  await hydration;
  await checkedStorage.setItem(STORAGE_KEY, currentValue());
  expect(disk.items.get(STORAGE_KEY)).toBe("{source");
  expect(protectionSnapshot()).toBe("error");
});


it.each([null, "{old backup"])("rechecks backup %j after active acknowledgement", async (backup) => {
  const disk = fakeDisk();
  if (backup !== null) disk.items.set(UNREADABLE_KEY, backup);
  const original = disk.setItem;
  let release!: () => void;
  vi.spyOn(disk, "setItem").mockImplementation((key, value) => {
    if (key === STORAGE_KEY) return new Promise<void>((resolve) => {
      release = () => { original(key, value); resolve(); };
    });
    original(key, value);
  });
  const pending = rewriteProtection("new-passphrase", currentValue);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  disk.items.set(UNREADABLE_KEY, "{replacement during active write");
  release();
  expect(await pending).toBe(false);
  expect(protectionSnapshot()).toBe("error");
  expect(disk.items.get(UNREADABLE_KEY)).toBe("{replacement during active write");
});

it("does not resurrect a removed durable backup from an old memory copy", async () => {
  const disk = fakeDisk();
  disk.items.set(STORAGE_KEY, "{raw");
  await checkedStorage.getItem(STORAGE_KEY);
  disk.items.delete(UNREADABLE_KEY);
  expect(recoveryDownload()).toBeNull();
  expect(await rewriteProtection("new-passphrase", currentValue)).toBe(true);
  expect(disk.items.has(UNREADABLE_KEY)).toBe(false);
});


it("cancelled recovery cannot re-block writes after queued forget succeeds", async () => {
  const disk = fakeDisk();
  disk.items.set(STORAGE_KEY, "{source");
  setSessionPassphrase("original-passphrase");
  const gate = gateFirstEncrypt();
  const hydration = checkedStorage.getItem(STORAGE_KEY);
  const releases: (() => void)[] = [];
  const pending: Promise<void>[] = [];
  vi.spyOn(disk, "removeItem").mockImplementation((key) => {
    const removal = new Promise<void>((resolve) => { releases.push(() => { disk.items.delete(key); resolve(); }); });
    pending.push(removal);
    return removal;
  });
  dropProgress(STORAGE_KEY);
  gate.release();
  await hydration;
  for (const release of releases) release();
  await Promise.all(pending);
  await checkedStorage.setItem(STORAGE_KEY, currentValue());
  expect(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "original-passphrase")).toContain("Current Co");
  vi.restoreAllMocks();
});

it("an unrelated flag removal cannot unblock cancelled recovery over its retained source", async () => {
  const disk = fakeDisk();
  disk.items.set(STORAGE_KEY, "{source");
  setSessionPassphrase("original-passphrase");
  const gate = gateFirstEncrypt();
  const hydration = checkedStorage.getItem(STORAGE_KEY);
  let release!: () => void;
  const remove = disk.removeItem;
  vi.spyOn(disk, "removeItem").mockImplementation((key) => {
    if (key !== "crownguard:v1:ephemeral") return remove(key);
    return new Promise<void>((resolve) => { release = () => { remove(key); resolve(); }; });
  });
  setEphemeralMode(false);
  gate.release();
  await hydration;
  release();
  await checkedStorage.setItem(STORAGE_KEY, currentValue());
  expect(disk.items.get(STORAGE_KEY)).toBe("{source");
  expect(rehydrateNotices().at(-1)?.text).toContain("Local writes are blocked");
  vi.restoreAllMocks();
});


it("retains ephemeral mode on reload when deleting stale disk data throws", async () => {
  const disk = fakeDisk();
  disk.items.set("crownguard:v1:ephemeral", "1");
  disk.items.set(STORAGE_KEY, "{stale");
  vi.spyOn(disk, "removeItem").mockImplementation(() => { throw new Error("locked"); });
  vi.resetModules();
  const fresh = await import("./persistence");
  expect(fresh.isEphemeralMode()).toBe(true);
  expect(fresh.protectionSnapshot()).toBe("error");
  await fresh.checkedStorage.setItem(STORAGE_KEY, currentValue());
  expect(disk.items.get(STORAGE_KEY)).toBe("{stale");
});


/** Fixed gates, released even when an assertion fails. No timing-based ordering. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const microtasks = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
function gatedEncryptions(count = 3) {
  const actual = crypto.encrypt;
  const gates = Array.from({ length: count }, deferred);
  const completed: Promise<unknown>[] = [];
  const spy = vi.spyOn(crypto, "encrypt").mockImplementation((plain, pass) => {
    const index = completed.length;
    const result = (async () => {
      await gates[index]?.promise;
      return actual(plain, pass);
    })();
    completed.push(result);
    return result;
  });
  return {
    spy,
    async release(index: number) { gates[index].resolve(); await completed[index]; await microtasks(); },
    async cleanup() { gates.forEach((g) => g.resolve()); await Promise.allSettled(completed); await microtasks(); },
  };
}
const snapshot = (name: string) => ({ state: { assessment: { ...named(name), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", notes: { "MS-ID-001": `Note ${name}` } } }, version: 4 });

it.each(["notification-passphrase", null])("saves edits made by an explicit success subscriber (pass=%s)", async (pass) => {
  const disk = fakeDisk();
  setSessionPassphrase("previous-passphrase");
  let value = snapshot("Before notification");
  await checkedStorage.setItem(STORAGE_KEY, value);
  let notified = false;
  let edit: unknown;
  const unsubscribe = subscribeProtection(() => {
    if (notified || protectionSnapshot() !== (pass ? "protected" : "plain")) return;
    notified = true;
    value = snapshot("Notification edit");
    edit = checkedStorage.setItem(STORAGE_KEY, value);
  });
  try {
    expect(await rewriteProtection(pass, () => value)).toBe(true);
    expect(notified).toBe(true);
    await edit;
    const raw = disk.items.get(STORAGE_KEY)!;
    expect(JSON.parse(pass ? await crypto.decrypt(JSON.parse(raw), pass) : raw)).toEqual(snapshot("Notification edit"));
    expect(protectionSnapshot()).toBe(pass ? "protected" : "plain");
  } finally {
    unsubscribe();
    await edit;
  }
});

it("coalesces eight overlapping snapshots into two encryptions and one latest commit", async () => {
  const disk = fakeDisk();
  dropProgress(STORAGE_KEY);
  await microtasks();
  setSessionPassphrase("burst-passphrase");
  const gate = gatedEncryptions(8);
  const writes = vi.spyOn(disk, "setItem");
  const pending: unknown[] = [];
  try {
    for (let i = 0; i < 8; i++) pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot(`Revision ${i}`)));
    expect(gate.spy).toHaveBeenCalledTimes(1);
    expect(protectionSnapshot()).toBe("pending");
    await gate.release(0);
    expect(gate.spy).toHaveBeenCalledTimes(2);
    expect(JSON.parse(gate.spy.mock.calls[1][0])).toEqual(snapshot("Revision 7"));
    expect(writes).not.toHaveBeenCalled();
    expect(protectionSnapshot()).toBe("pending");
    await gate.release(1);
    await Promise.all(pending);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(protectionSnapshot()).toBe("protected");
    expect(JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "burst-passphrase"))).toEqual(snapshot("Revision 7"));
  } finally { await gate.cleanup(); await Promise.allSettled(pending); }
});


it("captures pending snapshots at ingress and invalidates the latest encryption on a further edit", async () => {
  const disk = fakeDisk();
  dropProgress(STORAGE_KEY);
  await microtasks();
  setSessionPassphrase("burst-passphrase");
  const gate = gatedEncryptions();
  const writes = vi.spyOn(disk, "setItem");
  const pending: unknown[] = [];
  try {
    pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot("First")));
    const value = snapshot("Second");
    pending.push(checkedStorage.setItem(STORAGE_KEY, value));
    value.state.assessment.org.name = "Mutated after enqueue";
    await gate.release(0);
    expect(JSON.parse(gate.spy.mock.calls[1][0])).toEqual(snapshot("Second"));
    pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot("Third")));
    await gate.release(1);
    expect(writes).not.toHaveBeenCalled();
    expect(protectionSnapshot()).toBe("pending");
    expect(gate.spy).toHaveBeenCalledTimes(3);
    await gate.release(2);
    await Promise.all(pending);
    expect(JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "burst-passphrase"))).toEqual(snapshot("Third"));
  } finally { await gate.cleanup(); await Promise.allSettled(pending); }
});

it.each(["reset", "new key", "forget", "read-only", "backup replacement", "ephemeral"])("retires ordinary waiters and pending work on %s", async (change) => {
  const disk = fakeDisk();
  dropProgress(STORAGE_KEY);
  await microtasks();
  setSessionPassphrase("old-passphrase");
  const gate = gatedEncryptions();
  const pending: unknown[] = [];
  try {
    let settled = 0;
    pending.push(Promise.resolve(checkedStorage.setItem(STORAGE_KEY, snapshot("Old"))).then(() => settled++));
    pending.push(Promise.resolve(checkedStorage.setItem(STORAGE_KEY, snapshot("Discarded"))).then(() => settled++));
    if (change === "reset") invalidateProtection();
    if (change === "new key") setSessionPassphrase("new-passphrase");
    if (change === "forget") dropProgress(STORAGE_KEY);
    if (change === "read-only") setStorageReadOnly(true);
    if (change === "backup replacement") writeProgress(UNREADABLE_KEY, "{replacement");
    if (change === "ephemeral") setEphemeralMode(true);
    await microtasks();
    expect(settled, "retired callers settle without old crypto release").toBe(2);
    if (change === "reset" || change === "new key") {
      let freshSettled = false;
      const fresh = Promise.resolve(checkedStorage.setItem(STORAGE_KEY, snapshot("Fresh"))).then(() => { freshSettled = true; });
      pending.push(fresh);
      expect(gate.spy).toHaveBeenCalledTimes(2);
      await gate.release(0);
      expect(freshSettled, "old cleanup cannot resolve the new drain").toBe(false);
      pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot("Freshest")));
      expect(gate.spy).toHaveBeenCalledTimes(2);
      await gate.release(1);
      expect(gate.spy).toHaveBeenCalledTimes(3);
      await gate.release(2);
      await fresh;
      expect(JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), getSessionPassphrase()!))).toEqual(snapshot("Freshest"));
    } else {
      await gate.release(0);
      expect(gate.spy).toHaveBeenCalledTimes(1);
      expect(disk.items.has(STORAGE_KEY)).toBe(false);
      if (change === "backup replacement") expect(disk.items.get(UNREADABLE_KEY)).toBe("{replacement");
    }
  } finally { await gate.cleanup(); await Promise.allSettled(pending); }
});

it("ends a failed ordinary drain without retrying its pending snapshot; explicit same-key retry restores status", async () => {
  const disk = fakeDisk();
  dropProgress(STORAGE_KEY);
  await microtasks();
  setSessionPassphrase("retry-passphrase");
  const hold = deferred();
  const actual = crypto.encrypt;
  const spy = vi.spyOn(crypto, "encrypt").mockImplementationOnce(async () => { await hold.promise; throw new Error("unavailable"); });
  const pending = [checkedStorage.setItem(STORAGE_KEY, snapshot("First")), checkedStorage.setItem(STORAGE_KEY, snapshot("Pending"))];
  try {
    hold.resolve();
    await Promise.all(pending);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(disk.items.has(STORAGE_KEY)).toBe(false);
    expect(protectionSnapshot()).toBe("error");
    spy.mockImplementation(actual);
    await checkedStorage.setItem(STORAGE_KEY, snapshot("Ordinary success"));
    expect(protectionSnapshot()).toBe("error");
    expect(await rewriteProtection("retry-passphrase", () => snapshot("Retried"))).toBe(true);
    expect(protectionSnapshot()).toBe("protected");
    expect(JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "retry-passphrase"))).toEqual(snapshot("Retried"));
  } finally { hold.resolve(); await Promise.allSettled(pending); }
});

it("explicit Apply owns edits and encrypts recovery once", async () => {
  const disk = fakeDisk();
  disk.items.set(UNREADABLE_KEY, "{opaque recovery");
  const actual = crypto.encrypt;
  const hold = deferred();
  const activeCalls: string[] = [];
  const all: Promise<unknown>[] = [];
  const spy = vi.spyOn(crypto, "encrypt").mockImplementation((raw, pass) => {
    const result = (async () => {
      if (raw !== "{opaque recovery") {
        activeCalls.push(raw);
        if (activeCalls.length === 1) await hold.promise;
      }
      return actual(raw, pass);
    })();
    all.push(result);
    return result;
  });
  let value = snapshot("Initial");
  const applied = rewriteProtection("apply-passphrase", () => value);
  const edits: unknown[] = [];
  try {
    for (let i = 0; i < 8; i++) {
      value = snapshot(`Edit ${i}`);
      edits.push(checkedStorage.setItem(STORAGE_KEY, value));
    }
    expect(activeCalls).toHaveLength(1);
    expect(protectionSnapshot()).toBe("pending");
    hold.resolve();
    expect(await applied).toBe(true);
    await Promise.all(edits);
    expect(activeCalls).toHaveLength(2);
    expect(spy.mock.calls.filter(([raw]) => raw === "{opaque recovery")).toHaveLength(1);
    expect(JSON.parse(await crypto.decrypt(JSON.parse(disk.items.get(STORAGE_KEY)!), "apply-passphrase"))).toEqual(value);
    expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "apply-passphrase")).toBe("{opaque recovery");
  } finally { hold.resolve(); await Promise.allSettled([applied, ...edits, ...all]); }
});

it("rechecks recovery at dispatch and retains its source", async () => {
  const disk = fakeDisk();
  dropProgress(STORAGE_KEY);
  await microtasks();
  setSessionPassphrase("recovery-passphrase");
  const gate = gatedEncryptions();
  const pending: unknown[] = [];
  try {
    pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot("First")));
    pending.push(checkedStorage.setItem(STORAGE_KEY, snapshot("Pending")));
    disk.items.set(STORAGE_KEY, "{source");
    pending.push(checkedStorage.getItem(STORAGE_KEY));
    expect(gate.spy).toHaveBeenCalledTimes(2);
    await gate.release(0);
    expect(gate.spy).toHaveBeenCalledTimes(2);
    expect(disk.items.get(STORAGE_KEY)).toBe("{source");
    await gate.release(1);
    await Promise.all(pending);
    expect(disk.items.has(STORAGE_KEY)).toBe(false);
    expect(await crypto.decrypt(JSON.parse(disk.items.get(UNREADABLE_KEY)!), "recovery-passphrase")).toBe("{source");
  } finally { await gate.cleanup(); await Promise.allSettled(pending); }
});
