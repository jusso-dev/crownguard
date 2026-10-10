/**
 * After `pnpm build`, check gzip sizes and that the entry chunk has no yaml / raw YAML questions.
 * Thresholds = recorded baseline + 10%. Fail the process on breach.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const root = join(import.meta.dirname, "..");
const assets = join(root, "dist", "assets");

/** Baselines recorded after the #13 split (bytes, gzip level 9). Update when intentionally growing. */
const BASELINE = {
  entryGzip: 231_200,
  largestLazyGzip: 568_600, // pdf.worker (react-pdf + yoga)
  totalJsGzip: 1_478_000,
};

const LIMIT = {
  entryGzip: Math.ceil(BASELINE.entryGzip * 1.1),
  largestLazyGzip: Math.ceil(BASELINE.largestLazyGzip * 1.1),
  totalJsGzip: Math.ceil(BASELINE.totalJsGzip * 1.1),
};

function gzipSize(buf: Buffer): number {
  return gzipSync(buf, { level: 9 }).length;
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

const files = readdirSync(assets)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const path = join(assets, f);
    const raw = readFileSync(path);
    return { name: f, path, raw: raw.length, gzip: gzipSize(raw), text: raw.toString("utf8") };
  })
  .sort((a, b) => b.gzip - a.gzip);

if (!files.length) {
  console.error("No JS assets in dist/assets — run pnpm build first.");
  process.exit(1);
}

const entry = files.find((f) => f.name.startsWith("index-")) ?? files[0];
const lazy = files.filter((f) => f !== entry);
const largestLazy = lazy[0];
const totalJsGzip = files.reduce((n, f) => n + f.gzip, 0);

console.log("Bundle size (gzip level 9)");
console.log("─────────────────────────");
for (const f of files) {
  const tag = f === entry ? " entry" : f === largestLazy ? " lazy*" : "";
  console.log(`${f.name.padEnd(42)} raw ${kb(f.raw).padStart(10)}  gzip ${kb(f.gzip).padStart(10)}${tag}`);
}
console.log("─────────────────────────");
console.log(`entry gzip        ${kb(entry.gzip).padStart(10)}  limit ${kb(LIMIT.entryGzip)}`);
console.log(`largest lazy gzip ${kb(largestLazy?.gzip ?? 0).padStart(10)}  limit ${kb(LIMIT.largestLazyGzip)}`);
console.log(`total JS gzip     ${kb(totalJsGzip).padStart(10)}  limit ${kb(LIMIT.totalJsGzip)}`);

const failures: string[] = [];

if (entry.gzip > LIMIT.entryGzip) failures.push(`entry gzip ${entry.gzip} > ${LIMIT.entryGzip}`);
if (largestLazy && largestLazy.gzip > LIMIT.largestLazyGzip)
  failures.push(`largest lazy gzip ${largestLazy.gzip} > ${LIMIT.largestLazyGzip}`);
if (totalJsGzip > LIMIT.totalJsGzip) failures.push(`total JS gzip ${totalJsGzip} > ${LIMIT.totalJsGzip}`);

// Entry must not ship the yaml library or raw YAML question banks.
const yamlLibHints = [/parseDocument\s*\(/, /YAMLError/, /yaml\.parse/, /"yaml"/];
for (const re of yamlLibHints) {
  if (re.test(entry.text)) failures.push(`entry chunk matches yaml-library pattern ${re}`);
}
// Distinctive question stems from platform YAML that should only live in lazy chunks.
const rawYamlHints = [
  "Does your organisation use Conditional Access",
  "Have you configured Google Workspace",
  "Is AWS Organizations",
];
for (const hint of rawYamlHints) {
  if (entry.text.includes(hint)) failures.push(`entry chunk contains raw YAML question text: ${JSON.stringify(hint)}`);
}

if (failures.length) {
  console.error("\nBundle budget FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nBundle budget OK");
