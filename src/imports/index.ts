import { m365SecureImporter } from "./m365Secure";
import { prowlerImporter } from "./prowler";
import { scubagogglesImporter } from "./scubagoggles";
import type { Catalogue } from "../content/schema";
import type { Assessment } from "../format/schema";
import type { ScanImporter, ScanResult } from "./types";

/**
 * Every scanner crownguard can read. The mapping from its check ids to crownguard questions lives in
 * `content/imports/<id>.yaml`, so a new scanner is a new importer here plus a mapping file, not a new panel.
 */
export const importers: ScanImporter[] = [m365SecureImporter, prowlerImporter("aws"), prowlerImporter("microsoft"), scubagogglesImporter];

const importerFor = (id: string): ScanImporter | undefined => importers.find((i) => i.id === id);

/** The importer that recognises this file, whichever platform it belongs to. */
export function detectImporter(text: string): ScanImporter | undefined {
  return importers.find((i) => i.detect(text));
}

/** The `--tool` names: every importer id, with one `prowler` standing for both Prowler importers. */
export const toolChoices: readonly string[] = ["auto", ...new Set(importers.map((i) => i.id.replace(/^prowler-.*/, "prowler")))];

/**
 * The importer for a scan file. `auto` detects it; `prowler` detects which cloud, falling back to the assessment's
 * platforms because a Prowler file with no findings doesn't say.
 */
export function resolveImporter(tool: string, text: string, assessment?: Assessment): ScanImporter {
  const found = detectImporter(text);
  if (tool === "auto") {
    if (!found) throw new Error(`could not detect the scan tool; pass --tool ${toolChoices.slice(1).join("|")}`);
    return found;
  }
  if (tool === "prowler") {
    if (found?.id.startsWith("prowler-")) return found;
    const preferAzure = assessment?.platforms.includes("microsoft") && !assessment.platforms.includes("aws");
    return importerFor(preferAzure ? "prowler-azure" : "prowler-aws")!;
  }
  const chosen = importerFor(tool);
  if (!chosen) throw new Error(`unknown tool '${tool}'`);
  return chosen;
}

/** Why an importer can't be used with this assessment, in the assessor's words. Undefined when it can be. */
export function unusable(catalogue: Catalogue, importer: ScanImporter, assessment: Assessment): string | undefined {
  const platform = catalogue.platforms.get(importer.platform)?.platform;
  const name = platform?.name ?? importer.platform;
  if (!assessment.platforms.includes(importer.platform)) return `${name} isn't in scope for this assessment`;
  if (importer.requiresModule && !Object.values(assessment.modules).some((m) => m.includes(importer.requiresModule!)))
    return `${platform?.modules.find((m) => m.id === importer.requiresModule)?.name ?? importer.requiresModule} isn't turned on for ${name}`;
  if (!catalogue.imports.has(importer.id)) return "crownguard has no mapping for it";
  return undefined;
}

/** Read a scan file for this assessment. Throws with a message for the assessor when nothing can be applied. */
export function readScan(catalogue: Catalogue, importer: ScanImporter, text: string, assessment: Assessment): ScanResult {
  const reason = unusable(catalogue, importer, assessment);
  if (reason) throw new Error(`This is a ${importer.label} scan. ${reason}, so nothing was applied`);
  const result = importer.read(text, catalogue.imports.get(importer.id)!);
  if (!result.suggestions.length) throw new Error("none of the checks in this scan match a question");
  return result;
}

export type { ScanImporter, ScanResult, Suggestion } from "./types";
