import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { emptyAssessment } from "../format/empty";
import { toSaveFile } from "../format/saveFile";
import { run } from "./index";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("../imports/limits", async (original) => {
  const actual = await original<typeof import("../imports/limits")>();
  Object.assign(actual.importLimits, { maxBytes: 8192, maxRows: 3, m365MaxRows: 2 });
  return actual;
});
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function capture(args: string[]) {
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  const code = await run(args);
  const result = { code, stdout: stdout.mock.calls.flat().join("\n"), stderr: stderr.mock.calls.flat().join("\n") };
  stdout.mockRestore(); stderr.mockRestore();
  return result;
}
const setup = () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "cg-import-limit-"));
  dirs.push(dir);
  const assessment = join(dir, "assessment.json");
  const scan = join(dir, "scan.json");
  const original = toSaveFile({ ...emptyAssessment(), platforms: ["microsoft", "aws", "google"], modules: { microsoft: ["azure"] } });
  fs.writeFileSync(assessment, original);
  return { assessment, scan, original };
};

it.each(["auto", "m365-secure", "prowler", "scubagoggles"])("rejects bytes with %s, leaves assessment identical, then accepts a retry", async (tool) => {
  const { assessment, scan, original } = setup();
  fs.writeFileSync(scan, "x".repeat(8193));
  const write = vi.spyOn(fs, "writeFileSync");
  const result = await capture(["import", assessment, scan, "--tool", tool, "--overwrite", "--licence"]);
  expect(result).toMatchObject({ code: 1, stdout: "" });
  expect(result.stderr).toMatch(/8 MB.*Nothing was applied/);
  expect(write).not.toHaveBeenCalled();
  expect(fs.readFileSync(assessment, "utf8")).toBe(original);
  write.mockRestore();
  fs.writeFileSync(scan, 'CHECK_ID,STATUS\niam_root_mfa_enabled,PASS');
  expect((await capture(["import", assessment, scan, "--tool", "prowler"])).code).toBe(0);
});

it.each([
  ["m365-secure", '{"summary":{"tenant":{"primary_domain":"example.test"}},"findings":[null,null,null]}', /2 findings/],
  ["prowler", 'CHECK_ID,STATUS\nunknown,PASS\nunknown,PASS\nunknown,PASS\nunknown,FAIL', /3 input records/],
  ["scubagoggles", '{"MetaData":{"Tool":"ScubaGoggles"},"Results":{"A":[{"Controls":[{},{},{},{}]}]}}', /3 input records/],
] as const)("classifies %s raw-row errors as invalid input for auto and explicit tools", async (tool, text, reason) => {
  const { assessment, scan, original } = setup();
  fs.writeFileSync(scan, text);
  const write = vi.spyOn(fs, "writeFileSync");
  for (const selected of ["auto", tool]) {
    const result = await capture(["import", assessment, scan, "--tool", selected, "--overwrite", "--licence"]);
    expect(result).toMatchObject({ code: 1, stdout: "" });
    expect(result.stderr).toMatch(reason);
  }
  expect(write).not.toHaveBeenCalled();
  expect(fs.readFileSync(assessment, "utf8")).toBe(original);
});

it("rejects an oversized assessment/scan alias before any write", async () => {
  const { assessment, original } = setup();
  const padded = original + " ".repeat(8193);
  fs.writeFileSync(assessment, padded);
  const write = vi.spyOn(fs, "writeFileSync");
  const result = await capture(["import", assessment, assessment, "--tool", "m365-secure", "--overwrite", "--licence"]);
  expect(result).toMatchObject({ code: 1, stdout: "" });
  expect(result.stderr).toMatch(/8 MB/);
  expect(write).not.toHaveBeenCalled();
  expect(fs.readFileSync(assessment, "utf8")).toBe(padded);
});

it("checks decoded UTF-8 bytes as well as original source bytes", async () => {
  const { assessment, scan, original } = setup();
  fs.writeFileSync(scan, Buffer.alloc(3000, 0xff));
  const write = vi.spyOn(fs, "writeFileSync");
  const result = await capture(["import", assessment, scan, "--tool", "m365-secure"]);
  expect(result).toMatchObject({ code: 1, stdout: "" });
  expect(result.stderr).toMatch(/8 MB/);
  expect(write).not.toHaveBeenCalled();
  expect(fs.readFileSync(assessment, "utf8")).toBe(original);
});
