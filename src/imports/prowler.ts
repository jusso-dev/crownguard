import type { ImportMapping } from "../content/schema";
import type { ScanStatus } from "../engine/types";
import { collapse, countText, suggestAll, type CheckRow } from "./aggregate";
import { type Finding, type ScanImporter, type ScanResult } from "./types";

/** CSV column names Prowler has used, newest first, mapped to what crownguard calls them. */
const columns: Record<string, string[]> = {
  check: ["CHECK_ID", "CHECKID"],
  title: ["CHECK_TITLE", "FINDING_TITLE", "TITLE"],
  status: ["STATUS", "FINDING_STATUS"],
  muted: ["MUTED", "IS_MUTED"],
  account: ["ACCOUNT_UID", "ACCOUNT_ID", "SUBSCRIPTION", "PROJECT_ID"],
  accountName: ["ACCOUNT_NAME", "SUBSCRIPTION_NAME", "PROJECT_NAME"],
  region: ["REGION", "LOCATION"],
  resource: ["RESOURCE_UID", "RESOURCE_ARN", "RESOURCE_NAME", "RESOURCE_ID"],
  detail: ["STATUS_EXTENDED", "STATUS_DETAIL", "DETAIL"],
  at: ["TIMESTAMP", "ASSESSMENT_START_TIME", "FINDING_TIMESTAMP"],
  version: ["PROWLER_VERSION", "VERSION"],
};

/** Which delimiter a CSV uses: count candidates in the header row and take the one it uses most. */
export function detectDelimiter(headerLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, headerLine.split(d).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

/** RFC 4180 fields and rows: quoted fields, doubled quotes, either line ending. */
export function parseCsv(text: string): string[][] {
  const delim = detectDelimiter(text.slice(0, text.indexOf("\n") < 0 ? undefined : text.indexOf("\n")));
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const truthy = (v: string | undefined) => /^(true|yes|1|y|toggled)$/i.test((v ?? "").trim());

/** Prowler reports PASS, FAIL and MANUAL. Anything else, including a suppressed finding, is review. */
function toStatus(raw: string): ScanStatus {
  const s = raw.trim().toUpperCase();
  if (s === "PASS" || s === "PASSIVE") return "pass";
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

function toFinding(row: Record<string, string>): Finding {
  return {
    check: row.check.trim(),
    title: row.title?.trim() || undefined,
    status: toStatus(row.status),
    muted: truthy(row.muted),
    account: row.account.trim(),
    accountName: row.accountName?.trim() || undefined,
    region: row.region?.trim() || undefined,
    resource: row.resource?.trim() || undefined,
    detail: row.detail?.trim() || undefined,
    at: iso(row.at),
    toolVersion: row.version?.trim() || undefined,
  };
}

export function readProwlerCsv(text: string): Finding[] {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const index = new Map(header.map((h, i) => [h.trim().toUpperCase(), i]));
  const pick = (names: string[]) => {
    for (const n of names) {
      const i = index.get(n);
      if (i !== undefined) return i;
    }
    return -1;
  };
  const wanted = Object.fromEntries(Object.entries(columns).map(([k, names]) => [k, pick(names)])) as Record<string, number>;
  if (wanted.check < 0 || wanted.status < 0)
    throw new Error("this isn't a Prowler CSV: it needs at least the CHECK_ID and STATUS columns");

  return rows.slice(1).map((cells) => {
    const value = (i: number) => (i >= 0 ? (cells[i] ?? "") : "");
    return toFinding({
      check: value(wanted.check),
      title: value(wanted.title),
      status: value(wanted.status),
      muted: value(wanted.muted),
      account: value(wanted.account),
      accountName: value(wanted.accountName),
      region: value(wanted.region),
      resource: value(wanted.resource),
      detail: value(wanted.detail),
      at: value(wanted.at),
      version: value(wanted.version),
    });
  });
}

type OcsfFinding = {
  metadata?: { event_code?: string; product?: { version?: string } };
  status_code?: string;
  status_detail?: string;
  muted?: unknown;
  time_dt?: string;
  finding_info?: { title?: string; created_time_dt?: string; muted?: unknown };
  cloud?: { account?: { uid?: string; name?: string }; region?: string };
  resources?: { uid?: string; name?: string; region?: string }[];
  unmapped?: { muted?: unknown };
};

export function readProwlerOcsf(text: string): Finding[] {
  const parsed = JSON.parse(text) as OcsfFinding | OcsfFinding[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  if (!rows.length || rows.some((r) => !r?.metadata?.event_code))
    throw new Error("this isn't Prowler JSON-OCSF output: findings need metadata.event_code");

  return rows.map((r) => {
    const detail = r.status_detail ?? "";
    return toFinding({
      check: r.metadata?.event_code ?? "",
      title: r.finding_info?.title ?? "",
      status: r.status_code ?? "",
      muted: String(truthy(String(r.muted)) || truthy(String(r.finding_info?.muted)) || truthy(String(r.unmapped?.muted)) || /^muted\b/i.test(detail)),
      account: r.cloud?.account?.uid ?? "",
      accountName: r.cloud?.account?.name ?? "",
      region: r.cloud?.region ?? r.resources?.[0]?.region ?? "",
      resource: r.resources?.[0]?.uid ?? r.resources?.[0]?.name ?? "",
      detail,
      at: r.time_dt ?? r.finding_info?.created_time_dt ?? "",
      version: r.metadata?.product?.version ?? "",
    });
  });
}

/** Prowler writes one finding per resource per region, so a check can produce hundreds of rows. */
function byCheck(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) groups.set(f.check, [...(groups.get(f.check) ?? []), f]);
  return groups;
}

const major = (v: string | undefined) => v?.trim().split(".")[0];

export function readProwler(findings: Finding[], mapping: ImportMapping): ScanResult {
  const groups = byCheck(findings);
  const seen = new Map<string, { id: string; name: string; findings: number }>();
  for (const f of findings) {
    const id = f.account || "unknown";
    const row = seen.get(id) ?? { id, name: f.accountName ?? "", findings: 0 };
    row.findings++;
    seen.set(id, row);
  }
  const accounts = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
  const mapped = new Set(mapping.mappings.flatMap((m) => m.checks));
  const unmappedIds = [...groups.keys()].filter((id) => !mapped.has(id));
  const toolVersion = findings.find((f) => f.toolVersion)?.toolVersion;
  const at = findings.map((f) => f.at).filter(Boolean).sort()[0] ?? new Date(0).toISOString();

  const rows = new Map<string, CheckRow[]>();
  for (const [id, found] of groups) {
    const c = collapse(found);
    const examples = found.filter((f) => c.status === "fail" ? f.status === "fail" && !f.muted : !f.muted).map((f) => f.resource).filter(Boolean) as string[];
    rows.set(id, [
      {
        id,
        status: c.status,
        setting: found[0].title ?? "",
        current: countText(c),
        expected: c.status === "review" ? "reviewed by the assessor" : "every resource passes this check",
        count: countText(c),
        examples,
      },
    ]);
  }

  const account = accounts?.length === 1 ? accounts[0].id : undefined;
  const warnings: string[] = [];
  if (toolVersion && mapping.checkedAgainst && major(toolVersion) !== major(mapping.checkedAgainst))
    warnings.push(
      `This scan came from Prowler ${toolVersion}. The check ids in crownguard's mappings were checked against ${mapping.checkedAgainst}, so a renamed or new check may not line up.`,
    );
  if ((accounts?.length ?? 0) > 1)
    warnings.push(`Findings from ${accounts!.length} accounts were combined: ${accounts!.map((a) => a.name || a.id).join(", ")}.`);

  return {
    tool: mapping.name,
    toolVersion,
    tenant: accounts?.length ? accounts.map((a) => a.name || a.id).join(", ") : "Prowler scan",
    domain: accounts?.length === 1 ? accounts[0].id : `${accounts?.length ?? 0} accounts`,
    accounts,
    scannedAt: at,
    suggestions: suggestAll(
      mapping,
      rows,
      { tool: mapping.name, toolVersion, account, tenant: accounts?.map((a) => a.name || a.id).join(", ") ?? "Prowler scan", scannedAt: at },
    ),
    unmapped: unmappedIds.length,
    unmappedFailing: unmappedIds.filter((id) => collapse(groups.get(id)!).status === "fail").sort(),
    warnings: warnings.length ? warnings : undefined,
  };
}

const looksLikeCsv = (text: string) => {
  const header = text.slice(0, 1000);
  return /CHECK_ID/i.test(header) && /STATUS/i.test(header);
};
const looksLikeOcsf = (text: string) => text.includes('"event_code"') && text.includes('"status_code"') && /prowler/i.test(text);

/**
 * Which cloud a Prowler report covers, from the fields Prowler fills in. Empty when the file doesn't say; the
 * importer then takes the file at face value rather than guessing.
 */
export function prowlerProvider(text: string): string {
  const ocsf = text.match(/"provider"\s*:\s*"(aws|azure|gcp|kubernetes)"/i);
  if (ocsf) return ocsf[1].toLowerCase();
  const rows = parseCsv(text.split(/\r?\n/).slice(0, 2).join("\n"));
  const header = rows[0] ?? [];
  const i = header.findIndex((h) => h.trim().toUpperCase() === "PROVIDER");
  return i >= 0 ? (rows[1]?.[i] ?? "").trim().toLowerCase() : "";
}

/** One importer per platform: same file formats, different mapping and questions. Azure questions live on `microsoft`. */
export function prowlerImporter(platform: "aws" | "microsoft"): ScanImporter {
  const azure = platform === "microsoft";
  const provider = azure ? "azure" : "aws";
  const name = azure ? "Prowler (Azure)" : "Prowler (AWS)";
  return {
    id: azure ? "prowler-azure" : "prowler-aws",
    platform,
    requiresModule: azure ? "azure" : undefined,
    label: name,
    hint: azure ? "prowler-output-<subscription>-<date>.csv or .json" : "prowler-output-<account>-<date>.csv or .json",
    url: "https://github.com/prowler-cloud/prowler",
    accept: ".csv,.json,text/csv,application/json",
    detect: (text) => (looksLikeCsv(text) || looksLikeOcsf(text)) && [provider, ""].includes(prowlerProvider(text)),
    read: (text, mapping) => {
      const findings = looksLikeCsv(text) ? readProwlerCsv(text) : readProwlerOcsf(text);
      if (!findings.length) throw new Error(`this ${name} file has no findings in it`);
      return readProwler(findings, mapping);
    },
  };
}
