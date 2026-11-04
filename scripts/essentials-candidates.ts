/**
 * Dev-time helper for tagging questions with ASD Essentials actions (issue #33). For each question it prints the
 * crownguard domain, the question text, its current `essentials:` tags, and the enterprise IT actions whose ISM
 * evidence (ASD's "potential evidence sources") overlaps the question's ISM refs. The overlap is a prompt for review,
 * not a mapping: ASD says to check controls "rather than assume they are equivalent".
 *
 *   pnpm exec tsx scripts/essentials-candidates.ts [--platform microsoft] [--untagged]
 */
import { loadCatalogue } from "../src/content/loader";
import { readContentFiles } from "./read-content";

const args = process.argv.slice(2);
const platform = args.includes("--platform") ? args[args.indexOf("--platform") + 1] : undefined;
const untaggedOnly = args.includes("--untagged");

const { catalogue, errors } = loadCatalogue(readContentFiles());
if (errors.length) console.error(`${errors.length} content error(s); run pnpm validate:content\n`);
const it = [...catalogue.frameworks.values()].find((f) => f.essentials?.chapter === "enterprise-it");
if (!it) throw new Error("no Essentials enterprise IT framework in content/frameworks");

let shown = 0;
let withCandidates = 0;
const actionsSeen = new Set<string>();
for (const [id, bundle] of catalogue.platforms) {
  if (platform && id !== platform) continue;
  for (const q of bundle.questions) {
    if (untaggedOnly && (q.essentials.length || q.essentialsReviewed)) continue;
    const ismRefs = new Set(q.refs.filter((r) => r.framework === "ism").map((r) => r.ref));
    const candidates = it.controls.filter((c) => [...(c.evidence?.ism ?? []), ...(c.evidence?.e8 ?? [])].some((ref) => ismRefs.has(ref)));
    shown++;
    if (candidates.length) withCandidates++;
    for (const c of candidates) actionsSeen.add(c.id);
    console.log(`${q.id} [${q.domain}] ${q.question}`);
    if (ismRefs.size) console.log(`  ism: ${[...ismRefs].join(", ")}`);
    for (const t of q.essentials) console.log(`  tagged ${t.action} [${t.domains.join(", ")}] ${t.coverage}${t.note ? `: ${t.note}` : ""}`);
    if (q.essentialsReviewed) console.log(`  reviewed: ${q.essentialsReviewed}`);
    for (const c of candidates) {
      const hits = [...(c.evidence?.ism ?? []), ...(c.evidence?.e8 ?? [])].filter((ref) => ismRefs.has(ref));
      const mark = q.essentials.some((t) => t.action === c.id) ? "=" : "?";
      console.log(`  ${mark} ${c.id} [${(c.domains ?? []).join(", ")}] via ${hits.join(", ")}: ${c.title}`);
    }
    console.log();
  }
}
console.log(`${shown} question(s), ${withCandidates} with ISM-suggested candidates across ${actionsSeen.size} action(s)`);
