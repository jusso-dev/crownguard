// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ASD says Essentials priority phases are "a sequencing mechanism, not a rating or maturity model", and that Essential
 * Eight maturity levels "do not automatically translate" into Essentials ratings. This guard keeps the shipped copy
 * from saying otherwise.
 */
export const BANNED = [
  /\bEssentials (?:maturity )?levels?\b/i,
  /\bphase [123] (?:compliant|compliance|level|tier|maturity)\b/i,
  /\b(?:compliant|complies) with (?:priority )?phase\b/i,
  /\bML[123] equivalent\b/i,
  /\bequivalent to ML[123]\b/i,
  /\bEssentials (?:certified|certification|compliant|compliance)\b/i,
  /\bpriority (?:level|tier)s?\b/i,
];

const root = join(import.meta.dirname, "..");
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });

const shipped = [
  ...files("src/report", /\.tsx?$/),
  "src/engine/essentials.ts",
  "src/wizard/EssentialsOption.tsx",
  "src/cli/views.ts",
  ...files("content/frameworks", /^asd-essentials-.*\.yaml$/),
  ...files("docs", /\.md$/),
  "README.md",
].filter((f) => !f.endsWith(".test.ts"));

describe("Essentials wording", () => {
  it("never calls a phase a level, a rating or a compliance state, or converts maturity levels", () => {
    const hits: string[] = [];
    for (const f of shipped) {
      const lines = readFileSync(join(root, f), "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const re of BANNED) if (re.test(line)) hits.push(`${relative(root, join(root, f))}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("catches the phrases it is meant to", () => {
    for (const bad of ["reaches Essentials level 2", "phase 1 compliant", "ML2 equivalent", "Essentials certified", "priority levels"])
      expect(BANNED.some((re) => re.test(bad)), bad).toBe(true);
    for (const ok of ["Phases are ASD's order for doing the work, not a rating.", "Essential Eight Maturity Level 2", "priority phase 1 domains"])
      expect(BANNED.some((re) => re.test(ok)), ok).toBe(false);
  });
});
