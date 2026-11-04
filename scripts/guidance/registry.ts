/**
 * Every upstream source `pnpm guidance:update` keeps current. One entry per source.
 *
 * Adding another OSCAL release (the ISM and Essentials for enterprise IT are the worked examples):
 *
 * 1. Give its generator a `build(files, { tag, retrieved, previousYaml })` function returning `{ yaml, ids }`, like
 *    `buildIsm` and `buildEssentials`, and have both files' headers say `at release tag <tag>`.
 * 2. Add an `oscalUpdater({...})` entry below with its repo, catalog file name, framework id, the two generated
 *    files, its feed in scripts/watch/feeds.ts (if it has one) and the content/sources entry linking the release.
 * 3. Add the two generated files to `add-paths` in .github/workflows/guidance-update.yml. `run.test.ts` fails until
 *    the workflow and this registry agree.
 */
import { buildEssentials, CATALOG as E4EIT_CATALOG, MAPPINGS as E4EIT_MAPPINGS, parseInputs as parseE4eit, profileName, REPO as E4EIT_REPO } from "../essentials/build";
import { DOMAIN_SLUGS, type DomainSlug } from "../essentials/oscal";
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
    files: ["ISM_catalog.json"],
    framework: "ism",
    frameworkFile: "content/frameworks/ism.yaml",
    idsFile: "scripts/ism/fixtures/ism-controls.txt",
    feed: "ism-oscal-releases",
    source: { file: "content/sources/standards.yaml", id: ismOscalSourceId },
    build: (files, opts) => buildIsm(parseIsmCatalog(files["ISM_catalog.json"]), opts),
  }),
  oscalUpdater({
    id: "essentials",
    label: "Essentials",
    name: "ASD Essentials for enterprise IT from ASD's OSCAL release",
    repo: E4EIT_REPO,
    files: [E4EIT_CATALOG, E4EIT_MAPPINGS, ...(Object.keys(DOMAIN_SLUGS) as DomainSlug[]).map(profileName)],
    framework: "asd-essentials-enterprise-it",
    frameworkFile: "content/frameworks/asd-essentials-enterprise-it.yaml",
    idsFile: "scripts/essentials/fixtures/e4eit-actions.txt",
    feed: "e4eit-oscal-releases",
    // No `source`: asd-essentials-oscal cites ASD's releases page, not one tag, so it never needs moving.
    build: (files, opts) => buildEssentials(parseE4eit((name) => files[name]), opts),
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
