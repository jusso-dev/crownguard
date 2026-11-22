import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseHTML } from "linkedom";

/** In-memory Tauri mocks prove adapter wiring, not native permissions or selected-path scope enforcement. */
const tauri = vi.hoisted(() => {
  const state = {
    db: new Map<string, string>(),
    files: new Map<string, string | Uint8Array>(),
    calls: [] as { cmd: string; args?: Record<string, unknown> }[],
    listeners: new Map<string, () => void>(),
    launch: null as string | null,
    saveAnswer: null as string | null,
    openAnswer: null as string | null,
    askAnswer: true,
    failWrite: false,
  };
  return state;
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    tauri.calls.push({ cmd, args });
    switch (cmd) {
      case "autosave_load":
        return Object.fromEntries(tauri.db);
      case "autosave_set":
        tauri.db.set(args!.key as string, args!.value as string);
        return null;
      case "autosave_remove":
        tauri.db.delete(args!.key as string);
        return null;
      case "launch_file_take": {
        const p = tauri.launch;
        tauri.launch = null;
        return p;
      }
      case "recent_list":
        return [{ id: "/a/b.crownguard.json", platforms: [], encrypted: false, filePath: "/a/b.crownguard.json", updatedAt: "2026-01-01T00:00:00Z" }];
      case "recent_record":
        return null;
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: () => void) => {
    tauri.listeners.set(name, cb);
    return () => tauri.listeners.delete(name);
  }),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => () => {}) }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => tauri.openAnswer),
  save: vi.fn(async () => tauri.saveAnswer),
  ask: vi.fn(async () => tauri.askAnswer),
  message: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (p: string) => {
    const f = tauri.files.get(p);
    if (typeof f !== "string") throw new Error("not found");
    return f;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    if (tauri.failWrite) throw new Error("read-only file system");
    tauri.files.set(p, c);
  }),
  writeFile: vi.fn(async (p: string, c: Uint8Array) => {
    if (tauri.failWrite) throw new Error("read-only file system");
    tauri.files.set(p, c);
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { encrypt } from "../format/crypto";
import { basename, confirmAndOpen, createNativeFileSaver, createTauriPlatform, saveAs, SqliteAutosave } from "./tauri";

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  tauri.db.clear();
  tauri.files.clear();
  tauri.calls.length = 0;
  tauri.listeners.clear();
  tauri.launch = null;
  tauri.saveAnswer = null;
  tauri.openAnswer = null;
  tauri.askAnswer = true;
  tauri.failWrite = false;
  vi.clearAllMocks();
});

describe("SqliteAutosave", () => {
  it("serves reads from what SQLite held at start-up", async () => {
    tauri.db.set("crownguard:v1", '{"state":{}}');
    const store = await SqliteAutosave.load();
    expect(store.getItem("crownguard:v1")).toBe('{"state":{}}');
    expect(store.getItem("crownguard:v1:ephemeral")).toBeNull();
  });

  it("writes through to SQLite in the order the app made them", async () => {
    const store = await SqliteAutosave.load();
    store.setItem("crownguard:v1", "1");
    store.setItem("crownguard:v1", "2");
    store.removeItem("crownguard:v1:unreadable");
    store.setItem("crownguard:v1", "3");
    expect(store.getItem("crownguard:v1")).toBe("3");
    await store.flush();
    expect(tauri.calls.map((c) => [c.cmd, c.args?.value])).toEqual([
      ["autosave_load", undefined],
      ["autosave_set", "1"],
      ["autosave_set", "2"],
      ["autosave_remove", undefined],
      ["autosave_set", "3"],
    ]);
    expect(tauri.db.get("crownguard:v1")).toBe("3");
    expect(readTextFile).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps working, and reports, when a write fails", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = new SqliteAutosave({});
    store.setItem("crownguard:v1", "a");
    await store.flush();
    expect(store.lastError).toBe("disk full");
    store.setItem("crownguard:v1", "b");
    await store.flush();
    expect(store.lastError).toBeUndefined();
    expect(tauri.db.get("crownguard:v1")).toBe("b");
    error.mockRestore();
  });

  it("an encrypted assessment crosses IPC only as its envelope", async () => {
    const plain = JSON.stringify({ state: { assessment: { org: { name: "Acme Secret Pty Ltd" } } }, version: 4 });
    const store = new SqliteAutosave({});
    store.setItem("crownguard:v1", JSON.stringify(await encrypt(plain, "correct horse battery staple")));
    await store.flush();
    const sent = JSON.stringify(tauri.calls);
    expect(sent).not.toContain("Acme Secret");
    expect(JSON.parse(tauri.db.get("crownguard:v1")!)).toHaveProperty("crownguardEncrypted");
  });
});

describe("native file saver", () => {
  it("asks where on the first save, then saves back to the same file", async () => {
    tauri.saveAnswer = "/Users/me/Acme.crownguard.json";
    const saver = createNativeFileSaver();
    expect(await saver.save("acme.crownguard.json", "{\"a\":1}")).toEqual({ kind: "saved", file: "Acme.crownguard.json", reused: false });
    expect(await saver.save("acme.crownguard.json", "{\"a\":2}")).toEqual({ kind: "saved", file: "Acme.crownguard.json", reused: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ defaultPath: "acme.crownguard.json", filters: [{ name: "crownguard assessment", extensions: ["json"] }] });
    expect(tauri.files.get("/Users/me/Acme.crownguard.json")).toBe('{"a":2}');
    expect(tauri.calls.filter((c) => c.cmd === "recent_record")).toHaveLength(2);
  });

  it("saves back to a file that was opened", async () => {
    const saver = createNativeFileSaver();
    saver.adopt({ name: "x.crownguard.json", text: "{}", path: "/tmp/x.crownguard.json" });
    expect(saver.fileName).toBe("x.crownguard.json");
    expect(await saver.save("other.json", "{}")).toMatchObject({ kind: "saved", reused: true });
    expect(save).not.toHaveBeenCalled();
    saver.adopt({ name: "web.json", text: "{}" });
    expect(saver.fileName).toBe("x.crownguard.json");
  });

  it("reports a cancelled dialog and a failed write, then asks again", async () => {
    const saver = createNativeFileSaver();
    expect(await saver.save("a.crownguard.json", "{}")).toEqual({ kind: "cancelled" });
    expect(writeTextFile).not.toHaveBeenCalled();
    tauri.saveAnswer = "/ro/a.crownguard.json";
    expect(await saver.save("a.crownguard.json", "original")).toMatchObject({ kind: "saved", reused: false });
    tauri.failWrite = true;
    expect(await saver.save("a.crownguard.json", "{}")).toEqual({ kind: "failed", file: "a.crownguard.json", error: "read-only file system" });
    expect(saver.fileName).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(2);
    tauri.failWrite = false;
    tauri.saveAnswer = "/new/retry.crownguard.json";
    expect(await saver.save("a.crownguard.json", "retry")).toEqual({ kind: "saved", file: "retry.crownguard.json", reused: false });
    expect(save).toHaveBeenCalledTimes(3);
    expect(tauri.files.get("/ro/a.crownguard.json")).toBe("original");
    expect(tauri.files.get("/new/retry.crownguard.json")).toBe("retry");
  });
});

describe("saveAs", () => {
  const exports = [
    { filename: "report.pdf", type: "application/pdf", filter: "PDF document", bytes: new Uint8Array([37, 80, 68, 70]) },
    { filename: "register.csv", type: "text/csv;charset=utf-8", filter: "CSV file", bytes: new TextEncoder().encode("name,notes\r\nExample,秘密\r\n") },
    { filename: "register.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filter: "Excel workbook", bytes: new Uint8Array([80, 75, 3, 4, 0, 255]) },
    { filename: "crownguard-unreadable.json", type: "application/json", filter: "JSON file", bytes: new TextEncoder().encode(" {broken backup\r\n秘密") },
  ];
  it.each(exports)("writes exact $filename bytes to the chosen target with its filter", async ({ filename, type, filter, bytes }) => {
    tauri.saveAnswer = `/chosen/${filename}`;
    expect(await saveAs(filename, bytes, type)).toBe("saved");
    expect(save).toHaveBeenCalledWith({ defaultPath: filename, filters: [{ name: filter, extensions: [filename.split(".").pop()] }] });
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(`/chosen/${filename}`, bytes);
    expect(tauri.files.get(`/chosen/${filename}`)).toEqual(bytes);
  });

  it.each(exports)("cancelling $filename writes nothing", async ({ filename, bytes, type }) => {
    expect(await saveAs(filename, bytes, type)).toBe("cancelled");
    expect(writeFile).not.toHaveBeenCalled();
    expect(tauri.files.size).toBe(0);
  });

  it("reports export failure without touching recovery material", async () => {
    const raw = " {unreadable\r\n秘密";
    tauri.db.set("crownguard:v1:unreadable", raw);
    tauri.saveAnswer = "/chosen/crownguard-unreadable.json";
    tauri.failWrite = true;
    expect(await saveAs("crownguard-unreadable.json", raw, "application/json")).toBe("failed");
    expect(message).toHaveBeenCalledExactlyOnceWith("Couldn't save crownguard-unreadable.json: read-only file system", { title: "Save failed", kind: "error" });
    expect(tauri.db.get("crownguard:v1:unreadable")).toBe(raw);
    expect(tauri.calls).toEqual([]);
    expect(tauri.files.size).toBe(0);
  });
});

describe("external links", () => {
  // Literal representatives respect the platform layer boundary; no catalogue imports here.
  it.each([
    "https://www.w3.org/WAI/standards-guidelines/wcag/",
    "https://creativecommons.org/licenses/by/4.0/", "https://www.soc-cmm.com/",
    "https://developers.openai.com/", "https://knowledge.workspace.google.com/",
    "https://reference.example/assessment/123?section=one#notes",
    "https://REFERENCE.example:443/assessment/../assessment/123?section=one#notes",
  ])("confirms generic HTTPS and preserves the full canonical URL: %s", async (href) => {
    const canonical = new URL(href).href;
    expect(await confirmAndOpen(href)).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith(expect.stringContaining(canonical), expect.objectContaining({ title: "Open external link" }));
    // Exactly one argument: leave handler choice to the default browser.
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(canonical);
    tauri.askAnswer = false;
    expect(await confirmAndOpen(href)).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it.each(["click", "auxclick"])("intercepts %s without navigation and honours cancellation", async (eventType) => {
    const { document, Event } = parseHTML('<html><head><base href="https://app.example/"></head><body><a href="https://reference.example/assessment/123?section=one#notes"><span>Reference</span></a></body></html>');
    vi.stubGlobal("document", document);
    await createTauriPlatform();
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    document.querySelector("span")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://reference.example/assessment/123?section=one#notes"));
    expect(ask).toHaveBeenCalledTimes(1);
    tauri.askAnswer = false;
    document.querySelector("span")!.dispatchEvent(new Event(eventType, { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it.each(["#notes", "/assessment", "https://app.example/help", "blob:https://app.example/report"])("leaves local/blob link untouched: %s", async (href) => {
    const { document, Event } = parseHTML('<html><head><base href="https://app.example/"></head><body><a>Local</a></body></html>');
    vi.stubGlobal("document", document);
    await createTauriPlatform();
    const anchor = document.querySelector("a")!;
    anchor.setAttribute("href", href);
    for (const eventType of ["click", "auxclick"]) {
      const event = new Event(eventType, { bubbles: true, cancelable: true });
      anchor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(ask).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("never open anything but https", async () => {
    for (const href of ["http://example.com/", "file:///etc/passwd", "javascript:alert(1)", "not a url"]) expect(await confirmAndOpen(href)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });
});

describe("createTauriPlatform", () => {
  it("opens a picked file, records it and lists recent files", async () => {
    const platform = await createTauriPlatform();
    expect(platform.kind).toBe("desktop");
    tauri.files.set("/docs/acme.crownguard.json", '{"org":{"name":"Acme"}}');
    tauri.openAnswer = "/docs/acme.crownguard.json";
    expect(await platform.openFile()).toEqual({ name: "acme.crownguard.json", text: '{"org":{"name":"Acme"}}', path: "/docs/acme.crownguard.json" });
    expect(tauri.calls.some((c) => c.cmd === "recent_record" && c.args?.path === "/docs/acme.crownguard.json")).toBe(true);
    tauri.openAnswer = null;
    expect(await platform.openFile()).toBeNull();
    expect(readTextFile).toHaveBeenCalledTimes(1);
    expect(await platform.listRecent()).toHaveLength(1);
  });

  it("recent default paths still require a picker; the chosen path supports save-back", async () => {
    const platform = await createTauriPlatform();
    const recentPath = "/previous/recent.crownguard.json";
    expect(await platform.openFile({ defaultPath: recentPath })).toBeNull();
    expect(open).toHaveBeenCalledExactlyOnceWith({ defaultPath: recentPath, multiple: false, directory: false, filters: [{ name: "crownguard assessment", extensions: ["json"] }] });
    expect(readTextFile).not.toHaveBeenCalled();
    tauri.openAnswer = "/chosen/other.crownguard.json";
    tauri.files.set(tauri.openAnswer, "{}");
    const picked = await platform.openFile({ defaultPath: recentPath });
    expect(readTextFile).toHaveBeenCalledExactlyOnceWith(tauri.openAnswer);
    const saver = platform.createFileSaver();
    saver.adopt(picked!);
    expect(await saver.save("suggested.json", "changed")).toMatchObject({ kind: "saved", reused: true });
    expect(writeTextFile).toHaveBeenCalledExactlyOnceWith(tauri.openAnswer, "changed");
    expect(save).not.toHaveBeenCalled();
  });

  it("hands over a file the operating system opened, once, at start-up and on each nudge", async () => {
    const platform = await createTauriPlatform();
    tauri.files.set("/d/one.crownguard.json", "{}");
    tauri.files.set("/d/two.crownguard.json", "{}");
    tauri.launch = "/d/one.crownguard.json";
    const opened: string[] = [];
    const saver = platform.createFileSaver();
    const stop = platform.onOpenRequest((f) => { opened.push(f.path!); saver.adopt(f); });
    await vi.waitFor(() => expect(opened).toEqual(["/d/one.crownguard.json"]));
    tauri.launch = "/d/two.crownguard.json";
    tauri.listeners.get("open-file")!();
    await vi.waitFor(() => expect(opened).toEqual(["/d/one.crownguard.json", "/d/two.crownguard.json"]));
    // A nudge with nothing waiting opens nothing.
    tauri.listeners.get("open-file")!();
    await new Promise((r) => setTimeout(r, 10));
    expect(opened).toHaveLength(2);
    expect(await saver.save("other.json", "updated")).toMatchObject({ kind: "saved", reused: true });
    expect(writeTextFile).toHaveBeenCalledExactlyOnceWith("/d/two.crownguard.json", "updated");
    expect(save).not.toHaveBeenCalled();
    stop();
  });

  it("keeps nothing in the recent list while the assessment isn't to be kept on this device", async () => {
    tauri.db.set("crownguard:v1:ephemeral", "1");
    const platform = await createTauriPlatform();
    tauri.files.set("/docs/a.crownguard.json", "{}");
    tauri.openAnswer = "/docs/a.crownguard.json";
    expect(await platform.openFile()).not.toBeNull();
    tauri.saveAnswer = "/docs/b.crownguard.json";
    expect(await platform.createFileSaver().save("b.crownguard.json", "{}")).toMatchObject({ kind: "saved" });
    expect(tauri.calls.some((c) => c.cmd === "recent_record")).toBe(false);
  });

  it("reports autosave write failures", async () => {
    const platform = await createTauriPlatform();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(invoke).mockRejectedValueOnce(new Error("database is locked"));
    platform.autosave()!.setItem("crownguard:v1", "{}");
    await vi.waitFor(() => expect(platform.autosaveError()).toBe("database is locked"));
    error.mockRestore();
  });

  it("a stale subscription does not consume the launch file", async () => {
    const platform = await createTauriPlatform();
    tauri.files.set("/d/one.crownguard.json", "{}");
    tauri.launch = "/d/one.crownguard.json";
    // Mounted and unmounted at once (React StrictMode in development), then mounted again.
    platform.onOpenRequest(() => {})();
    const opened: string[] = [];
    platform.onOpenRequest((f) => opened.push(f.path!));
    await vi.waitFor(() => expect(opened).toEqual(["/d/one.crownguard.json"]));
  });

  it("basename handles both separators", () => {
    expect(basename("C:\\Users\\me\\a.crownguard.json")).toBe("a.crownguard.json");
    expect(basename("/home/me/a.crownguard.json")).toBe("a.crownguard.json");
  });
});


describe("durable autosave acknowledgement", () => {
  it("rejects the failed operation despite a subsequent successful write", async () => {
    tauri.db.set("backup", "plain");
    const store = new SqliteAutosave({ backup: "plain" });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("value too large"));
    const failed = store.setItem("backup", "ciphertext");
    const later = store.setItem("active", "ok");
    await expect(failed).rejects.toThrow("Local storage write failed");
    await later;
    expect(store.lastError).toBeUndefined();
    expect(tauri.db.get("backup")).toBe("plain");
    expect(store.getItem("backup")).toBe("plain");
    expect(store.getCommittedItem("backup")).toBe("plain");
    expect(tauri.db.get("active")).toBe("ok");
  });

  it("restores the last committed value after consecutive failures, without clobbering a newer optimistic write", async () => {
    tauri.db.set("backup", "original");
    const store = new SqliteAutosave({ backup: "original" });
    let reject!: (error: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    let rejectSecond!: (error: Error) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((_, r) => { rejectSecond = r; }));
    const first = store.setItem("backup", "first");
    await Promise.resolve();
    const second = store.setItem("backup", "second");
    reject(new Error("quota"));
    await expect(first).rejects.toThrow();
    expect(store.getItem("backup")).toBe("second");
    rejectSecond(new Error("quota"));
    await expect(second).rejects.toThrow();
    expect(store.getItem("backup")).toBe("original");
    expect(tauri.db.get("backup")).toBe("original");
    // Ignored ordinary writes are handled and do not break the queue.
    vi.mocked(invoke).mockRejectedValueOnce(new Error("locked"));
    store.setItem("backup", "ignored failure");
    await store.setItem("backup", "recovered");
    expect(tauri.db.get("backup")).toBe("recovered");
  });
});
