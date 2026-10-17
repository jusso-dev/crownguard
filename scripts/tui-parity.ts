/**
 * Checks the Rust terminal app's scoring (tui/src/engine.rs) against the TypeScript engine, which is the reference.
 * Scores the e2e fixtures and a few hundred random assessments with both and fails on any difference in the
 * crown-jewel summary `cg score` prints.
 *
 *   cargo build --manifest-path tui/Cargo.toml && pnpm tui:parity
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReport, emptyAssessment, loadCatalogueFromDisk, parseAssessment, questionIdsOf, scoreSummary, toSaveFile, type Assessment } from "../src/lib";

const BIN = process.env.CROWNGUARD_TUI_BIN ?? "tui/target/debug/crownguard";
const RUNS = Number(process.env.PARITY_RUNS ?? 300);
/** Keys of `cg score`'s JSON that the Rust app reproduces. SOC, IDCF and the AI register are web-only. */
const KEYS = ["posture", "inPlace", "partial", "assessed", "inScope", "unanswered", "naMissingReason", "risks", "domains", "e8", "roadmap"] as const;

const { catalogue, errors } = loadCatalogueFromDisk();
if (errors.length) throw new Error(`content errors:\n${errors.join("\n")}`);
const questionIds = questionIdsOf(catalogue);

// Small seeded PRNG so a failure can be reproduced from its seed.
function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const some = <T>(xs: readonly T[], p: number) => xs.filter(() => next() < p);
  return { next, pick, some };
}

const answers = ["yes", "partial", "no", "unknown", "na"] as const;
const regulations = ["privacy-act", "soci", "cps-234", "pci", "gdpr", "hipaa", "other"] as const;
const exposures = ["external-sharing", "guest-access", "internet-facing", "standing-admin", "third-party-apps", "unmanaged-devices", "ai-grounding"] as const;
const classifications = ["public", "internal", "confidential", "highly-confidential"] as const;
const ratings = [1, 2, 3, 4, 5] as const;

function randomAssessment(seed: number): Assessment {
  const r = rng(seed);
  const a = emptyAssessment();
  a.org.name = `Seed ${seed}`;
  const bundles = [...catalogue.platforms.values()];
  const chosen = r.some(bundles, 0.6);
  if (!chosen.length) chosen.push(r.pick(bundles));
  for (const b of chosen) {
    const pid = b.platform.id;
    a.platforms.push(pid);
    a.modules[pid] = r.some(b.platform.modules.filter((m) => m.optional), 0.5).map((m) => m.id);
    if (r.next() < 0.7) a.licence[pid] = r.pick(b.platform.licenceTiers).id;
    const n = Math.floor(r.next() * 6);
    for (let i = 0; i < n; i++) {
      const t = r.pick(b.assetTypes);
      a.jewels.push({
        id: `j-${seed}-${pid}-${i}`,
        name: `${t.name} ${i}`,
        platform: pid,
        assetType: t.id,
        description: "",
        classification: r.pick(classifications),
        confidentiality: r.pick(ratings),
        integrity: r.pick(ratings),
        availability: r.pick(ratings),
        regulations: r.some(regulations, 0.15),
        exposures: r.some(exposures, 0.2),
        businessProcesses: "",
      });
    }
    // Sometimes leave a platform selected with jewels elsewhere, or deselect one that has jewels.
    const fill = r.next();
    for (const q of b.questions) {
      if (r.next() > fill) continue;
      const ans = r.pick(answers);
      a.answers[q.id] = ans;
      if (ans === "na" && r.next() < 0.6) a.notes[q.id] = "Not used here";
      else if (ans === "na" && r.next() < 0.3) a.notes[q.id] = "   ";
    }
  }
  if (a.platforms.length > 1 && r.next() < 0.2) a.platforms.pop();
  return a;
}

function tsSummary(text: string) {
  const parsed = parseAssessment(JSON.parse(text), { questionIds });
  if (parsed.kind !== "ok") throw new Error(parsed.kind === "error" ? parsed.message : "file is newer than this build");
  return scoreSummary(buildReport(catalogue, parsed.assessment)) as Record<string, unknown>;
}

function rustSummary(path: string) {
  return JSON.parse(execFileSync(BIN, ["score", path], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as Record<string, unknown>;
}

/** Deep compare with a small tolerance for floats; returns the first differing path. */
function diff(x: unknown, y: unknown, path: string): string | undefined {
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < 1e-9 ? undefined : `${path}: ${x} ≠ ${y}`;
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return `${path}: length ${x.length} ≠ ${y.length}`;
    for (let i = 0; i < x.length; i++) {
      const d = diff(x[i], y[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  if (x && y && typeof x === "object" && typeof y === "object") {
    const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
    for (const k of keys) {
      const d = diff((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return undefined;
  }
  return Object.is(x ?? null, y ?? null) ? undefined : `${path}: ${JSON.stringify(x)} ≠ ${JSON.stringify(y)}`;
}

const dir = mkdtempSync(join(tmpdir(), "cg-parity-"));
const failures: string[] = [];
try {
  const cases: [string, string][] = readdirSync("e2e/fixtures")
    .filter((f) => f.endsWith(".crownguard.json"))
    .map((f) => [f, readFileSync(join("e2e/fixtures", f), "utf8")]);
  for (let seed = 1; seed <= RUNS; seed++) cases.push([`seed ${seed}`, toSaveFile(randomAssessment(seed))]);

  for (const [name, text] of cases) {
    const path = join(dir, "case.crownguard.json");
    writeFileSync(path, text);
    const ts = tsSummary(text);
    const rs = rustSummary(path);
    for (const key of KEYS) {
      const d = diff(ts[key], rs[key], key);
      if (d) {
        failures.push(`${name}: ${d}`);
        break;
      }
    }
  }
  console.log(`${cases.length} assessments scored by both engines, ${failures.length} differ`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failures.length) {
  for (const f of failures.slice(0, 20)) console.error(`  - ${f}`);
  process.exit(1);
}
