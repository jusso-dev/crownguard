import type { ImportMapping } from "../content/schema";
import type { ScanStatus } from "../engine/types";
import { suggestAll, type CheckRow } from "./aggregate";
import { clip, type ScanImporter, type ScanResult } from "./types";

/** One SCuBA policy's assessment result, read from `Results.<product>[].Controls[]`. */
export interface ScubaControl {
  /** Policy id, e.g. "GWS.GMAIL.7.3v1". */
  id: string;
  /** What ScubaGoggles decided, as it wrote it. Normalised by `toStatus`. */
  result: string;
  /** "Shall", "Should", "Shall/3rd Party", ... */
  criticality: string;
  /** What the tool said about this tenant, with any HTML stripped out. */
  details: string;
}

/** The parts of a `ScubaResults*.json` file crownguard uses. Everything else is ignored. */
export interface ScubaReport {
  toolVersion?: string;
  /** The Google Workspace domain the report covers. */
  domain: string;
  scannedAt: string;
  controls: ScubaControl[];
}

/**
 * Strip the HTML ScubaGoggles writes into `Details` (line breaks, spans, annotation markup and
 * entities) down to plain text for the evidence field.
 */
export function stripHtml(s: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(code) ? m : String.fromCodePoint(code);
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ScubaGoggles' decision for one policy, to crownguard's status. `Pass` passes; `Fail` fails; a
 * `Warning` is a failed SHOULD, so it fails but can only ever cap a question at Partial; everything
 * else (`N/A`, `Omitted`, `Incorrect Result`, `Error*`, `No events found`) needs the assessor.
 */
export function toStatus(result: string): ScanStatus {
  const r = result.trim().toLowerCase();
  if (r === "pass") return "pass";
  if (r === "fail") return "fail";
  if (r === "warning") return "warning";
  return "review";
}

/** Product names for the evidence text, from the product block of the policy id. */
const products: Record<string, string> = {
  ASSUREDCONTROLS: "Assured Controls",
  CALENDAR: "Calendar",
  CHAT: "Chat",
  CLASSROOM: "Classroom",
  COMMONCONTROLS: "Common Controls",
  DRIVEDOCS: "Drive and Docs",
  GEMINI: "Gemini",
  GMAIL: "Gmail",
  GROUPS: "Groups",
  MEET: "Meet",
  SITES: "Sites",
};

/** Policy ids carry a version suffix (`GWS.GMAIL.7.3v1`); questions match on the id without it. */
const baseId = (id: string) => id.replace(/v[\d.]+$/, "");
const versionOf = (id: string) => id.match(/v[\d.]+$/)?.[0] ?? "";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Read a `ScubaResults*.json` file: which tool wrote it and when, which domain it covers, and every
 * policy result under `Results.<product>[].Controls[]`.
 *
 * Privacy: `Raw` is never read. It holds super admin and break-glass email addresses, organisational
 * unit names and audit log events that have no business being in a crownguard assessment.
 */
export function parseScubagoggles(text: string): ScubaReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("this ScubaGoggles file isn't valid JSON, so it may be cut off or incomplete. Pick the ScubaResults file ScubaGoggles wrote");
  }
  const doc = parsed as { MetaData?: Record<string, unknown>; Results?: Record<string, unknown> };
  const tool = str(doc?.MetaData?.Tool);
  if (tool === "ScubaGear")
    throw new Error(
      "this is a ScubaGear report for Microsoft 365. crownguard reads ScubaGoggles reports for Google Workspace; ScubaGear reports can't be imported",
    );
  if (tool !== "ScubaGoggles")
    throw new Error(
      `this isn't a ScubaGoggles report: it needs the ScubaResults file ScubaGoggles writes${tool ? `, and this one says it came from ${tool}` : ""}`,
    );

  const controls: ScubaControl[] = [];
  for (const groups of Object.values(doc.Results ?? {})) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = (group as { Controls?: unknown })?.Controls;
      if (!Array.isArray(list)) continue;
      for (const c of list) {
        const row = c as Record<string, unknown>;
        const id = str(row["Control ID"]).trim();
        if (!id) continue;
        controls.push({
          id,
          result: str(row.Result),
          criticality: str(row.Criticality).trim(),
          details: stripHtml(str(row.Details)),
        });
      }
    }
  }
  if (!controls.length) throw new Error("this ScubaGoggles report has no policy results in it");

  return {
    toolVersion: str(doc.MetaData?.ToolVersion).trim() || undefined,
    domain: str(doc.MetaData?.DomainName).trim() || "Google Workspace",
    scannedAt: str(doc.MetaData?.TimestampZulu).trim() || new Date(0).toISOString(),
    controls,
  };
}

/** Turn one policy result into the evidence row crownguard stores against a question. */
function toRow(c: ScubaControl): CheckRow {
  const status = toStatus(c.result);
  const product = products[c.id.split(".")[1] ?? ""] ?? "SCuBA";
  return {
    id: c.id,
    status,
    setting: c.criticality ? `${c.id} (${product}, ${c.criticality.toLowerCase()})` : `${c.id} (${product})`,
    current: clip(c.details, 2000),
    expected: status === "review" ? "reviewed by the assessor" : "this control passes",
  };
}

/**
 * Map a parsed report onto questions. Policies match the mapping on the id without its version
 * suffix, so a run of an older ScubaGoggles still lands; a suffix that differs from the one
 * crownguard checked against is flagged.
 */
export function readScuba(report: ScubaReport, mapping: ImportMapping): ScanResult {
  const byCheck = new Map<string, CheckRow[]>();
  const versions = new Map<string, string>();
  const firstSeen = new Map<string, string>();
  const statuses = new Map<string, ScanStatus>();
  for (const c of report.controls) {
    const key = baseId(c.id);
    versions.set(key, versionOf(c.id));
    firstSeen.set(key, c.id);
    statuses.set(key, toStatus(c.result));
    byCheck.set(key, [...(byCheck.get(key) ?? []), toRow(c)]);
  }

  const mapped = new Set(mapping.mappings.flatMap((m) => m.checks.map(baseId)));
  const unmappedIds = [...byCheck.keys()].filter((id) => !mapped.has(id));

  const checked = new Set(mapping.mappings.flatMap((m) => m.checks));
  const changed = [...checked].filter((c) => byCheck.has(baseId(c)) && versions.get(baseId(c)) !== versionOf(c));
  const warnings: string[] = [];
  if (changed.length)
    warnings.push(
      `This report carries different SCuBA policy versions than crownguard's mappings, which were checked against ${mapping.checkedAgainst ?? mapping.name}: ` +
        `${changed.map((c) => `${firstSeen.get(baseId(c))} here against ${c} in crownguard`).join("; ")}. ` +
        `The questions still line up on the policy numbers, but a policy whose meaning changed may not.`,
    );

  const checkRows = mapping.mappings.map((m) => ({ ...m, checks: m.checks.map(baseId) }));
  return {
    tool: mapping.name,
    toolVersion: report.toolVersion,
    tenant: report.domain,
    domain: report.domain,
    scannedAt: report.scannedAt,
    suggestions: suggestAll({ ...mapping, mappings: checkRows }, byCheck, {
      tool: mapping.name,
      toolVersion: report.toolVersion,
      tenant: report.domain,
      scannedAt: report.scannedAt,
    }),
    unmapped: unmappedIds.length,
    unmappedFailing: unmappedIds
      .filter((id) => statuses.get(id) === "fail" || statuses.get(id) === "warning")
      .map((id) => firstSeen.get(id) ?? id)
      .sort(),
    warnings: warnings.length ? warnings : undefined,
  };
}

const looksLike = (text: string) => text.includes('"Results"') && /"Tool"\s*:\s*"ScubaGoggles"/.test(text);

/** CISA's ScubaGoggles: `ScubaResults*.json` from a Google Workspace assessment. */
export const scubagogglesImporter: ScanImporter = {
  id: "scubagoggles",
  platform: "google",
  label: "ScubaGoggles",
  hint: "ScubaResults*.json",
  url: "https://github.com/cisagov/ScubaGoggles",
  accept: ".json,application/json",
  detect: looksLike,
  read: (text, mapping) => readScuba(parseScubagoggles(text), mapping),
};
