import type { Catalogue } from "../content/schema";
import type { Assessment } from "../engine/types";
import { detectImporter, importerFor, importers, type ScanImporter, type ScanResult } from "../imports/index";

export type ToolChoice = "auto" | "m365-secure" | "prowler" | "scubagoggles";

/** Resolve which importer to use. `prowler` picks aws/azure via detect (or assessment platforms). */
export function resolveImporter(tool: ToolChoice, text: string, assessment?: Assessment): ScanImporter {
  if (tool === "auto") {
    const found = detectImporter(text);
    if (!found) throw new Error("could not detect the scan tool; pass --tool m365-secure|prowler|scubagoggles");
    return found;
  }
  if (tool === "prowler") {
    const found = detectImporter(text);
    if (found?.id.startsWith("prowler-")) return found;
    const preferAzure = assessment?.platforms.includes("microsoft") && !assessment.platforms.includes("aws");
    const id = preferAzure ? "prowler-azure" : "prowler-aws";
    const fallback = importerFor(id);
    if (!fallback) throw new Error(`no importer registered for ${id}`);
    return fallback;
  }
  const found = importerFor(tool);
  if (!found) throw new Error(`unknown tool '${tool}'`);
  return found;
}

/** Read a scan file with the chosen importer and the catalogue mapping. */
export function readScan(catalogue: Catalogue, importer: ScanImporter, text: string): ScanResult {
  const mapping = catalogue.imports.get(importer.id);
  if (!mapping) throw new Error(`crownguard has no mapping for ${importer.label} (${importer.id})`);
  const result = importer.read(text, mapping);
  if (!result.suggestions.length) throw new Error("none of the checks in this scan match a question");
  return result;
}

/** Apply scan suggestions onto an assessment (same rules as the wizard's `applyScan`). */
export function applyScan(
  assessment: Assessment,
  scan: ScanResult,
  opts: { platform: string; overwrite: boolean; licence: boolean },
): { assessment: Assessment; applied: number } {
  const answers = { ...assessment.answers };
  const evidence = { ...assessment.evidence };
  let applied = 0;
  for (const { question, evidence: ev } of scan.suggestions) {
    evidence[question] = ev;
    if (ev.suggested && (opts.overwrite || !answers[question])) {
      answers[question] = ev.suggested;
      applied++;
    }
  }
  const now = new Date().toISOString();
  return {
    applied,
    assessment: {
      ...assessment,
      answers,
      evidence,
      licence: opts.licence && scan.licence ? { ...assessment.licence, [opts.platform]: scan.licence } : assessment.licence,
      imports: [
        ...(assessment.imports ?? []),
        { source: scan.tool, toolVersion: scan.toolVersion, tenant: scan.tenant, scannedAt: scan.scannedAt, importedAt: now, applied },
      ],
      updatedAt: now,
    },
  };
}

export { detectImporter, importerFor, importers };
export type { ScanImporter, ScanResult };
