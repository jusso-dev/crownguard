import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { ImportLimitError } from "./limits";

describe("logical CSV record budget", () => {
  it.each([",", ";", "\t", "|"])("preserves %s, quotes, blank records and embedded line endings", (d) => {
    const text = `\r\nname${d}status\r\n"first\r\nsecond"${d}PASS\r\n  ${d} \r\n"escaped ""quote"""${d}FAIL\r\n`;
    // Delimiter sniffing stays caller-owned; leading blanks are tested separately.
    expect(parseCsv(text.trimStart(), { maxRows: 2 })).toEqual([
      ["name", "status"], ["first\r\nsecond", "PASS"], ['escaped "quote"', "FAIL"],
    ]);
  });

  it.each(["", "\n", "\r\n"])("counts every nonblank data record at EOF with suffix %j", (end) => {
    expect(parseCsv("\n\nheader\na" + end, { maxRows: 2 })).toHaveLength(2);
    expect(parseCsv("\n\nheader\na\na" + end, { maxRows: 2 })).toHaveLength(3);
    expect(() => parseCsv("\n\nheader\na\na\nunmapped" + end, { maxRows: 2 })).toThrow(ImportLimitError);
  });

  it("does not count quoted LF or blank rows, and excludes the first nonblank header", () => {
    expect(parseCsv('h\n"a\nb"\n\n\t\n', { maxRows: 1 })).toEqual([["h"], ["a\nb"]]);
    expect(() => parseCsv('h\n"a\nb"\nlast', { maxRows: 1 })).toThrow(ImportLimitError);
    expect(parseCsv("\n \n", { maxRows: 0 })).toEqual([]);
    expect(parseCsv("header", { maxRows: 0 })).toEqual([["header"]]);
  });
});
