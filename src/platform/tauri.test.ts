import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory stand-ins for the Tauri bridge and plugins. Every call is recorded so tests can see what crossed IPC. */
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
      default:
        return null;
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
    tauri.files.set(p, c);
  }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { encrypt } from "../wizard/crypto";
import { basename, confirmAndOpen, createNativeFileSaver, createTauriPlatform, saveAs, SqliteAutosave } from "./tauri";

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
    const store = new SqliteAutosave({});
    store.setItem("crownguard:v1", "1");
    store.setItem("crownguard:v1", "2");
    store.removeItem("crownguard:v1:unreadable");
    store.setItem("crownguard:v1", "3");
    expect(store.getItem("crownguard:v1")).toBe("3");
    await store.flush();
    expect(tauri.calls.map((c) => [c.cmd, c.args?.value])).toEqual([
      ["autosave_set", "1"],
      ["autosave_set", "2"],
      ["autosave_remove", undefined],
      ["autosave_set", "3"],
    ]);
    expect(tauri.db.get("crownguard:v1")).toBe("3");
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
    tauri.saveAnswer = "/ro/a.crownguard.json";
    tauri.failWrite = true;
    expect(await saver.save("a.crownguard.json", "{}")).toEqual({ kind: "failed", file: "a.crownguard.json", error: "read-only file system" });
    expect(saver.fileName).toBeUndefined();
  });
});

describe("saveAs", () => {
  it("writes the bytes where the user chose, with a filter for the file type", async () => {
    tauri.saveAnswer = "/out/report.pdf";
    await saveAs("acme-report.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");
    expect(save).toHaveBeenCalledWith({ defaultPath: "acme-report.pdf", filters: [{ name: "PDF document", extensions: ["pdf"] }] });
    expect(Array.from(tauri.files.get("/out/report.pdf") as Uint8Array)).toEqual([37, 80, 68, 70]);
  });

  it("does nothing when the dialog is cancelled", async () => {
    await saveAs("a.xlsx", "x", "application/octet-stream");
    expect(tauri.files.size).toBe(0);
  });
});

describe("external links", () => {
  it("open https links only after the user confirms", async () => {
    expect(await confirmAndOpen("https://learn.microsoft.com/x")).toBe(true);
    expect(openUrl).toHaveBeenCalledWith("https://learn.microsoft.com/x");
    tauri.askAnswer = false;
    expect(await confirmAndOpen("https://example.com/")).toBe(false);
    expect(openUrl).toHaveBeenCalledTimes(1);
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
    expect(await platform.listRecent()).toHaveLength(1);
  });

  it("hands over a file the operating system opened, once, at start-up and on each nudge", async () => {
    const platform = await createTauriPlatform();
    tauri.files.set("/d/one.crownguard.json", "{}");
    tauri.files.set("/d/two.crownguard.json", "{}");
    tauri.launch = "/d/one.crownguard.json";
    const opened: string[] = [];
    const stop = platform.onOpenRequest((f) => opened.push(f.path!));
    await vi.waitFor(() => expect(opened).toEqual(["/d/one.crownguard.json"]));
    tauri.launch = "/d/two.crownguard.json";
    tauri.listeners.get("open-file")!();
    await vi.waitFor(() => expect(opened).toEqual(["/d/one.crownguard.json", "/d/two.crownguard.json"]));
    // A nudge with nothing waiting opens nothing.
    tauri.listeners.get("open-file")!();
    await new Promise((r) => setTimeout(r, 10));
    expect(opened).toHaveLength(2);
    stop();
  });

  it("basename handles both separators", () => {
    expect(basename("C:\\Users\\me\\a.crownguard.json")).toBe("a.crownguard.json");
    expect(basename("/home/me/a.crownguard.json")).toBe("a.crownguard.json");
  });
});
