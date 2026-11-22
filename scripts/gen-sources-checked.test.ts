import { describe, expect, it } from "vitest";
import { newestFeedDate } from "./gen-sources-checked";

describe("sources last checked", () => {
  it("uses the newest feed cursor, ignoring cursors dated after the run", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const state = { feeds: { a: { latest: "2026-10-30T00:00:00.000Z" }, b: { latest: "2062-10-02T00:00:00.000Z" }, c: { latest: "2026-11-04T01:00:00.000Z" } } };
    expect(newestFeedDate(state, now)).toBe("2026-11-04");
    expect(newestFeedDate({ feeds: { b: { latest: "2062-10-02T00:00:00.000Z" } } }, now)).toBeUndefined();
  });
});
