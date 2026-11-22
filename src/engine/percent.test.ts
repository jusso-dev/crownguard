import { describe, expect, it } from "vitest";
import { percent } from "./percent";

describe("percent", () => {
  it("only shows 100% or 0% for exact values", () => {
    expect([0, 0.004, 0.5, 0.994, 0.995, 0.9999, 1].map(percent)).toEqual([0, 1, 50, 99, 99, 99, 100]);
  });
});
