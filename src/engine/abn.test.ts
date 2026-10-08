import { describe, expect, it } from "vitest";
import { formatAbn, isValidAbn } from "./abn";

describe("ABN", () => {
  it("accepts valid ABNs in any spacing", () => {
    expect(isValidAbn("51 824 753 556")).toBe(true); // ATO's published example
    expect(isValidAbn("51824753556")).toBe(true);
    expect(isValidAbn("53 004 085 616")).toBe(true);
  });

  it("rejects bad checksums, wrong lengths and letters", () => {
    expect(isValidAbn("51 824 753 557")).toBe(false);
    expect(isValidAbn("5182475355")).toBe(false);
    expect(isValidAbn("51 824 753 55a")).toBe(false);
    expect(isValidAbn("")).toBe(false);
  });

  it("formats as 2-3-3-3", () => {
    expect(formatAbn("51824753556")).toBe("51 824 753 556");
    expect(formatAbn("5182")).toBe("51 82");
  });
});
