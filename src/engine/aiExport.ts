import { aiRegisterSources } from "../content/aiRegisterSources";
import type { Catalogue } from "../content/schema";
import { aiAccess, aiAutonomy, aiBases, aiCriteria, aiData, aiDomains, aiLifecycles, aiRiskRatings, aiStandardUse, aiTechnologies, aiUsagePatterns, type AiBasis } from "../content/aiOptions";
import { aiFieldLabels, aiRegisterSummary, shareWithDta, isAgentic, type AiField } from "./aiRegister";
import { pct } from "./percent";
import { assessAll } from "./risk";
import type { Assessment } from "../format/schema";

interface RegisterTable {
  headers: string[];
  rows: string[][];
  /** The first `standardColumns` columns are the Standard for accountability's minimum fields; the rest are crownguard's. */
  standardColumns: number;
}

const list = (values: string[]) => values.join("; ");
const criterionLabel = (c: keyof typeof aiCriteria) => (c === "none" ? "None (not in scope)" : aiCriteria[c].split(":")[0]);

/** The Standard for accountability's minimum fields, in its order. */
const standardFields = Object.keys(aiFieldLabels) as AiField[];

const extraHeaders = [
  // The Standard has no type for an AI that takes actions, so crownguard adds one rather than hiding it in a note.
  "Agent (takes actions)",
  "Grouped under",
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

interface RegisterOptions {
  asAt?: Date;
}

/** Basis label for a readiness question, so a reader can tell a binding requirement from best-practice guidance. */
export const basisLabel = (basis?: string) => (basis && basis in aiBases ? aiBases[basis as AiBasis] : "");

/** The register as rows an agency can paste into its own: the Standard's fields first, in its order, then crownguard's. */
export function registerTable(catalogue: Catalogue, assessment: Assessment, opts: RegisterOptions = {}): RegisterTable {
  const asAt = opts.asAt ?? new Date();
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
      isAgentic(e) ? "Yes" : "No",
      e.groupOf ?? "",
      e.example ? "Yes: example data, not a real use case" : "No",
      r.kind?.name ?? e.kind,
      e.product,
      e.autonomy ? aiAutonomy[e.autonomy].label : "",
      e.access ? aiAccess[e.access].label : "",
      list(e.data.map((d) => aiData[d])),
      list(r.jewels.map((j) => j.jewel.name)),
      pct(r.score, ""),
      `${r.answered} of ${r.questions.length}`,
      list(r.gaps.map((g) => `${g.question.id} (${g.question.severity}${basisLabel(g.question.basis) ? `, ${basisLabel(g.question.basis)}` : ""})`)),
      list(r.missing.map((f) => aiFieldLabels[f])),
    ];
  });
  const headers = standardFields.map((f) => aiFieldLabels[f]);
  return { headers: [...headers, ...extraHeaders], rows, standardColumns: headers.length };
}

/** A `YYYY-MM-DD` date in words, e.g. "14 August 2026". The date is a calendar day, so it's read as UTC. */
export const dayText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The "About" sheet: what the columns are, any example data, the dates and caveats, and the sources. */
export function aboutRows(catalogue: Catalogue, assessment: Assessment, opts: RegisterOptions = {}): string[][] {
  const asAt = opts.asAt ?? new Date();
  const module = catalogue.aiRegister;
  if (!module) return [];
  const { model } = module;
  const entries = assessment.aiRegister?.entries ?? [];
  const examples = entries.filter((e) => e.example).length;
  const sources = [...new Set(aiRegisterSources(module))].map((id) => catalogue.sources.get(id)).filter((s) => !!s);
  const share = shareWithDta(assessment, asAt);
  return [
    ["AI use-case register", assessment.org.name],
    ["Exported", `${asAt.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })} from crownguard`],
    [
      "Columns",
      `The first ${standardFields.length} columns of the Register sheet are the minimum fields in the DTA's Standard for accountability, in its order and close to its wording. The owner's name and email address are one field in the Standard and two columns here. The remaining columns are crownguard's additions: keep, rename or drop them to suit your own register.`,
    ],
    ...(assessment.aiRegister?.dateConfirmation?.by
      ? [["Key date", `The worked-out dates in this register were confirmed by ${assessment.aiRegister.dateConfirmation.by}${assessment.aiRegister.dateConfirmation.on ? ` on ${dayText(assessment.aiRegister.dateConfirmation.on)}` : ""}.`]]
      : []),
    ...(share.due
      ? [["Key date", `Next share with the DTA due ${dayText(share.due)} (${share.overdue ? "overdue" : `counted from ${share.basis === "shared" ? "the last share" : "the register's creation"}`}).`]]
      : []),
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
