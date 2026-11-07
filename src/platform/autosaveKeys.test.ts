import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autosaveKeys } from "./types";

describe("autosave keys", () => {
  it("are exactly the keys the desktop backend accepts", () => {
    const rust = readFileSync(new URL("../../src-tauri/src/commands.rs", import.meta.url), "utf8");
    const block = rust.match(/const AUTOSAVE_KEYS: &\[&str\] = &\[([\s\S]*?)\];/)?.[1] ?? "";
    const allowed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(allowed.sort()).toEqual(Object.values(autosaveKeys).sort());
  });
});
