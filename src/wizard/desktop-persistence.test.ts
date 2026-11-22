import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Keep IPC local; the real SqliteAutosave owns the queue and acknowledgement ordering.
const tauri = vi.hoisted(() => ({ db: new Map<string, string>() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case "autosave_load":
        return Object.fromEntries(tauri.db);
      case "autosave_set":
        tauri.db.set(args!.key as string, args!.value as string);
        return null;
      case "autosave_remove":
        tauri.db.delete(args!.key as string);
        return null;
      default:
        throw new Error(`Unexpected IPC command: ${cmd}`);
    }
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { decrypt } from "../format/crypto";
import { emptyAssessment } from "../format/empty";
import { platform } from "../platform";
import { SqliteAutosave } from "../platform/tauri";
import { dropProgress, protectionSnapshot, recoveryDownload, rewriteProtection, setEphemeralMode, STORAGE_KEY, UNREADABLE_KEY } from "./persistence";
import { setSessionPassphrase } from "./sessionSecrets";

beforeEach(() => {
  tauri.db.clear();
  vi.clearAllMocks();
});

describe("privacy operations with queued desktop writes", () => {
  let store: SqliteAutosave;
  beforeEach(() => {
    tauri.db.set(UNREADABLE_KEY, "{original");
    store = new SqliteAutosave(Object.fromEntries(tauri.db));
    vi.spyOn(platform, "autosave").mockReturnValue(store);
  });
  afterEach(async () => {
    setSessionPassphrase(null);
    setEphemeralMode(false);
    dropProgress(STORAGE_KEY);
    await store.flush();
    vi.restoreAllMocks();
  });

  it.each([null, "new-passphrase"])("rejects failed ephemeral-flag removal before saving with passphrase %s, then retries", async (pass) => {
    const flag = "crownguard:v1:ephemeral";
    setEphemeralMode(true);
    await store.flush();
    expect(tauri.db.get(flag)).toBe("1");
    const normalInvoke = vi.mocked(invoke).getMockImplementation()!;
    let rejectRemoval!: (reason: Error) => void;
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === "autosave_remove" && (args as { key: string }).key === flag) {
        return new Promise((_, reject) => { rejectRemoval = reject; });
      }
      return normalInvoke(command, args);
    });
    setEphemeralMode(false);
    const value = () => ({ state: { assessment: emptyAssessment() }, version: 4 });
    const saving = rewriteProtection(pass, value);
    await vi.waitFor(() => expect(rejectRemoval).toBeTypeOf("function"));
    rejectRemoval(new Error("locked"));
    const saved = await saving;
    vi.mocked(invoke).mockImplementation(normalInvoke);
    expect(saved).toBe(false);
    expect(protectionSnapshot()).toBe("error");
    expect(tauri.db.get(flag)).toBe("1");
    expect(tauri.db.has(STORAGE_KEY)).toBe(false);
    expect(tauri.db.has(UNREADABLE_KEY)).toBe(false);

    expect(await rewriteProtection(pass, value)).toBe(true);
    expect(tauri.db.has(flag)).toBe(false);
    expect(tauri.db.has(STORAGE_KEY)).toBe(true);
    const backup = tauri.db.get(UNREADABLE_KEY)!;
    expect(pass ? await decrypt(JSON.parse(backup), pass) : backup).toBe("{original");
  });

  it.each(["forget", "ephemeral round trip"])("orders %s after already queued backup ciphertext", async (change) => {
    let release!: () => void;
    vi.mocked(invoke).mockImplementationOnce((_command, args) => new Promise((resolve) => {
      release = () => {
        const values = args as { key: string; value: string };
        tauri.db.set(values.key, values.value);
        resolve(null);
      };
    }));
    const value = () => ({ state: { assessment: emptyAssessment() }, version: 4 });
    const old = rewriteProtection("old-passphrase", value);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    let newer: Promise<boolean> | undefined;
    if (change === "forget") {
      setSessionPassphrase(null);
      dropProgress(STORAGE_KEY);
    } else {
      setEphemeralMode(true);
      setEphemeralMode(false);
      newer = rewriteProtection("new-passphrase", value);
    }
    release();
    expect(await old).toBe(false);
    if (newer) {
      expect(await newer).toBe(true);
      expect(await decrypt(JSON.parse(tauri.db.get(UNREADABLE_KEY)!), "new-passphrase")).toBe("{original");
      expect(protectionSnapshot()).toBe("protected");
    } else {
      await store.flush();
      expect(tauri.db.has(UNREADABLE_KEY)).toBe(false);
      expect(tauri.db.has(STORAGE_KEY)).toBe(false);
      expect(recoveryDownload()).toBeNull();
    }
  });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
const checkpoint = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };

// Use signals for actual IPC entry; always release all gates before draining the real queue.
describe("latest protected desktop state", () => {
  it.each(["ordinary", "explicit", "clear"])("keeps %s edits pending through backup and active acknowledgements", async (kind) => {
    const { checkedStorage } = await import("./persistence");
    const store = new SqliteAutosave({});
    vi.spyOn(platform, "autosave").mockReturnValue(store);
    const normal = vi.mocked(invoke).getMockImplementation()!;
    const backup = gate();
    const active = gate();
    const final = gate();
    const backupEntered = gate();
    const activeEntered = gate();
    const finalEntered = gate();
    let activeCalls = 0;
    let value = { state: { assessment: { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "First" } } }, version: 4 };
    const pending: unknown[] = [];
    try {
      if (kind === "clear") {
        await store.setItem(UNREADABLE_KEY, "{session recovery");
        setEphemeralMode(true);
        await store.flush();
        setEphemeralMode(false);
      } else await store.setItem(UNREADABLE_KEY, "{recovery");
      await store.flush();
      vi.mocked(invoke).mockImplementation(async (command, args) => {
        const key = (args as { key?: string })?.key;
        if (command === "autosave_set" && key === UNREADABLE_KEY) {
          backupEntered.release();
          await backup.promise;
        }
        if (command === "autosave_set" && key === STORAGE_KEY) {
          activeCalls++;
          if (activeCalls === 1) { activeEntered.release(); await active.promise; }
          if (activeCalls === 2) { finalEntered.release(); await final.promise; }
        }
        return normal(command, args);
      });
      let settled = false;
      const saving = kind === "ordinary"
        ? (setSessionPassphrase("desktop-passphrase"), Promise.resolve(checkedStorage.setItem(STORAGE_KEY, value)))
        : rewriteProtection(kind === "clear" ? null : "desktop-passphrase", () => value);
      pending.push(Promise.resolve(saving).then(() => { settled = true; }));
      await Promise.race([backupEntered.promise, Promise.resolve(saving).then(() => { throw new Error("save completed before backup IPC"); })]);
      await checkpoint();
      expect(settled, "no completion before backup acknowledgement").toBe(false);
      expect(activeCalls, "backup must acknowledge before active IPC").toBe(0);
      expect(tauri.db.has(STORAGE_KEY)).toBe(false);
      expect(protectionSnapshot()).toBe("pending");
      backup.release();
      await Promise.race([activeEntered.promise, Promise.resolve(saving).then(() => { throw new Error("save completed before active IPC"); })]);
      await checkpoint();
      expect(settled).toBe(false);
      expect(tauri.db.has(STORAGE_KEY)).toBe(false);
      expect(protectionSnapshot(), "no success before active acknowledgement").toBe("pending");
      value = { state: { assessment: { ...emptyAssessment(), org: { ...emptyAssessment().org, name: "Latest" } } }, version: 4 };
      pending.push(checkedStorage.setItem(STORAGE_KEY, value));
      await checkpoint();
      expect(activeCalls).toBe(1);
      active.release();
      await Promise.race([finalEntered.promise, Promise.resolve(saving).then(() => { throw new Error("save completed before latest IPC"); })]);
      await checkpoint();
      expect(settled).toBe(false);
      expect(protectionSnapshot()).toBe("pending");
      final.release();
      await Promise.all(pending);
      await store.flush();
      const raw = tauri.db.get(STORAGE_KEY)!;
      expect(JSON.parse(kind === "clear" ? raw : await decrypt(JSON.parse(raw), "desktop-passphrase"))).toEqual(value);
      expect(protectionSnapshot()).toBe(kind === "clear" ? "plain" : "protected");
    } finally {
      backup.release(); active.release(); final.release();
      await Promise.allSettled(pending);
      await store.flush();
      vi.mocked(invoke).mockImplementation(normal);
      setSessionPassphrase(null);
      setEphemeralMode(false);
      dropProgress(STORAGE_KEY);
      await store.flush();
      vi.restoreAllMocks();
    }
  });
});
