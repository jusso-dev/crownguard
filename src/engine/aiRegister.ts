import { severities, type AiKind, type AiQuestion, type Catalogue, type ExposureId, type Question } from "../content/schema";
import { aiCriteria, aiRiskRatings, aiTechnologies } from "./aiOptions";
import { activeQuestions, answerValue, effectiveAnswers, isGap, type JewelRisk } from "./risk";
import type { AiUseCase, Answer, Assessment, CrownJewel } from "./types";

/**
 * Register field names, in the Standard for accountability's order and close to its wording. The owner's name and
 * email are one field in the Standard; they're kept apart here so each can be checked.
 */
export const aiFieldLabels = {
  name: "Use case name",
  reference: "Agency identifier (reference number)",
  description: "Description",
  technology: "AI technology type",
  lifecycle: "Lifecycle stage",
  technicalStandard: "Use of the Technical standard",
  domains: "Domain",
  usagePatterns: "Usage pattern",
  ownerName: "Accountable use case owner (name)",
  ownerEmail: "Accountable use case owner (email address)",
  criteria: "Appendix C criteria met",
  inherentRisk: "Inherent risk rating",
  residualRisk: "Residual risk rating",
  impactAssessmentDate: "Date the AI impact assessment was last updated",
  lastReview: "Last date of review",
  nextReview: "Date for next review",
} as const;
export type AiField = keyof typeof aiFieldLabels;

/** Source ids behind each group of register fields, for the citations next to them. */
export const aiFieldSources = {
  register: ["dta-ai-accountability"],
  classification: ["dta-ai-classification", "dta-ai-transparency"],
  criteria: ["dta-ai-policy-appendices"],
  risk: ["dta-ai-impact-assessment", "dta-aiia-inherent-risk"],
  autonomy: ["dta-agentic-key-terms", "dta-agentic-lifecycle"],
  access: ["dta-agentic-design", "asd-agentic-ai"],
} as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const kindOf = (catalogue: Catalogue, e: Pick<AiUseCase, "kind">): AiKind | undefined => catalogue.aiRegister?.model.kinds.find((k) => k.id === e.kind);

/** Anything that can take actions, or might: unrecorded and "Not sure" count, so the agent questions aren't skipped by default. */
export const isAgentic = (e: AiUseCase) => e.autonomy !== "assists";

/** In scope of the policy under Appendix C: undefined until the criteria have been worked through. */
export function inScope(e: AiUseCase): boolean | undefined {
  if (e.criteria.length === 0) return undefined;
  return e.criteria.some((c) => c !== "none");
}

const handlesPersonal = (e: AiUseCase) => e.data.length === 0 || e.data.some((d) => d === "personal" || d === "sensitive" || d === "unknown");

/** Whether a readiness question is asked for this use case. Unsure answers keep questions in, never drop them. */
export function applies(q: AiQuestion, e: AiUseCase, kind: AiKind | undefined): boolean {
  switch (q.when) {
    case "all":
      return true;
    case "agentic":
      return isAgentic(e);
    case "personal-data":
      return handlesPersonal(e);
    case "indigenous-data":
      return e.data.includes("indigenous");
    case "in-scope":
      return inScope(e) !== false;
    case "high-risk":
      return e.inherentRisk === "high";
    case "public-tool":
      return !!kind?.publicTool;
  }
}

/** As on the Controls step, N/A needs a reason; without one it counts as unanswered. */
export const aiNeedsReason = (e: AiUseCase, questionId: string) => e.answers[questionId] === "na" && !e.notes[questionId]?.trim();

export function aiEffectiveAnswers(e: AiUseCase): Record<string, Answer> {
  const out: Record<string, Answer> = {};
  for (const [id, a] of Object.entries(e.answers)) if (!aiNeedsReason(e, id)) out[id] = a;
  return out;
}

/** Register fields still empty. Risk ratings and the assessment date count once it's in scope; review dates once it's high risk. */
export function missingFields(e: AiUseCase): AiField[] {
  const scoped = inScope(e) === true;
  const empty: Record<AiField, boolean> = {
    name: !e.name.trim(),
    reference: !e.reference.trim(),
    description: !e.description.trim(),
    technology: e.technology.length === 0,
    lifecycle: !e.lifecycle,
    technicalStandard: !e.technicalStandard,
    domains: e.domains.length === 0,
    usagePatterns: e.usagePatterns.length === 0,
    ownerName: !e.ownerName.trim(),
    ownerEmail: !EMAIL.test(e.ownerEmail.trim()),
    criteria: e.criteria.length === 0,
    inherentRisk: scoped && !e.inherentRisk,
    residualRisk: scoped && !e.residualRisk,
    impactAssessmentDate: scoped && !DATE.test(e.impactAssessmentDate ?? ""),
    lastReview: e.inherentRisk === "high" && !DATE.test(e.lastReview ?? ""),
    nextReview: e.inherentRisk === "high" && !DATE.test(e.nextReview ?? ""),
  };
  return (Object.keys(aiFieldLabels) as AiField[]).filter((f) => empty[f]);
}

/** Things to point out that aren't a single question's answer. */
export function aiFlags(e: AiUseCase, asAt = new Date()): string[] {
  const flags: string[] = [];
  if (e.autonomy === "hootl")
    flags.push("It acts without routine human supervision. The agentic AI addendum says oversight must be kept through a human-in-the-loop or human-on-the-loop model (AGT.1.2).");
  if (isAgentic(e) && (e.access === "org-wide" || e.access === "privileged"))
    flags.push("An agent with organisation-wide or administrative access. The addendum and ASD both expect least privilege: access to only the resources and tools the task needs.");
  if (e.access === "unknown" || (isAgentic(e) && !e.access)) flags.push("Its access level isn't recorded yet. Check what it can reach in your admin centre.");
  if (e.inherentRisk === "high" && DATE.test(e.lastReview ?? "") && DATE.test(e.nextReview ?? "")) {
    const due = new Date(`${e.lastReview}T00:00:00Z`);
    due.setUTCFullYear(due.getUTCFullYear() + 1);
    if (new Date(`${e.nextReview}T00:00:00Z`) > due) flags.push("The next review is more than 12 months after the last one. The policy says high-risk use cases are reviewed at least every 12 months.");
  }
  if (e.inherentRisk === "high" && DATE.test(e.nextReview ?? "") && new Date(`${e.nextReview}T23:59:59Z`) < asAt) flags.push(`The review due ${e.nextReview} is overdue.`);
  return flags;
}

/** Appendix C criterion 4 looks likely from the data recorded, but isn't ticked. Offered, never ticked for the user. */
export const suggestsCriterion4 = (e: AiUseCase) =>
  e.data.some((d) => d === "personal" || d === "sensitive" || d === "classified") && !e.criteria.includes("c4");

export interface ExposureSuggestion {
  jewel: CrownJewel;
  exposure: ExposureId;
}

/** Exposures this kind of AI usually creates on the crown jewels it can reach, where the jewel's type has them and they aren't ticked. */
export function exposureSuggestions(catalogue: Catalogue, assessment: Assessment, e: AiUseCase): ExposureSuggestion[] {
  const kind = kindOf(catalogue, e);
  if (!kind) return [];
  const assetTypes = [...catalogue.platforms.values()].flatMap((b) => b.assetTypes);
  return assessment.jewels
    .filter((j) => e.jewels.includes(j.id))
    .flatMap((jewel) => {
      const type = assetTypes.find((t) => t.id === jewel.assetType);
      return kind.exposures.filter((x) => type?.exposures.includes(x) && !jewel.exposures.includes(x)).map((exposure) => ({ jewel, exposure }));
    });
}

export type ThemeStatus = "Met" | "Partly met" | "Not met" | "Not applicable" | "Not asked";

export interface AiReadiness {
  entry: AiUseCase;
  kind?: AiKind;
  /** Readiness questions asked for this use case, in content order. */
  questions: AiQuestion[];
  answers: Record<string, Answer>;
  answered: number;
  /** Severity-weighted share in place, 0-1; null before anything scoreable is answered. */
  score: number | null;
  /** Share of question weight with a real answer (not Unknown or unanswered), 0-1. */
  confidence: number;
  gaps: { question: AiQuestion; answer: Answer | undefined }[];
  themes: { id: string; name: string; status: ThemeStatus; questions: number; gaps: number }[];
  missing: AiField[];
  flags: string[];
  inScope: boolean | undefined;
  suggestCriterion4: boolean;
  exposures: ExposureSuggestion[];
  /** Linked crown jewels with their current risk, when they're on a selected platform. */
  jewels: { jewel: CrownJewel; risk?: JewelRisk }[];
  /** Platform control questions on the same tool that are in this assessment, with their Controls answers. */
  related: { question: Question; answer: Answer | undefined }[];
}

const themeStatus = (values: (number | null)[]): ThemeStatus => {
  if (values.length === 0) return "Not asked";
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return "Not applicable";
  if (v.every((x) => x === 1)) return "Met";
  if (v.some((x) => x > 0)) return "Partly met";
  return "Not met";
};

const bySeverity = (a: AiQuestion, b: AiQuestion) => severities[b.severity] - severities[a.severity] || a.id.localeCompare(b.id);

export function aiReadiness(catalogue: Catalogue, assessment: Assessment, e: AiUseCase, risks: JewelRisk[] = [], asAt = new Date()): AiReadiness {
  const module = catalogue.aiRegister;
  const kind = kindOf(catalogue, e);
  const questions = (module?.questions ?? []).filter((q) => applies(q, e, kind));
  const answers = aiEffectiveAnswers(e);
  let weight = 0;
  let gap = 0;
  let unknown = 0;
  let answeredWeight = 0;
  for (const q of questions) {
    const a = answers[q.id];
    const v = answerValue(a);
    if (v === null) continue;
    const w = severities[q.severity];
    weight += w;
    gap += w * (1 - v);
    if (a === undefined || a === "unknown") unknown += w;
    if (a !== undefined) answeredWeight += w;
  }
  const controls = new Map(activeQuestions(catalogue, assessment).map((q) => [q.id, q]));
  const controlAnswers = effectiveAnswers(assessment);
  return {
    entry: e,
    kind,
    questions,
    answers,
    answered: questions.filter((q) => answers[q.id]).length,
    score: weight === 0 || answeredWeight === 0 ? null : 1 - gap / weight,
    confidence: weight === 0 ? 0 : 1 - unknown / weight,
    gaps: questions
      .filter((q) => isGap(answers[q.id]))
      .sort(bySeverity)
      .map((question) => ({ question, answer: answers[question.id] })),
    themes: (module?.model.themes ?? []).map((t) => {
      const qs = questions.filter((q) => q.theme === t.id);
      return { id: t.id, name: t.name, status: themeStatus(qs.map((q) => answerValue(answers[q.id]))), questions: qs.length, gaps: qs.filter((q) => isGap(answers[q.id])).length };
    }),
    missing: missingFields(e),
    flags: aiFlags(e, asAt),
    inScope: inScope(e),
    suggestCriterion4: suggestsCriterion4(e),
    exposures: exposureSuggestions(catalogue, assessment, e),
    jewels: assessment.jewels.filter((j) => e.jewels.includes(j.id)).map((jewel) => ({ jewel, risk: risks.find((r) => r.jewel.id === jewel.id) })),
    related: (kind?.relatedQuestions ?? []).flatMap((id) => {
      const question = controls.get(id);
      return question ? [{ question, answer: controlAnswers[id] }] : [];
    }),
  };
}

export interface AiRegisterSummary {
  entries: AiReadiness[];
  inScope: number;
  undetermined: number;
  highRisk: number;
  openGaps: number;
  criticalGaps: number;
  missingFields: number;
  examples: number;
}

export function aiRegisterSummary(catalogue: Catalogue, assessment: Assessment, risks: JewelRisk[] = [], asAt = new Date()): AiRegisterSummary {
  const entries = (assessment.aiRegister?.entries ?? []).map((e) => aiReadiness(catalogue, assessment, e, risks, asAt));
  return {
    entries,
    inScope: entries.filter((r) => r.inScope === true).length,
    undetermined: entries.filter((r) => r.inScope === undefined).length,
    highRisk: entries.filter((r) => r.entry.inherentRisk === "high").length,
    openGaps: entries.reduce((n, r) => n + r.gaps.length, 0),
    criticalGaps: entries.reduce((n, r) => n + r.gaps.filter((g) => g.question.severity === "critical").length, 0),
    missingFields: entries.reduce((n, r) => n + r.missing.length, 0),
    examples: entries.filter((r) => r.entry.example).length,
  };
}

/** A new register entry filled with the preset's defaults; nothing the user must decide is pre-set. */
export function newUseCase(kind: AiKind, id: string): AiUseCase {
  return {
    id,
    kind: kind.id,
    name: kind.id === "other" ? "" : kind.name,
    reference: "",
    description: "",
    product: kind.product,
    technology: [...kind.defaults.technology],
    domains: [...kind.defaults.domains],
    usagePatterns: [...kind.defaults.usagePatterns],
    ownerName: "",
    ownerEmail: "",
    criteria: [],
    autonomy: kind.defaults.autonomy,
    access: kind.defaults.access,
    data: [],
    jewels: [],
    answers: {},
    notes: {},
  };
}

/**
 * Add whole months to a `YYYY-MM-DD` date, clamping to the last day of the target month. Computed in UTC so a date
 * doesn't move when the file travels across time zones: 31 August plus six months is 28 or 29 February, never 2 March.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

export interface ShareStatus {
  /** When the next share with the DTA is due, once the register has a creation date. */
  due?: string;
  /** What the due date was counted from: the register's creation, or the last time it was shared. */
  basis?: "created" | "shared";
  overdue: boolean;
  /** Due within 30 days, worth mentioning before it becomes late. */
  soon: boolean;
}

/**
 * When the register next has to go to the DTA. The policy says every six months "starting from when you create it",
 * so the clock runs from the register's creation date until a share is recorded, and then from that share.
 */
export function shareWithDta(a: Assessment, asAt = new Date()): ShareStatus {
  const r = a.aiRegister;
  if (!r?.createdAt) return { overdue: false, soon: false };
  const basis = r.lastSharedWithDta ? "shared" : "created";
  const due = addMonths(r.lastSharedWithDta ?? r.createdAt, 6);
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.UTC(asAt.getUTCFullYear(), asAt.getUTCMonth(), asAt.getUTCDate())) / 86_400_000);
  return { due, basis, overdue: days < 0, soon: days >= 0 && days <= 30 };
}

const sensibilities: { key: string; text: string }[] = [
  { key: "personal", text: "personal information" },
  { key: "sensitive", text: "sensitive information" },
  { key: "classified", text: "security classified information" },
  { key: "indigenous", text: "Indigenous data" },
];

/**
 * The four things the Standard for accountability says a high-risk notification should contain, assembled from the
 * entry's own fields so the accountable official has a draft. crownguard writes the text; it never sends anything.
 */
export function highRiskNotification(e: AiUseCase): string {
  const sensitivities = sensibilities.filter((s) => e.data.includes(s.key as AiUseCase["data"][number])).map((s) => s.text);
  return [
    `Type of AI: ${e.technology.map((t) => aiTechnologies[t]).join(", ") || "not recorded"}${e.product ? ` — ${e.product}` : ""}.`,
    `Intended application: ${e.description || e.name || "not recorded"}.`,
    `How the risk rating was reached: inherent risk ${e.inherentRisk ? aiRiskRatings[e.inherentRisk] : "not recorded"}${
      e.impactAssessmentDate ? `, impact assessment dated ${e.impactAssessmentDate}` : ", no impact assessment date recorded"
    }.${e.criteria.length ? ` Appendix C criteria: ${e.criteria.map((c) => (c === "none" ? "none" : aiCriteria[c].split(":")[0])).join(", ")}.` : ""}`,
    `Sensitivities: ${sensitivities.length ? sensitivities.join(", ") : "none recorded"}.`,
  ].join("\n\n");
}

/**
 * The kill-switch worksheet the switch-off question's note carries. It's stored as plain labelled lines in
 * `notes["AIR-OFF-001"]` so older files and any hand-edited note still read, and it needs no schema change.
 */
export interface KillSwitchNote {
  stop: string;
  who: string;
  targetTime: string;
  /** YYYY-MM-DD. */
  tested: string;
  rollback: string;
  /** Why the question doesn't apply, when it's answered N/A: the reason the note slot is shared with. */
  reason: string;
  /** Anything else recorded on the question, kept as written. */
  other: string;
}

const killSwitchLabels: [keyof KillSwitchNote, string][] = [
  ["stop", "How to stop it (identity, tokens, connectors)"],
  ["who", "Who may stop it"],
  ["targetTime", "Target time to stop"],
  ["tested", "Date it was last tested"],
  ["rollback", "Rollback approach"],
  ["reason", "Why it doesn't apply"],
];

export const emptyKillSwitchNote = (): KillSwitchNote => ({ stop: "", who: "", targetTime: "", tested: "", rollback: "", reason: "", other: "" });

/** Read a worksheet back out of the note's labelled lines. Unlabelled lines continue the field above them. */
export function parseKillSwitchNote(text: string | undefined): KillSwitchNote {
  const out = emptyKillSwitchNote();
  let current: keyof KillSwitchNote | undefined;
  for (const line of (text ?? "").split("\n")) {
    const labelled = killSwitchLabels.find(([, label]) => line.startsWith(`${label}: `));
    if (labelled) {
      current = labelled[0];
      out[current] = line.slice(labelled[1].length + 2);
    } else if (current) {
      out[current] += `\n${line}`;
    } else if (line.trim()) {
      out.other += (out.other ? "\n" : "") + line;
    }
  }
  return out;
}

/** The note text to save. Only the labels above are recognised when it's read back. */
export function composeKillSwitchNote(n: KillSwitchNote): string {
  return [
    ...killSwitchLabels.filter(([key]) => n[key].trim()).map(([key, label]) => `${label}: ${n[key]}`),
    n.other.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The DTA's Appendix B lets an agency register general-purpose AI such as Copilot as one use case at its highest risk,
 * or as several with their own owners. Mixing the two for the same product is what it doesn't intend.
 */
export function groupWarning(entries: AiUseCase[]): string | undefined {
  const byProduct = new Map<string, { parts: string[]; alone: string[] }>();
  for (const e of entries) {
    const key = (e.product || e.name).trim().toLowerCase();
    if (!key) continue;
    const s = byProduct.get(key) ?? { parts: [], alone: [] };
    (e.groupOf ? s.parts : s.alone).push(e.name || e.id);
    byProduct.set(key, s);
  }
  for (const [product, s] of byProduct) {
    if (s.parts.length && s.alone.length)
      return `${entries.find((e) => (e.product || e.name).trim().toLowerCase() === product)?.product || product} is registered both on its own (${s.alone.join(", ")}) and as parts of one (${s.parts.join(", ")}). The DTA's Appendix B allows either; pick one approach and use it consistently.`;
  }
  return undefined;
}
