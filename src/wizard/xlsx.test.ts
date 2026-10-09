// @vitest-environment node
import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, crc32, xmlText, zipStore } from "./xlsx";

/** Reads a stored zip back through its central directory, checking each entry against its local header. */
function unzip(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const files = new Map<string, string>();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    expect(v.getUint16(p + 8, true) & 0x0800).toBe(0x0800);
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(offset, true)).toBe(0x04034b50);
    const data = zip.subarray(offset + 30 + nameLen, offset + 30 + nameLen + size);
    expect(nodeCrc32(data)).toBe(crc);
    files.set(name, dec.decode(data));
    p += 46 + nameLen;
  }
  return files;
}

describe("XLSX writer", () => {
  it("computes the same CRC-32 as zlib", () => {
    for (const s of ["", "a", "crownguard", "Ünïcödé ✓".repeat(50)]) {
      const b = new TextEncoder().encode(s);
      expect(crc32(b)).toBe(nodeCrc32(b));
    }
  });

  it("writes a zip that reads back with UTF-8 names", () => {
    const enc = new TextEncoder();
    const files = unzip(zipStore([{ name: "a.txt", data: enc.encode("one") }, { name: "dir/é.xml", data: enc.encode("<x/>") }]));
    expect([...files]).toEqual([["a.txt", "one"], ["dir/é.xml", "<x/>"]]);
  });

  it("names columns A1-style", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("escapes XML and drops characters XML can't carry", () => {
    expect(xmlText(`<a href="x">&\u0001</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });

  it("builds a workbook with every part, inline strings and a frozen header", () => {
    const files = unzip(
      buildXlsx([
        { name: "Register", header: true, widths: [30, 12], rows: [["Use case name", "Domain"], ["Example: <Copilot> & co", "=1+1"]] },
        { name: "About: notes?", rows: [["Columns", "The first 16"]] },
      ]),
    );
    for (const part of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"])
      expect(files.has(part), part).toBe(true);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="A2" t="inlineStr" s="2"><is><t xml:space="preserve">Example: &lt;Copilot&gt; &amp; co</t></is></c>');
    // Text cells, never formulas.
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(files.get("xl/workbook.xml")).toContain('name="About  notes "');
  });
});
