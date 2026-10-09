import type { ImportMapping } from "../content/schema";
import type { Answer, ScanStatus } from "../engine/types";
import { clip, type Finding, type Suggestion } from "./types";

/** Statuses that actually say whether the control is in place. Review, info, unknown and not-licensed don't. */
export const decisive = new Set<ScanStatus>(["pass", "fail", "warning"]);

/** All mapped checks pass → Yes; all fail → No; anything mixed, or any warning → Partial. */
export function aggregate(statuses: ScanStatus[]): Answer | undefined {
  const d = statuses.filter((s) => decisive.has(s));
  if (!d.length) return undefined;
  if (d.every((s) => s === "pass")) return "yes";
  if (d.every((s) => s === "fail")) return "no";
  return "partial";
}

/** Apply a mapping's safeguards on top of the plain aggregate. */
export function suggestFor(m: ImportMapping["mappings"][number], statuses: ScanStatus[]): Answer | undefined {
  const usable = m.failIsInconclusive ? statuses.filter((s) => s !== "fail") : statuses;
  const answer = aggregate(usable);
  return m.cap === "partial" && answer === "yes" ? "partial" : answer;
}

/** One check's worth of evidence, as it will be shown against the question and in the report. */
export interface CheckRow {
  id: string;
  status: ScanStatus;
  /** The setting or control the check looked at. */
  setting: string;
  /** What the scan found. */
  current: string;
  /** What "in place" looks like. */
  expected: string;
  /** For checks reported once per resource: how many passed and failed, e.g. "3 of 41 resources fail". */
  count?: string;
  /** Up to ten example resources behind that count. */
  examples?: string[];
}

export interface ScanMeta {
  tool: string;
  toolVersion?: string;
  /** Account or tenant the findings came from, when the scanner reports one. */
  account?: string;
  tenant: string;
  scannedAt: string;
}

/**
 * Turn per-check evidence into per-question suggestions. A question is suggested only when at least one of its mapped
 * checks is in the scan, and the mapping's `cap` and `failIsInconclusive` safeguards are applied on the way.
 */
export function suggestAll(mapping: ImportMapping, byCheck: Map<string, CheckRow[]>, meta: ScanMeta): Suggestion[] {
  return mapping.mappings
    .map((m): Suggestion | null => {
      const found = m.checks.flatMap((c) => byCheck.get(c) ?? []);
      if (!found.length) return null;
      return {
        question: m.question,
        evidence: {
          source: mapping.name,
          tool: meta.tool,
          toolVersion: meta.toolVersion,
          account: meta.account,
          tenant: meta.tenant,
          scannedAt: meta.scannedAt,
          suggested: suggestFor(m, found.map((f) => f.status)),
          checks: found.slice(0, 50).map((f) => ({
            id: f.id,
            status: f.status,
            setting: clip(f.setting, 500),
            current: clip(f.current, 2000),
            expected: clip(f.expected, 2000),
            count: f.count,
            examples: f.examples?.slice(0, 10).map((e) => clip(e, 300)),
          })),
        },
      };
    })
    .filter((s): s is Suggestion => s !== null);
}

export interface Collapse {
  /** One status for the check: any failure, otherwise a pass only when every resource passed. */
  status: ScanStatus;
  pass: number;
  fail: number;
  review: number;
  resources: number;
}

/**
 * Collapse one check's per-resource findings into a single status.
 *
 * A check with 40 passing and 1 failing resource is a failure: the control is not in place everywhere. Muted findings
 * count as review, never as a pass, so suppressing a failure can't turn it into a Yes. MANUAL findings are review.
 */
export function collapse(findings: Finding[]): Collapse {
  let pass = 0;
  let fail = 0;
  let review = 0;
  for (const f of findings) {
    if (f.muted || f.status === "review") review++;
    else if (f.status === "pass") pass++;
    else if (f.status === "fail" || f.status === "warning") fail++;
    else review++;
  }
  return {
    status: fail > 0 ? "fail" : pass > 0 && review === 0 ? "pass" : "review",
    pass,
    fail,
    review,
    resources: findings.length,
  };
}

/** "3 of 41 resources failing", or "41 of 41 resources passing". The counts matter more than any one row. */
export function countText(c: Collapse): string {
  const of = `${c.resources} resource${c.resources === 1 ? "" : "s"}`;
  if (c.fail > 0) return `${c.fail} of ${of} failing`;
  if (c.review > 0 && c.pass > 0) return `${c.pass} of ${of} passing, ${c.review} needing review`;
  if (c.review > 0) return `${c.review} of ${of} needing review`;
  return `${c.pass} of ${of} passing`;
}
