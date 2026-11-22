// @vitest-environment node
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCliSandbox, put, withFiles } from "../lib/apply-cli-test";

// Independent contract, not derived from the registry under test.
const destinations = [
  "content/frameworks/ism.yaml",
  "scripts/ism/fixtures/ism-controls.txt",
  "content/frameworks/asd-essentials-enterprise-it.yaml",
  "scripts/essentials/fixtures/e4eit-actions.txt",
  "content/sources/standards.yaml",
  "e2e/fixtures/prowler-checks-aws.txt",
  "e2e/fixtures/prowler-checks-azure.txt",
  "e2e/fixtures/scubagoggles-controls.txt",
  "content/imports/prowler-aws.yaml",
  "content/imports/prowler-azure.yaml",
  "content/imports/scubagoggles.yaml",
];
const first = destinations[0];
const ids = destinations[1];
const idText = "# synthetic controls\n123\nABC\ncheck_name.with-hyphen\n\n  \n";
const bytes = (path: string) => path.endsWith(".txt") ? idText : `# synthetic ${path}\nitems: []\n`;
const sentinel = (path: string) => `existing ${path}\n`;

describe("guidance apply CLI", () => {
  let box: ReturnType<typeof applyCliSandbox>;
  const summary = (value: unknown) => put(join(box.artifacts, "summary.json"), JSON.stringify(value));
  const artifact = (path: string, text = bytes(path)) => put(join(box.artifacts, "files", path), text);

  beforeEach(() => {
    box = applyCliSandbox();
    for (const path of destinations) {
      put(join(box.root, path), sentinel(path));
      artifact(path);
    }
    put(join(box.root, "notes.txt"), "unlisted destination sentinel\n");
    artifact("notes.txt", "ordinary unlisted artifact\n");
    summary({ files: [first] });
  });
  afterEach(() => box?.cleanup());

  function rejected(diagnostic: RegExp, args?: string[], status = 1) {
    const before = box.snapshot();
    const result = box.run("guidance", args);
    expect(result.status).toBe(status);
    expect(result.stderr).toMatch(diagnostic);
    // Explicit first-file assertion makes interleaved-write regression evidence unambiguous.
    expect(readFileSync(join(box.root, first), "utf8")).toBe(sentinel(first));
    expect(box.snapshot()).toEqual(before);
    expect(result.stdout).toBe("");
  }

  it("requires a directory argument", () => rejected(/usage: pnpm guidance:apply/, [], 2));
  it("rejects missing summary", () => {
    rmSync(join(box.artifacts, "summary.json"));
    rejected(/ENOENT.*summary\.json/);
  });
  it("rejects malformed summary", () => {
    put(join(box.artifacts, "summary.json"), "{ unfinished");
    rejected(/SyntaxError/);
  });
  it.each([
    ["missing files", {}, /"path":\s*\[\s*"files"/],
    ["wrong files type", { files: "file" }, /expected array/],
    ["non-string entry", { files: [42] }, /expected string/],
    ["unlisted path", { files: ["notes.txt"] }, /not a path any updater writes/],
    ["later unlisted path", { files: [first, "notes.txt"] }, /not a path any updater writes/],
  ] as const)("rejects %s before writing", (_name, value, diagnostic) => {
    summary(value);
    rejected(diagnostic);
  });
  it("accepts empty files and producer metadata without changes", () => {
    summary({ files: [], generatedAt: "2026-11-15", updates: [{ id: "ism", changed: false }] });
    const before = box.snapshot();
    expect(box.run("guidance")).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(box.snapshot()).toEqual(before);
  });
  it("rejects a missing single artifact", () => {
    rmSync(join(box.artifacts, "files", first));
    rejected(/summary lists content\/frameworks\/ism.yaml but the run did not include it/);
  });
  it("rejects invalid single ID list", () => {
    summary({ files: [ids] });
    artifact(ids, "ordinary words with spaces\n");
    rejected(/has a line that is neither a comment nor an id/);
  });
  it("preserves first file when later artifact is missing", () => {
    summary({ files: [first, ids] });
    rmSync(join(box.artifacts, "files", ids));
    rejected(/summary lists scripts\/ism\/fixtures\/ism-controls.txt but the run did not include it/);
  });
  it("preserves first file when later ID list is invalid", () => {
    summary({ files: [first, ids] });
    artifact(ids, "ordinary words with spaces\n");
    rejected(/has a line that is neither a comment nor an id/);
  });
  it("copies all eleven destinations in manifest order and repeats unchanged", () => {
    summary({ files: destinations, producer: "synthetic", updates: [] });
    const before = box.snapshot();
    const success = { status: 0, stderr: "", stdout: destinations.map((path) => `applied ${path}\n`).join("") };
    expect(box.run("guidance", ["--", box.artifacts])).toEqual(success);
    const after = withFiles(before, Object.fromEntries(destinations.map((path) => [`checkout/${path}`, bytes(path)])));
    expect(box.snapshot()).toEqual(after);
    expect(box.run("guidance")).toEqual(success);
    expect(box.snapshot()).toEqual(after);
  });
});
