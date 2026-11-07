import type { ScanStatus } from "../format/vocab";
import { buildScanResult, type CheckRow } from "./aggregate";
import { parseCsv, readTable, yesNo } from "./csv";
import type { ScanImporter } from "./types";

/** CSV column names Prowler has used, newest first, mapped to what crownguard calls them. */
const columns = {
  check: ["CHECK_ID", "CHECKID"],
  title: ["CHECK_TITLE", "FINDING_TITLE", "TITLE"],
  status: ["STATUS", "FINDING_STATUS"],
  muted: ["MUTED", "IS_MUTED"],
  account: ["ACCOUNT_UID", "ACCOUNT_ID", "SUBSCRIPTION", "PROJECT_ID"],
  accountName: ["ACCOUNT_NAME", "SUBSCRIPTION_NAME", "PROJECT_NAME"],
  resource: ["RESOURCE_UID", "RESOURCE_ARN", "RESOURCE_NAME", "RESOURCE_ID"],
  at: ["TIMESTAMP", "ASSESSMENT_START_TIME", "FINDING_TIMESTAMP"],
  version: ["PROWLER_VERSION", "VERSION"],
};
type Column = keyof typeof columns;

/** One Prowler finding: one check against one resource in one region. */
interface Finding {
  check: string;
  title?: string;
  status: ScanStatus;
  /** Suppressed in Prowler. A muted finding never becomes Yes. */
  muted: boolean;
  account: string;
  accountName?: string;
  resource?: string;
  at: string;
  toolVersion?: string;
}

/**
 * Prowler's statuses are PASS, FAIL and MANUAL (and MUTED in Prowler App). MANUAL needs a person to check, and a
 * muted finding is review, so anything but PASS and FAIL is review.
 */
function toStatus(raw: string): ScanStatus {
  const s = raw.trim().toUpperCase();
  if (s === "PASS") return "pass";
  if (s === "FAIL") return "fail";
  return "review";
}

/**
 * Normalise Prowler's timestamps so a CSV and an OCSF file of the same run compare equal. Prowler's `time_dt` carries
 * no offset but is UTC (it matches the `time` epoch beside it), so an offset-less value is read as UTC.
 */
const iso = (v: string) => {
  const t = v.trim();
  if (/^\d{9,13}$/.test(t)) return new Date(Number(t) * (t.length <= 10 ? 1000 : 1)).toISOString();
  const dated = /(Z|[+-]\d{2}:?\d{2})$/.test(t) ? t : t.replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+)$/, "$1Z");
  const d = new Date(dated);
  return isNaN(d.getTime()) ? t : d.toISOString();
};

function toFinding(row: Record<Exclude<Column, "muted">, string>, muted: boolean): Finding {
  return {
    check: row.check.trim(),
    title: row.title.trim() || undefined,
    status: toStatus(row.status),
    muted,
    account: row.account.trim(),
    accountName: row.accountName.trim() || undefined,
    resource: row.resource.trim() || undefined,
    at: iso(row.at),
    toolVersion: row.version.trim() || undefined,
  };
}

function readCsv(text: string): Finding[] {
  const { found, records } = readTable(parseCsv(text), columns);
  if (!found.has("check") || !found.has("status")) throw new Error("this isn't a Prowler CSV: it needs at least the CHECK_ID and STATUS columns");
  return records.map((r) => toFinding(r, yesNo(r.muted) === true));
}

type OcsfFinding = {
  metadata?: { event_code?: string; product?: { version?: string } };
  status_code?: string;
  status_detail?: string;
  muted?: unknown;
  time_dt?: string;
  finding_info?: { title?: string; created_time_dt?: string; muted?: unknown };
  cloud?: { account?: { uid?: string; name?: string } };
  resources?: { uid?: string; name?: string }[];
  unmapped?: { muted?: unknown };
};

function readOcsf(text: string): Finding[] {
  const parsed = JSON.parse(text) as OcsfFinding | OcsfFinding[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || rows.some((r) => !r?.metadata?.event_code))
    throw new Error("this isn't Prowler JSON-OCSF output: findings need metadata.event_code");

  // Prowler versions have put the muted flag in each of these places, and older ones only said so in the detail text.
  const muted = (r: OcsfFinding) =>
    [r.muted, r.finding_info?.muted, r.unmapped?.muted].some((v) => yesNo(String(v)) === true) || /^muted\b/i.test(r.status_detail ?? "");
  return rows.map((r) =>
    toFinding(
      {
        check: r.metadata?.event_code ?? "",
        title: r.finding_info?.title ?? "",
        status: r.status_code ?? "",
        account: r.cloud?.account?.uid ?? "",
        accountName: r.cloud?.account?.name ?? "",
        resource: r.resources?.[0]?.uid ?? r.resources?.[0]?.name ?? "",
        at: r.time_dt ?? r.finding_info?.created_time_dt ?? "",
        version: r.metadata?.product?.version ?? "",
      },
      muted(r),
    ),
  );
}

/**
 * Prowler reports a check once per resource per region, so a check can have hundreds of findings. They become one row:
 * any failure fails the check, since the control is not in place everywhere, and it passes only when every resource
 * passes. A muted finding counts as review, never as a pass, so suppressing a failure can't turn it into a Yes.
 */
function checkRow(id: string, findings: Finding[]): CheckRow {
  let pass = 0;
  let fail = 0;
  let review = 0;
  for (const f of findings) {
    if (f.muted || f.status === "review") review++;
    else if (f.status === "pass") pass++;
    else fail++;
  }
  const status: ScanStatus = fail > 0 ? "fail" : pass > 0 && review === 0 ? "pass" : "review";
  const of = `${findings.length} resource${findings.length === 1 ? "" : "s"}`;
  const count =
    fail > 0 ? `${fail} of ${of} failing`
    : review > 0 && pass > 0 ? `${pass} of ${of} passing, ${review} needing review`
    : review > 0 ? `${review} of ${of} needing review`
    : `${pass} of ${of} passing`;
  const examples = findings.filter((f) => !f.muted && (status !== "fail" || f.status === "fail")).flatMap((f) => (f.resource ? [f.resource] : []));
  return {
    id,
    status,
    setting: findings[0].title ?? "",
    // The count is what the scan found. The wizard shows `current` and the report shows `count`, so it goes in both.
    current: count,
    expected: status === "review" ? "reviewed by the assessor" : "every resource passes this check",
    count,
    examples,
  };
}

const looksLikeCsv = (text: string) => {
  const header = text.slice(0, 1000);
  // JSON names these fields too (an M365-Secure or OCSF file), but a CSV never opens with a brace or bracket.
  if (/^\s*[{[]/.test(header)) return false;
  return /CHECK_ID/i.test(header) && /STATUS/i.test(header);
};
const looksLikeOcsf = (text: string) => text.includes('"event_code"') && text.includes('"status_code"') && /prowler/i.test(text);

/**
 * Which cloud a Prowler report covers, from the fields Prowler fills in. Empty when the file doesn't say; the
 * importer then takes the file at face value rather than guessing.
 */
function providerOf(text: string): string {
  const ocsf = text.match(/"provider"\s*:\s*"(aws|azure|gcp|kubernetes)"/i);
  if (ocsf) return ocsf[1].toLowerCase();
  const { records } = readTable(parseCsv(text.split(/\r?\n/).slice(0, 2).join("\n")), { provider: ["PROVIDER"] });
  return (records[0]?.provider ?? "").trim().toLowerCase();
}

/** One importer per platform: same file formats, different mapping and questions. Azure questions live on `microsoft`. */
export function prowlerImporter(platform: "aws" | "microsoft"): ScanImporter {
  const azure = platform === "microsoft";
  const provider = azure ? "azure" : "aws";
  const name = azure ? "Prowler (Azure)" : "Prowler (AWS)";
  return {
    id: azure ? "prowler-azure" : "prowler-aws",
    tool: "prowler",
    platform,
    requiresModule: azure ? "azure" : undefined,
    label: name,
    hint: azure ? "prowler-output-<subscription>-<date>.csv or .json" : "prowler-output-<account>-<date>.csv or .json",
    url: "https://github.com/prowler-cloud/prowler",
    accept: ".csv,.json,text/csv,application/json",
    detect: (text) => (looksLikeCsv(text) || looksLikeOcsf(text)) && [provider, ""].includes(providerOf(text)),
    read: (text, mapping) => {
      const findings = looksLikeCsv(text) ? readCsv(text) : readOcsf(text);
      if (!findings.length) throw new Error(`this ${name} file has no findings in it`);

      const byCheck = new Map<string, Finding[]>();
      const byAccount = new Map<string, { id: string; name: string; findings: number }>();
      for (const f of findings) {
        const group = byCheck.get(f.check);
        if (group) group.push(f);
        else byCheck.set(f.check, [f]);
        const id = f.account || "unknown";
        const account = byAccount.get(id) ?? { id, name: f.accountName ?? "", findings: 0 };
        account.findings++;
        byAccount.set(id, account);
      }
      const accounts = [...byAccount.values()].sort((a, b) => a.id.localeCompare(b.id));
      const names = accounts.map((a) => a.name || a.id);

      return buildScanResult(
        mapping,
        [...byCheck].map(([id, found]) => checkRow(id, found)),
        {
          toolVersion: findings.find((f) => f.toolVersion)?.toolVersion,
          tenant: names.join(", "),
          domain: accounts.length === 1 ? accounts[0].id : `${accounts.length} accounts`,
          account: accounts.length === 1 ? accounts[0].id : undefined,
          accounts,
          scannedAt: findings.map((f) => f.at).filter(Boolean).sort()[0] ?? new Date(0).toISOString(),
          warnings: accounts.length > 1 ? [`Findings from ${accounts.length} accounts were combined: ${names.join(", ")}.`] : [],
        },
      );
    },
  };
}
