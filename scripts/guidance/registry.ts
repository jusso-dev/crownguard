/**
 * Every upstream source `pnpm guidance:update` keeps current. One entry per source; the upstreams themselves are
 * described in scripts/lib/upstreams.ts.
 *
 * Adding another OSCAL release (the ISM and Essentials for enterprise IT are the worked examples):
 *
 * 1. Describe it in scripts/lib/upstreams.ts and give its generator an `OscalGenerator` (the release files it reads
 *    and a `build` returning `{ yaml, ids }`, both with headers saying `at release tag <tag>`), like `ismGenerator`.
 * 2. Add an `oscalUpdater({...})` entry below.
 * 3. Add the generated files to `add-paths` in .github/workflows/guidance-update.yml. `run.test.ts` fails until the
 *    workflow and this registry agree.
 */
import { essentialsGenerator } from "../essentials/build";
import { ismGenerator } from "../ism/build";
import { ESSENTIALS_IT, ISM } from "../lib/upstreams";
import { oscalUpdater } from "./oscal";
import { prowlerUpdater, scubaUpdater } from "./scanners";
import type { GuidanceUpdater } from "./types";

export const UPDATERS: GuidanceUpdater[] = [
  oscalUpdater({ id: "ism", label: "ISM", name: "ISM controls from ASD's OSCAL catalog", upstream: ISM, generator: ismGenerator }),
  oscalUpdater({
    id: "essentials",
    label: "Essentials",
    name: "ASD Essentials for enterprise IT from ASD's OSCAL release",
    upstream: ESSENTIALS_IT,
    generator: essentialsGenerator,
  }),
  prowlerUpdater,
  scubaUpdater,
];
