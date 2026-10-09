import type { Catalogue } from "../content/schema";
import { aiAccess, aiAutonomy, aiCriteria, aiData, aiDomains, aiLifecycles, aiRiskRatings, aiStandardUse, aiTechnologies, aiUsagePatterns } from "./aiOptions";
import { aiFieldLabels, aiRegisterSummary, type AiField } from "./aiRegister";
import { assessAll } from "./risk";
import type { Assessment } from "./types";

export interface RegisterTable {
  headers: string[];
  rows: string[][];
  /** The first `standardColumns` columns are the Standard for accountability's minimum fields; the rest are crownguard's. */
  standardColumns: number;
}

const list = (values: string[]) => values.join("; ");
const pct = (n: number | null) => (n === null ? "" : `${Math.round(n * 100)}%`);
const criterionLabel = (c: keyof typeof aiCriteria) => (c === "none" ? "None (not in scope)" : aiCriteria[c].split(":")[0]);

const standardFields: AiField[] = [
  "name",
  "reference",
  "description",
  "technology",
  "lifecycle",
  "technicalStandard",
  "domains",
  "usagePatterns",
  "ownerName",
  "ownerEmail",
  "criteria",
  "inherentRisk",
  "residualRisk",
  "impactAssessmentDate",
  "lastReview",
  "nextReview",
];

const extraHeaders = [
  "Example data",
  "Type of AI use",
  "Underpinning product",
  "Oversight model",
  "Access level",
  "Data handled",
  "Linked crown jewels",
  "Readiness (severity-weighted)",
  "Readiness questions answered",
  "Open readiness gaps",
  "Register fields missing",
];

/** The register as rows an agency can paste into its own: the Standard's fields first, in its order, then crownguard's. */
export function registerTable(catalogue: Catalogue, assessment: Assessment, asAt = new Date()): RegisterTable {
  const summary = aiRegisterSummary(catalogue, assessment, assessAll(catalogue, assessment), asAt);
  const rows = summary.entries.map((r) => {
    const e = r.entry;
    const standard: Record<AiField, string> = {
      name: e.name,
      reference: e.reference,
      description: e.description,
      technology: list(e.technology.map((t) => aiTechnologies[t])),
      lifecycle: e.lifecycle ? aiLifecycles[e.lifecycle] : "",
      technicalStandard: e.technicalStandard ? aiStandardUse[e.technicalStandard] : "",
      domains: list(e.domains.map((d) => aiDomains[d])),
      usagePatterns: list(e.usagePatterns.map((u) => aiUsagePatterns[u])),
      ownerName: e.ownerName,
      ownerEmail: e.ownerEmail,
      criteria: list(e.criteria.map(criterionLabel)),
      inherentRisk: e.inherentRisk ? aiRiskRatings[e.inherentRisk] : "",
      residualRisk: e.residualRisk ? aiRiskRatings[e.residualRisk] : "",
      impactAssessmentDate: e.impactAssessmentDate ?? "",
      lastReview: e.inherentRisk === "high" ? (e.lastReview ?? "") : "",
      nextReview: e.inherentRisk === "high" ? (e.nextReview ?? "") : "",
    };
    return [
      ...standardFields.map((f) => standard[f]),
      e.example ? "Yes: example data, not a real use case" : "No",
      r.kind?.name ?? e.kind,
      e.product,
      e.autonomy ? aiAutonomy[e.autonomy].label : "",
      e.access ? aiAccess[e.access].label : "",
      list(e.data.map((d) => aiData[d])),
      list(r.jewels.map((j) => j.jewel.name)),
      pct(r.score),
      `${r.answered} of ${r.questions.length}`,
      list(r.gaps.map((g) => `${g.question.id} (${g.question.severity})`)),
      list(r.missing.map((f) => aiFieldLabels[f])),
    ];
  });
  return { headers: [...standardFields.map((f) => aiFieldLabels[f]), ...extraHeaders], rows, standardColumns: standardFields.length };
}

const dayText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The "About" sheet: what the columns are, any example data, the dates and caveats, and the sources. */
export function aboutRows(catalogue: Catalogue, assessment: Assessment, asAt = new Date()): string[][] {
  const module = catalogue.aiRegister;
  if (!module) return [];
  const { model } = module;
  const entries = assessment.aiRegister?.entries ?? [];
  const examples = entries.filter((e) => e.example).length;
  const sources = [...new Set([...model.sources, ...model.dates.map((d) => d.source), ...model.caveats.flatMap((c) => c.sources)])]
    .map((id) => catalogue.sources.get(id))
    .filter((s) => !!s);
  return [
    ["AI use-case register", assessment.org.name],
    ["Exported", `${asAt.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} from crownguard, in the browser`],
    [
      "Columns",
      "The first 16 columns of the Register sheet are the minimum fields in the DTA's Standard for accountability, in its order and close to its wording. The owner's name and email address are one field in the Standard and two columns here. The remaining columns are crownguard's additions: keep, rename or drop them to suit your own register.",
    ],
    [
      "Example data",
      examples
        ? `This export includes ${examples} example ${examples === 1 ? "entry" : "entries"}, marked Yes in the Example data column. They aren't real use cases: delete them before you use or share the register.`
        : "None. Every entry was recorded by the organisation.",
    ],
    ["Applies to", model.appliesTo],
    ...model.dates.map((d) => ["Key date", `${d.date ? `${dayText(d.date)}: ` : ""}${d.text}`]),
    ...model.caveats.map((c) => ["Note", c.text]),
    ["Readiness", "Readiness is crownguard's severity-weighted score of the readiness questions asked for each use case (Yes 1, Partial 0.5, No and Unknown 0, N/A left out). It isn't a DTA rating."],
    ...sources.map((s) => ["Source", `${s.publisher}. ${s.title}. ${s.url} (retrieved ${s.retrieved})`]),
  ];
}

/**
 * RFC 4180 CSV with a UTF-8 byte order mark and CRLF line ends, so Excel opens it with the right encoding. Cells that
 * a spreadsheet would read as a formula get a leading apostrophe (CSV injection).
 */
export function toCsv({ headers, rows }: Pick<RegisterTable, "headers" | "rows">): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `\uFEFF${[headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
