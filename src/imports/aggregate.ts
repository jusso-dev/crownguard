import type { ImportMapping } from "../content/schema";
import type { Answer, ScanStatus } from "../format/vocab";
import type { ScanResult, Suggestion } from "./types";

/** Statuses that actually say whether the control is in place. Review, info, unknown and not-licensed don't. */
const decisive = new Set<ScanStatus>(["pass", "fail", "warning"]);

/** The scan found the control not in place. A warning is a failed SHOULD (ScubaGoggles) or a weaker failure. */
const failing = (s: ScanStatus) => s === "fail" || s === "warning";

/**
 * All mapped checks pass → Yes; all fail → No; anything mixed, or any warning → Partial. A pass beside a check that
 * needs review (or wasn't licensed, or was muted) is Partial: the scan hasn't shown the whole control is in place.
 */
function aggregate(statuses: ScanStatus[]): Answer | undefined {
  const d = statuses.filter((s) => decisive.has(s));
  if (!d.length) return undefined;
  if (d.every((s) => s === "pass")) return d.length === statuses.length ? "yes" : "partial";
  if (d.every((s) => s === "fail")) return "no";
  return "partial";
}

/** Apply a mapping's safeguards on top of the plain aggregate. */
function suggestFor(m: ImportMapping["mappings"][number], statuses: ScanStatus[]): Answer | undefined {
  // An inconclusive fail goes to the assessor like any other review, so it can't sit silently beside a pass.
  const usable = m.failIsInconclusive ? statuses.map((s): ScanStatus => (s === "fail" ? "review" : s)) : statuses;
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
  /** For checks reported once per resource, how many resources passed or failed, e.g. "3 of 41 resources failing". */
  count?: string;
  /** Example resources behind that count. */
  examples?: string[];
}

/** What a scanner's file says about the scan as a whole. */
interface ScanFacts {
  toolVersion?: string;
  /** Tenant or account label, shown before the import is applied and recorded on the evidence. */
  tenant: string;
  domain: string;
  /** The one account every finding came from, when the scanner reports accounts. */
  account?: string;
  accounts?: ScanResult["accounts"];
  scannedAt: string;
  licence?: string;
  /** Scanner-specific warnings. Version mismatches against the mapping are added here. */
  warnings?: string[];
}

/** Truncate for a fixed-width evidence field, keeping the start of the value. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Replace email addresses and UPNs with "[account]". Scanners name super admins, break-glass accounts and users in
 * their free text ("The following super admins are configured: alice@example.com"), and evidence is saved, exported
 * and printed. The local part may carry `#EXT#` (a guest UPN), so the guest's own address goes too. The lookbehind
 * starts a match only at the beginning of a run, which keeps this linear on long text with no `@` in it. The local part
 * takes anything up to a space or a delimiter (so `alice!ops@` or `josé@` goes whole), and the domain must end in a label
 * starting with a letter, so a version pin such as `lodash@4.17.21` is left alone.
 */
const ADDRESS =
  /(?<![^\s@<>()[\]{}\\,;:"'`|/=?&])[^\s@<>()[\]{}\\,;:"'`|/=?&]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}[\p{L}\p{N}-]*/gu;
const redactEmails = (s: string) => s.replace(ADDRESS, "[account]");

/** Redact, then cut to the saved file's field limit: an address cut in half no longer looks like one. */
const scrub = (s: string, n: number) => clip(redactEmails(s), n);

const major = (v: string) => v.trim().replace(/^v/i, "").split(".")[0];

function versionWarnings(mapping: ImportMapping, groups: Map<string, CheckRow[]>, toolVersion: string | undefined, key: (id: string) => string): string[] {
  const warnings: string[] = [];
  const against = mapping.checkedAgainst;
  if (toolVersion && against && major(toolVersion) !== major(against))
    warnings.push(
      `This scan came from ${mapping.name} ${toolVersion}. The check ids in crownguard's mappings were checked against ${against}, so a renamed or new check may not line up.`,
    );
  const changed = [...new Set(mapping.mappings.flatMap((m) => m.checks))].flatMap((c) =>
    [...new Set((groups.get(key(c)) ?? []).map((r) => r.id).filter((id) => id !== c))].map((id) => `${id} here against ${c} in crownguard`),
  );
  if (changed.length)
    warnings.push(
      `This scan carries different ${mapping.name} policy versions than crownguard's mappings, which were checked against ${against ?? mapping.name}: ` +
        `${changed.join("; ")}. The questions still line up on the policy numbers, but a policy whose meaning changed may not.`,
    );
  return warnings;
}

/**
 * Turn a scanner's check rows into the result the import panel shows and `applyScan` saves. Every importer ends here,
 * so the answer rules, the redaction and the field limits are applied once, the same way for every scanner.
 *
 * A question is suggested only when at least one of its mapped checks is in the scan, with the mapping's `cap` and
 * `failIsInconclusive` safeguards applied. `key` is how a row's id meets the mapping's: a scanner whose ids carry a
 * version suffix matches on the id without it, so an older run still lands, and a different suffix is warned about.
 */
export function buildScanResult(mapping: ImportMapping, rows: CheckRow[], facts: ScanFacts, key: (id: string) => string = (id) => id): ScanResult {
  const groups = new Map<string, CheckRow[]>();
  for (const r of rows) {
    const k = key(r.id);
    const group = groups.get(k);
    if (group) group.push(r);
    else groups.set(k, [r]);
  }
  const mapped = new Set(mapping.mappings.flatMap((m) => m.checks.map(key)));
  const unmapped = [...groups.keys()].filter((k) => !mapped.has(k));
  const tenant = scrub(facts.tenant, 300);
  const account = facts.account && scrub(facts.account, 300);
  const toolVersion = facts.toolVersion && clip(facts.toolVersion, 40);
  const scannedAt = clip(facts.scannedAt, 60);

  const suggestions = mapping.mappings
    .map((m): Suggestion | null => {
      const found = m.checks.flatMap((c) => groups.get(key(c)) ?? []);
      if (!found.length) return null;
      return {
        question: m.question,
        evidence: {
          source: mapping.name,
          tool: mapping.name,
          toolVersion,
          account,
          tenant,
          scannedAt,
          suggested: suggestFor(m, found.map((f) => f.status)),
          checks: found.slice(0, 50).map((f) => ({
            id: f.id,
            status: f.status,
            setting: scrub(f.setting, 500),
            current: scrub(f.current, 2000),
            expected: scrub(f.expected, 2000),
            count: f.count,
            // Resource ids are kept as examples; one that is a user's UPN is an account, and goes.
            examples: f.examples?.slice(0, 10).map((e) => scrub(e, 300)),
          })),
        },
      };
    })
    .filter((s): s is Suggestion => s !== null);

  const warnings = [...versionWarnings(mapping, groups, facts.toolVersion, key), ...(facts.warnings ?? [])];
  return {
    tool: mapping.name,
    toolVersion,
    tenant,
    domain: facts.domain,
    accounts: facts.accounts,
    scannedAt,
    suggestions,
    unmapped: unmapped.length,
    unmappedFailing: [...new Set(unmapped.flatMap((k) => groups.get(k)!.filter((r) => failing(r.status)).map((r) => r.id)))].sort(),
    licence: facts.licence,
    warnings: warnings.length ? warnings : undefined,
  };
}
