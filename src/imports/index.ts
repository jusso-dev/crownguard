import { m365SecureImporter } from "./m365Secure";
import { prowlerImporter } from "./prowler";
import { scubagogglesImporter } from "./scubagoggles";
import type { ScanImporter } from "./types";

/**
 * Every scanner crownguard can read. The mapping from its check ids to crownguard questions lives in
 * `content/imports/<id>.yaml`, so a new scanner is a new importer here plus a mapping file, not a new panel.
 */
export const importers: ScanImporter[] = [m365SecureImporter, prowlerImporter("aws"), prowlerImporter("microsoft"), scubagogglesImporter];

export const importerFor = (id: string): ScanImporter | undefined => importers.find((i) => i.id === id);

/** The importer that recognises this file, whichever platform it belongs to. */
export function detectImporter(text: string): ScanImporter | undefined {
  return importers.find((i) => i.detect(text));
}

export type { ScanImporter, ScanResult, Suggestion } from "./types";
