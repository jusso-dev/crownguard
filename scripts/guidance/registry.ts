/**
 * Every upstream source `pnpm guidance:update` keeps current. One entry per source.
 *
 * Adding an OSCAL catalog (for example ASD's Essentials for enterprise IT from
 * `AustralianCyberSecurityCentre/e4eit-oscal`, built by `pnpm essentials:build -- --tag <tag>`):
 *
 * 1. Give its generator a `build(catalog, { tag, retrieved, previousYaml })` function returning `{ yaml, ids }`,
 *    like `buildIsm` in scripts/ism/build.ts, and have both files' headers say `at release tag <tag>`.
 * 2. Add an `oscalUpdater({...})` entry below with its repo, catalog file name, framework id, the two generated
 *    files, its feed in scripts/watch/feeds.ts (if it has one) and the content/sources entry linking the release.
 * 3. Add the two generated files to `add-paths` in .github/workflows/guidance-update.yml. `run.test.ts` fails until
 *    the workflow and this registry agree.
 */
import { buildIsm, ismOscalSourceId, REPO as ISM_REPO } from "../ism/build";
import { oscalCatalogFileSchema } from "../ism/oscal";
import { oscalUpdater } from "./oscal";
import { prowlerList, scannerUpdater, scubaList } from "./scanners";
import type { GuidanceUpdater } from "./types";

/** Parse catalog JSON with the generator's strict schema, so a shape change stops the run. */
const parseIsmCatalog = (text: string) => {
  const parsed = oscalCatalogFileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`ISM_catalog.json does not match the expected OSCAL shape (${parsed.error.issues.length} issue(s), first at ${first?.path.join(".")}: ${first?.message})`);
  }
  return parsed.data;
};

const PROWLER = "prowler-cloud/prowler";
const SCUBAGOGGLES = "cisagov/ScubaGoggles";

export const UPDATERS: GuidanceUpdater[] = [
  oscalUpdater({
    id: "ism",
    label: "ISM",
    name: "ISM controls from ASD's OSCAL catalog",
    repo: ISM_REPO,
    catalog: "ISM_catalog.json",
    framework: "ism",
    frameworkFile: "content/frameworks/ism.yaml",
    idsFile: "scripts/ism/fixtures/ism-controls.txt",
    feed: "ism-oscal-releases",
    source: { file: "content/sources/standards.yaml", id: ismOscalSourceId },
    build: (catalog, opts) => buildIsm(parseIsmCatalog(catalog), opts),
  }),
  scannerUpdater({
    id: "prowler",
    label: "Prowler",
    name: "Prowler AWS and Azure check ids",
    repo: PROWLER,
    feed: "prowler-releases",
    lists: [prowlerList(PROWLER, "aws"), prowlerList(PROWLER, "azure")],
  }),
  scannerUpdater({
    id: "scubagoggles",
    label: "ScubaGoggles",
    name: "ScubaGoggles Google Workspace policy ids",
    repo: SCUBAGOGGLES,
    feed: "scubagoggles-releases",
    lists: [scubaList(SCUBAGOGGLES)],
  }),
];
