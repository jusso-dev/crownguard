import type { Assessment } from "../format/schema";
import type { ScanResult } from "./types";

/**
 * Merge scan suggestions into an assessment: the wizard's import and `cg import` share this. An answer is kept unless
 * the scan is decisive and the user chose to replace answers. A kept answer keeps the evidence it was given too, so a
 * later scan's checks never sit under an answer they didn't produce.
 */
export function applyScan(
  assessment: Assessment,
  scan: ScanResult,
  opts: { platform: string; overwrite: boolean; licence: boolean },
): { assessment: Assessment; applied: number } {
  const answers = { ...assessment.answers };
  const evidence = { ...assessment.evidence };
  let applied = 0;
  for (const { question, evidence: ev } of scan.suggestions) {
    if (answers[question] && !(ev.suggested && opts.overwrite)) continue;
    evidence[question] = ev;
    if (ev.suggested) {
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
