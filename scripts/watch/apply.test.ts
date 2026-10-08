import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyUrlUpdates, emptyState, readState, writeState } from "./apply";
import { openCache } from "./cache";

const SOURCES = `# Microsoft Learn guidance.
- id: ms-one
  title: First page
  publisher: Microsoft
  url: https://learn.microsoft.com/en-us/old/one
  retrieved: 2026-01-01
- id: ms-two
  title: Second page
  publisher: Microsoft
  url: https://learn.microsoft.com/en-us/two
  retrieved: 2026-01-01
`;

describe("applyUrlUpdates", () => {
  it("rewrites only the url and retrieved lines of the moved source", () => {
    const out = applyUrlUpdates({ "content/sources/microsoft.yaml": SOURCES }, [
      { id: "ms-one", url: "https://learn.microsoft.com/en-us/new/one", retrieved: "2026-10-09" },
    ]);
    expect(out["content/sources/microsoft.yaml"]).toBe(
      SOURCES.replace("https://learn.microsoft.com/en-us/old/one", "https://learn.microsoft.com/en-us/new/one").replace(
        "retrieved: 2026-01-01\n- id: ms-two",
        "retrieved: 2026-10-09\n- id: ms-two",
      ),
    );
  });

  it("quotes URLs that aren't safe as plain scalars", () => {
    const out = applyUrlUpdates({ "a.yaml": SOURCES }, [{ id: "ms-two", url: "https://example.com/a b#c", retrieved: "2026-10-09" }]);
    expect(out["a.yaml"]).toContain('url: "https://example.com/a b#c"');
  });

  it("refuses unknown ids and non-http URLs", () => {
    expect(() => applyUrlUpdates({ "a.yaml": SOURCES }, [{ id: "nope", url: "https://x.test/", retrieved: "2026-10-09" }])).toThrow(/not found/);
    expect(() => applyUrlUpdates({ "a.yaml": SOURCES }, [{ id: "ms-one", url: "javascript:alert(1)", retrieved: "2026-10-09" }])).toThrow(/non-http/);
  });

  it("applies several updates to one file", () => {
    const out = applyUrlUpdates({ "a.yaml": SOURCES }, [
      { id: "ms-one", url: "https://learn.microsoft.com/en-us/1", retrieved: "2026-10-09" },
      { id: "ms-two", url: "https://learn.microsoft.com/en-us/2", retrieved: "2026-10-09" },
    ]);
    expect(out["a.yaml"]).toContain("url: https://learn.microsoft.com/en-us/1\n");
    expect(out["a.yaml"]).toContain("url: https://learn.microsoft.com/en-us/2\n");
  });
});

describe("state files", () => {
  it("round-trips deterministically and treats a missing file as an empty baseline", () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-state-"));
    const path = join(dir, "watch", "state.json");
    expect(readState(path)).toEqual(emptyState());
    const state = { ...emptyState(), sources: { b: { url: "https://b.test/", status: "ok" as const }, a: { url: "https://a.test/", status: "ok" as const } } };
    writeState(path, state);
    const first = readFileSync(path, "utf8");
    writeState(path, readState(path));
    expect(readFileSync(path, "utf8")).toBe(first);
    expect(first.indexOf('"a"')).toBeLessThan(first.indexOf('"b"'));
  });

  it("rejects a state file from another version", () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-state-"));
    const path = join(dir, "state.json");
    writeFileSync(path, '{"version":2,"sources":{}}');
    expect(() => readState(path)).toThrow(/version 1/);
    writeFileSync(path, '{"version":1,"sources":{"x":{"url":"https://x.test/","status":"ok","evil":true}}}');
    expect(() => readState(path)).toThrow(/version 1/);
  });
});

describe("cache", () => {
  it("stores snapshots, prunes unreferenced ones and persists failure counts", () => {
    const dir = mkdtempSync(join(tmpdir(), "watch-cache-"));
    const cache = openCache(dir);
    cache.writeSnapshot("ms-one", "aaaa", "old text");
    cache.writeSnapshot("ms-one", "bbbb", "new text");
    cache.writeSnapshot("ms-gone", "cccc", "x");
    cache.failures["ms-one"] = 2;
    cache.prune({ "ms-one": ["bbbb"] });
    cache.save();

    const again = openCache(dir);
    expect(again.readSnapshot("ms-one", "aaaa")).toBeUndefined();
    expect(again.readSnapshot("ms-one", "bbbb")).toBe("new text");
    expect(again.readSnapshot("ms-gone", "cccc")).toBeUndefined();
    expect(again.failures).toEqual({ "ms-one": 2 });
  });

  it("refuses path-like keys", () => {
    const cache = openCache(mkdtempSync(join(tmpdir(), "watch-cache-")));
    expect(() => cache.writeSnapshot("../etc", "aaaa", "x")).toThrow(/unsafe/);
  });
});
