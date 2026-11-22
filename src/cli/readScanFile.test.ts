import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ImportLimitError } from "../imports/limits";
import { readScanFile } from "./readScanFile";

vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>() }));
vi.mock("../imports/limits", async (original) => {
  const actual = await original<typeof import("../imports/limits")>();
  Object.assign(actual.importLimits, { maxBytes: 8 });
  return actual;
});
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const file = (content: string | Buffer) => {
  const dir = fs.mkdtempSync(join(tmpdir(), "cg-scan-read-"));
  dirs.push(dir);
  const path = join(dir, "scan");
  fs.writeFileSync(path, content);
  return path;
};

it("accepts exactly N bytes, follows regular symlinks and closes the same descriptor", () => {
  const path = file("12345678");
  fs.symlinkSync(path, path + "-link");
  const open = vi.spyOn(fs, "openSync");
  const close = vi.spyOn(fs, "closeSync");
  expect(readScanFile(path + "-link")).toBe("12345678");
  expect(open).toHaveBeenCalledExactlyOnceWith(path + "-link", fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  expect(close).toHaveBeenCalledExactlyOnceWith(open.mock.results[0].value);
});

it("rejects N+1 before reading and closes the descriptor", () => {
  const path = file("123456789");
  const read = vi.spyOn(fs, "readSync");
  const close = vi.spyOn(fs, "closeSync");
  expect(() => readScanFile(path)).toThrow(ImportLimitError);
  expect(read).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it("rejects non-regular descriptors without reading, using a nonblocking open", () => {
  const path = file("");
  vi.spyOn(fs, "fstatSync").mockReturnValue({ size: 0, isFile: () => false } as fs.Stats);
  const open = vi.spyOn(fs, "openSync");
  const read = vi.spyOn(fs, "readSync");
  const close = vi.spyOn(fs, "closeSync");
  expect(() => readScanFile(path)).toThrow(/regular file/);
  expect(open.mock.calls[0][1]).toBe(fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  expect(read).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
});

it("counts BOM bytes before stripping and retains UTF-8 replacement decoding", () => {
  expect(readScanFile(file("\uFEFF12345"))).toBe("12345");
  expect(() => readScanFile(file("\uFEFF123456"))).toThrow(ImportLimitError);
  expect(readScanFile(file(Buffer.from([0xff])))).toBe("�");
});

it("continues short reads through EOF without reopening by path", () => {
  const path = file("12345678");
  const original = fs.readSync;
  const read = vi.spyOn(fs, "readSync").mockImplementation((fd, buffer, options) => original(fd, buffer, { ...options, length: Math.min(options?.length ?? buffer.byteLength, 2) }));
  const open = vi.spyOn(fs, "openSync");
  expect(readScanFile(path)).toBe("12345678");
  expect(read).toHaveBeenCalledTimes(5);
  expect(open).toHaveBeenCalledTimes(1);
});

it("bounds growth after stat to the sentinel byte", () => {
  const path = file("123456789");
  vi.spyOn(fs, "fstatSync").mockReturnValue({ size: 2, isFile: () => true } as fs.Stats);
  const read = vi.spyOn(fs, "readSync");
  const close = vi.spyOn(fs, "closeSync");
  expect(() => readScanFile(path)).toThrow(ImportLimitError);
  expect(read.mock.calls[0][1].byteLength).toBe(9);
  expect(read.mock.results.reduce((n, r) => n + Number(r.value), 0)).toBe(9);
  expect(close).toHaveBeenCalledTimes(1);
});

it("closes on stat or read failures", () => {
  const path = file("abc");
  const close = vi.spyOn(fs, "closeSync");
  vi.spyOn(fs, "fstatSync").mockImplementationOnce(() => { throw new Error("stat failed"); });
  expect(() => readScanFile(path)).toThrow("stat failed");
  vi.spyOn(fs, "readSync").mockImplementationOnce(() => { throw new Error("read failed"); });
  expect(() => readScanFile(path)).toThrow("read failed");
  expect(close).toHaveBeenCalledTimes(2);
});
