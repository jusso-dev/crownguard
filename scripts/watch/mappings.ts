import type { Catalogue } from "../../src/content/schema";
import { checkDrift, checkFamily, mappedChecks } from "../lib/scanner-checks";
import { mappingFile } from "../lib/upstreams";
import type { Finding } from "./types";

/** Upstream check list for one import mapping, injected by the watch run or a test. */
export interface UpstreamChecks {
  /** Import mapping id, e.g. `m365-secure`. */
  mappingId: string;
  /** Check ids currently published upstream. */
  ids: Iterable<string>;
}

/** Check ids from an M365-Secure `docs/CHECKS.md` table. */
export function parseM365ChecksMd(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([A-Z][A-Z0-9-]+)\s*\|/);
    if (m && m[1].toLowerCase() !== "check id") ids.push(m[1]);
  }
  return ids;
}

/**
 * Compare crownguard's import mappings with upstream check lists. Missing mapped ids are actionable; new checks in a
 * family that already has mappings are suggestions.
 */
export function checkMappingDrift(catalogue: Catalogue, upstream: UpstreamChecks[]): Finding[] {
  const findings: Finding[] = [];
  for (const u of upstream) {
    const mapping = catalogue.imports.get(u.mappingId);
    if (!mapping) {
      findings.push({ kind: "mapping", title: u.mappingId, url: "", actionable: false, detail: `No import mapping named ${u.mappingId} in content/imports.`, citedBy: [] });
      continue;
    }
    const file = mappingFile(mapping.id);
    const { removed, added } = checkDrift(mappedChecks(mapping.mappings), u.ids);
    for (const { id, questions } of removed)
      findings.push({
        kind: "mapping",
        title: `${mapping.name}: ${id} removed upstream`,
        url: mapping.url,
        actionable: true,
        detail: `Mapped check ${id} is gone from upstream; used by ${questions.join(", ")} in ${file}.`,
        citedBy: questions,
      });
    for (const id of added)
      findings.push({
        kind: "mapping",
        title: `${mapping.name}: new ${id}`,
        url: mapping.url,
        actionable: true,
        detail: `New upstream check ${id} in mapped family ${checkFamily(id)}; consider adding it to ${file}.`,
        citedBy: [],
      });
  }
  return findings;
}
