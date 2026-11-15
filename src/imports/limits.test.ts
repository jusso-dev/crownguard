import { afterEach, expect, it, vi } from "vitest";
import { assertImportBytes, assertImportRows, assertImportText, ImportLimitError, importLimits } from "./limits";

const policy = { ...importLimits };
afterEach(() => { Object.assign(importLimits, policy); vi.restoreAllMocks(); });

it("pins the inclusive production policy, separate from evidence limits", () => {
  expect(importLimits).toEqual({ maxBytes: 8_000_000, maxRows: 50_000, m365MaxRows: 5_000 });
  expect(() => assertImportBytes(8_000_000)).not.toThrow();
  expect(() => assertImportBytes(8_000_001)).toThrow(ImportLimitError);
  for (const max of [50_000, 5_000]) {
    expect(() => assertImportRows(max, max)).not.toThrow();
    expect(() => assertImportRows(max + 1, max)).toThrow(ImportLimitError);
  }
});

it.each([["abcd", 4], ["éé", 4], ["界", 3], ["😀", 4], ["\ud800", 3]] as const)("measures UTF-8 including replacement semantics: %s", (text, bytes) => {
  Object.assign(importLimits, { maxBytes: bytes });
  expect(assertImportText(text)).toBe(bytes);
  expect(() => assertImportText(text + "a")).toThrow(ImportLimitError);
});

it("rejects oversized code units before allocating an encoding", () => {
  Object.assign(importLimits, { maxBytes: 4 });
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  expect(() => assertImportText("abcde")).toThrow(ImportLimitError);
  expect(encode).not.toHaveBeenCalled();
});
