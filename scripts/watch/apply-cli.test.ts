// @vitest-environment node
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCliSandbox, put, withFiles } from "../lib/apply-cli-test";

const source = (id: string, url = `https://${id}.test/old`, retrieved = "2026-01-01") =>
  `- id: ${id}\n  title: Example ${id}\n  publisher: Example\n  url: ${url}\n  retrieved: ${retrieved}\n`;
const update = (id = "alpha") => ({ id, url: `https://${id}.test/new`, retrieved: "2026-11-15" });
const minimalState = { version: 1, sources: {} };
const normalisedState = '{\n  "feeds": {},\n  "neighbours": {},\n  "sources": {},\n  "version": 1\n}\n';
const first = "content/sources/first.yaml";
const second = "content/sources/second.yaml";
const baseline = "watch/state.json";

describe("watch apply CLI", () => {
  let box: ReturnType<typeof applyCliSandbox>;
  const input = (name: string, value: unknown) => put(join(box.artifacts, name), JSON.stringify(value));

  beforeEach(() => {
    box = applyCliSandbox();
    put(join(box.root, first), `# preserve comment\n${source("alpha")}${source("gamma")}`);
    put(join(box.root, second), source("beta"));
    put(join(box.root, "content/sources/untouched.yaml"), source("untouched"));
    put(join(box.root, baseline), "baseline sentinel\n");
    input("state.json", minimalState);
    input("url-updates.json", [update()]);
  });
  afterEach(() => box?.cleanup());

  function rejected(diagnostic: RegExp, args?: string[], status = 1) {
    const before = box.snapshot();
    const result = box.run("watch", args);
    expect(result.status).toBe(status);
    expect(result.stderr).toMatch(diagnostic);
    expect(result.stdout).toBe("");
    expect(box.snapshot()).toEqual(before);
  }

  it("requires a directory argument", () => {
    rejected(/usage: pnpm watch:apply/, [], 2);
  });

  it.each(["state.json", "url-updates.json"])("rejects missing %s", (name) => {
    rmSync(join(box.artifacts, name));
    rejected(new RegExp(`ENOENT.*${name.replace(".", "\\.")}`));
  });
  it.each(["state.json", "url-updates.json"])("rejects malformed %s", (name) => {
    put(join(box.artifacts, name), "{ unfinished");
    rejected(/SyntaxError/);
  });

  it.each([
    ["version", { version: 2, sources: {} }, /"path":\s*\[\s*"version"/],
    ["source shape", { version: 1, sources: { alpha: "wrong" } }, /"path":\s*\[\s*"sources",\s*"alpha"/],
    ["top-level field", { ...minimalState, extra: true }, /unrecognized_keys/],
    ["nested field", { version: 1, sources: { alpha: { url: "https://alpha.test", status: "ok", extra: true } } }, /unrecognized_keys/],
    ["source key", { version: 1, sources: { "Alpha Source": { url: "https://alpha.test", status: "ok" } } }, /invalid_key/],
    ["feed field", { ...minimalState, feeds: { news: { latest: "cursor", extra: true } } }, /unrecognized_keys/],
  ] as const)("rejects invalid state %s before valid source edits", (_name, state, diagnostic) => {
    input("state.json", state);
    rejected(diagnostic);
  });

  it.each([
    ["non-array", {}, /expected array/],
    ["missing field", [{ id: "alpha", url: "https://alpha.test/new" }], /"path":\s*\[\s*0,\s*"retrieved"/],
    ["wrong type", [{ ...update(), url: 42 }], /"path":\s*\[\s*0,\s*"url"/],
    ["extra field", [{ ...update(), extra: true }], /unrecognized_keys/],
    ["unknown source", [update("unknown")], /unknown source id/],
    ["HTTP URL", [{ ...update(), url: "http://alpha.test/new" }], /"note": "Invalid protocol"[\s\S]*"path":\s*\[\s*0,\s*"url"/],
    ["non-URL", [{ ...update(), url: "ordinary text" }], /"format": "url"[\s\S]*"path":\s*\[\s*0,\s*"url"/],
    ["date format", [{ ...update(), retrieved: "15 November 2026" }], /"format": "regex"[\s\S]*"path":\s*\[\s*0,\s*"retrieved"/],
  ] as const)("rejects update %s and preserves baseline", (_name, updates, diagnostic) => {
    input("url-updates.json", updates);
    rejected(diagnostic);
  });

  it("validates the second update before writing either source", () => {
    input("url-updates.json", [update(), { ...update("beta"), retrieved: "yesterday" }]);
    rejected(/"path":\s*\[\s*1,\s*"retrieved"/);
  });

  it("prepares all edits before writing when later source formatting is unsupported", () => {
    // Valid YAML/catalogue entry, but not the editor's single-line field format.
    put(join(box.root, second), source("beta").replace("url: https://beta.test/old", "url:\n    https://beta.test/old"));
    input("url-updates.json", [update(), update("beta")]);
    rejected(/beta: entry has no single-line url\/retrieved to update/);
  });

  it("applies one update with separator and preserves complete unrelated bytes", () => {
    const before = box.snapshot();
    const result = box.run("watch", ["--", box.artifacts]);
    expect(result).toEqual({ status: 0, stderr: "", stdout: "applied 1 URL update and the new baseline\n" });
    expect(box.snapshot()).toEqual(withFiles(before, {
      [`checkout/${first}`]: `# preserve comment\n${source("alpha", "https://alpha.test/new", "2026-11-15")}${source("gamma")}`,
      [`checkout/${baseline}`]: normalisedState,
    }));
  });

  it("applies multiple files and multiple entries in one file", () => {
    input("url-updates.json", [update(), update("beta"), update("gamma")]);
    const before = box.snapshot();
    expect(box.run("watch")).toEqual({ status: 0, stderr: "", stdout: "applied 3 URL updates and the new baseline\n" });
    expect(box.snapshot()).toEqual(withFiles(before, {
      [`checkout/${first}`]: `# preserve comment\n${source("alpha", "https://alpha.test/new", "2026-11-15")}${source("gamma", "https://gamma.test/new", "2026-11-15")}`,
      [`checkout/${second}`]: source("beta", "https://beta.test/new", "2026-11-15"),
      [`checkout/${baseline}`]: normalisedState,
    }));
  });

  it("normalises defaults for empty updates and repeats without byte changes", () => {
    input("url-updates.json", []);
    const before = box.snapshot();
    const success = { status: 0, stderr: "", stdout: "applied 0 URL updates and the new baseline\n" };
    expect(box.run("watch")).toEqual(success);
    expect(JSON.parse(readFileSync(join(box.root, baseline), "utf8"))).toEqual({ version: 1, sources: {}, neighbours: {}, feeds: {} });
    const after = withFiles(before, { [`checkout/${baseline}`]: normalisedState });
    expect(box.snapshot()).toEqual(after);
    expect(box.run("watch")).toEqual(success);
    expect(box.snapshot()).toEqual(after);
  });

  it("accepts rich state including source keys outside the catalogue", () => {
    // Already sorted explicitly so expected serialisation is independent of production helpers.
    const state = {
      feeds: { news: { latest: "2026-11-15", seen: ["entry"] } },
      neighbours: { alpha: ["historical"] },
      sources: {
        historical: {
          contentHash: "hash", finalUrl: "https://historical.test/final", httpStatus: 200,
          learn: { branch: "main", commit: "commit", documentId: "document", path: "guide.md", repo: "example/docs" },
          passed: ["2026-11-15"], retired: "no", sections: [{ h: "heading", hash: "section", words: 3 }],
          status: "ok", terms: ["term"], title: "Title", updated: "2026-11-15", url: "https://historical.test",
          versions: ["v1"], words: 3,
        },
      },
      version: 1,
    };
    input("state.json", state);
    input("url-updates.json", []);
    const before = box.snapshot();
    expect(box.run("watch")).toEqual({ status: 0, stderr: "", stdout: "applied 0 URL updates and the new baseline\n" });
    expect(JSON.parse(readFileSync(join(box.root, baseline), "utf8"))).toEqual(state);
    expect(box.snapshot()).toEqual(withFiles(before, { [`checkout/${baseline}`]: `${JSON.stringify(state, null, 2)}\n` }));
  });
});
