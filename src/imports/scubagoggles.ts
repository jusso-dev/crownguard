import type { ScanStatus } from "../format/vocab";
import { buildScanResult, type CheckRow } from "./aggregate";
import type { ScanImporter } from "./types";

/** One SCuBA policy's assessment result, read from `Results.<product>[].Controls[]`. */
interface ScubaControl {
  /** Policy id, e.g. "GWS.GMAIL.7.3v1". */
  id: string;
  /** What ScubaGoggles decided, as it wrote it. */
  result: string;
  /** "Shall", "Should", "Shall/3rd Party", ... */
  criticality: string;
  /** What the tool said about this tenant, as HTML. */
  details: string;
}

/**
 * Remove tags in one pass. A tag runs to its `>`, so `<scr<script>ipt>` goes whole, and one never closed runs to the
 * end of the text rather than surviving. Each `>` search starts past the last, so this is linear on any input, which
 * a regex can't promise for a run of unclosed `<a`.
 */
function stripTags(s: string): string {
  let out = "";
  let i = 0;
  for (let lt = s.indexOf("<"); lt >= 0; lt = s.indexOf("<", i)) {
    out += s.slice(i, lt);
    const next = s[lt + 1] === "/" ? s[lt + 2] : s[lt + 1];
    if (!next || !/[a-z]/i.test(next)) {
      out += "<";
      i = lt + 1;
      continue;
    }
    const gt = s.indexOf(">", lt);
    if (gt < 0) return out;
    i = gt + 1;
  }
  return out + s.slice(i);
}

/**
 * Strip the HTML ScubaGoggles writes into `Details` (line breaks, spans, annotation markup and
 * entities) down to plain text for the evidence field.
 */
function stripHtml(s: string): string {
  const entities = new Map(Object.entries({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }));
  return stripTags(s.replace(/<br\s*\/?>/gi, " "))
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        // Past U+10FFFF fromCodePoint throws, and a lone surrogate isn't text: either stays as written.
        return isNaN(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? m : String.fromCodePoint(code);
      }
      return entities.get(e.toLowerCase()) ?? m;
    })
    // Decoding entities can put an angle bracket back (`&lt;script&gt;`). Once that's happened the text is done being
    // unescaped, so any bracket that could open a tag comes out. `3 < 4` and similar are untouched: they don't start
    // with a letter, a slash or an exclamation.
    .replace(/<(?=[a-z!/?])/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ScubaGoggles' decision for one policy, to crownguard's status. `Pass` passes; `Fail` fails; a
 * `Warning` is a failed SHOULD, so it fails but can only ever cap a question at Partial; everything
 * else (`N/A`, `Omitted`, `Incorrect Result`, `Error*`, `No events found`) needs the assessor.
 */
function toStatus(result: string): ScanStatus {
  const r = result.trim().toLowerCase();
  if (r === "pass") return "pass";
  if (r === "fail") return "fail";
  if (r === "warning") return "warning";
  return "review";
}

/** Product names for the evidence text, from the product block of the policy id. */
const products = new Map(Object.entries({
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
}));

/** Policy ids carry a version suffix (`GWS.GMAIL.7.3v1`); questions match on the id without it. */
const baseId = (id: string) => id.replace(/v[\d.]+$/, "");

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Read a `ScubaResults*.json` file and map every policy result under `Results.<product>[].Controls[]` onto questions.
 * Policies match the mapping on the id without its version suffix, so a run of an older ScubaGoggles still lands; a
 * suffix that differs from the one crownguard checked against is flagged.
 *
 * Privacy: `Raw` is never read. It holds super admin and break-glass email addresses, organisational
 * unit names and audit log events that have no business being in a crownguard assessment.
 */
const read: ScanImporter["read"] = (text, mapping) => {
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
        if (id) controls.push({ id, result: str(row.Result), criticality: str(row.Criticality).trim(), details: str(row.Details) });
      }
    }
  }
  if (!controls.length) throw new Error("this ScubaGoggles report has no policy results in it");

  const domain = str(doc.MetaData?.DomainName).trim() || "Google Workspace";
  return buildScanResult(mapping, controls.map(toRow), {
    toolVersion: str(doc.MetaData?.ToolVersion).trim() || undefined,
    tenant: domain,
    domain,
    scannedAt: str(doc.MetaData?.TimestampZulu).trim() || new Date(0).toISOString(),
  }, baseId);
};

function toRow(c: ScubaControl): CheckRow {
  const status = toStatus(c.result);
  const product = products.get(c.id.split(".")[1] ?? "") ?? "SCuBA";
  return {
    id: c.id,
    status,
    setting: c.criticality ? `${c.id} (${product}, ${c.criticality.toLowerCase()})` : `${c.id} (${product})`,
    // Details can name accounts too ("The following super admins are configured: ..."), not only Raw; the result
    // builder redacts them.
    current: stripHtml(c.details),
    expected: status === "review" ? "reviewed by the assessor" : "this control passes",
  };
}

const looksLike = (text: string) => text.includes('"Results"') && /"Tool"\s*:\s*"ScubaGoggles"/.test(text);

/** CISA's ScubaGoggles: `ScubaResults*.json` from a Google Workspace assessment. */
export const scubagogglesImporter: ScanImporter = {
  id: "scubagoggles",
  tool: "scubagoggles",
  platform: "google",
  label: "ScubaGoggles",
  hint: "ScubaResults*.json",
  url: "https://github.com/cisagov/ScubaGoggles",
  accept: ".json,application/json",
  detect: looksLike,
  read,
};
