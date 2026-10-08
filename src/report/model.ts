import type { Catalogue, Question, Source } from "../content/schema";
import { essentialEight, type E8Result } from "../engine/maturity";
import {
  activeQuestions,
  answerValue,
  effectiveAnswers,
  assessAll,
  domainPosture,
  gapStats,
  overallPosture,
  type DomainPosture,
  type JewelRisk,
} from "../engine/risk";
import { buildRoadmap, type RoadmapItem } from "../engine/roadmap";
import type { Answer, Assessment } from "../engine/types";
import { readableOn, textOn, tint } from "../theme/color";

export interface ReportTheme {
  primary: string;
  /** Primary darkened if needed so it reads as text on white. */
  heading: string;
  onPrimary: string;
  accent: string;
  tint: string;
}

export interface FrameworkRow {
  framework: string;
  ref: string;
  title?: string;
  questions: { question: Question; answer: Answer | undefined }[];
  status: "Met" | "Partly met" | "Not met" | "Not applicable";
}

export interface ReportModel {
  assessment: Assessment;
  /** Answers as scored: N/A without a reason is dropped. */
  answers: Record<string, Answer>;
  notApplicable: { question: Question; reason: string }[];
  /** What is already working, shown before the risks in the executive summary. */
  strengths: {
    inPlace: number;
    partial: number;
    assessed: number;
    /** Controls answered Yes, most severe first. */
    passes: Question[];
    /** Domains at 70 % or better, strongest first. */
    strongDomains: DomainPosture[];
  };
  /** Frameworks the in-scope questions actually map to, vendor guidance first. */
  frameworksUsed: { name: string; publisher: string; role: string }[];
  /** Licence tier name per selected platform. */
  licenceNames: string[];
  generatedAt: Date;
  theme: ReportTheme;
  platformNames: string[];
  posture: { score: number | null; confidence: number };
  risks: JewelRisk[];
  domains: DomainPosture[];
  e8: (E8Result & { title: string })[];
  roadmap: RoadmapItem[];
  questions: Question[];
  csf: { fn: string; score: number | null; subcategories: number }[];
  cis: FrameworkRow[];
  sources: Source[];
  assetTypeName: (id: string) => string;
  frameworkName: (id: string) => string;
  licenceGap: (q: Question) => string[];
  platformOf: (q: Question) => string | undefined;
}

const statusOf = (values: (number | null)[]): FrameworkRow["status"] => {
  const v = values.filter((x): x is number => x !== null);
  if (!v.length) return "Not applicable";
  if (v.every((x) => x === 1)) return "Met";
  if (v.some((x) => x > 0)) return "Partly met";
  return "Not met";
};

export function buildReport(catalogue: Catalogue, assessment: Assessment, generatedAt = new Date()): ReportModel {
  const questions = activeQuestions(catalogue, assessment);
  const answers = effectiveAnswers(assessment);
  const b = assessment.branding;
  const bundles = assessment.platforms.map((p) => catalogue.platforms.get(p)).filter((x) => !!x);
  const jewels = assessment.jewels.filter((j) => assessment.platforms.includes(j.platform));

  const refRows = (prefix: string): FrameworkRow[] => {
    const rows = new Map<string, FrameworkRow>();
    for (const q of questions)
      for (const r of q.refs.filter((r) => r.framework.startsWith(prefix))) {
        const key = `${r.framework}:${r.ref}`;
        const row = rows.get(key) ?? {
          framework: r.framework,
          ref: r.ref,
          title: catalogue.frameworks.get(r.framework)?.controls.find((c) => c.id === r.ref)?.title,
          questions: [],
          status: "Not applicable" as const,
        };
        row.questions.push({ question: q, answer: answers[q.id] });
        rows.set(key, row);
      }
    return [...rows.values()]
      .map((r) => ({ ...r, status: statusOf(r.questions.map((x) => answerValue(x.answer))) }))
      .sort((a, b) => a.framework.localeCompare(b.framework) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  };

  const csfFramework = catalogue.frameworks.get("nist-csf-2");
  const csf = ["Govern", "Identify", "Protect", "Detect", "Respond", "Recover"].map((fn) => {
    const ids = new Set(csfFramework?.controls.filter((c) => c.group === fn).map((c) => c.id) ?? []);
    const qs = questions.filter((q) => q.refs.some((r) => r.framework === "nist-csf-2" && ids.has(r.ref)));
    const s = gapStats(qs, answers);
    const subcategories = new Set(qs.flatMap((q) => q.refs.filter((r) => r.framework === "nist-csf-2" && ids.has(r.ref)).map((r) => r.ref))).size;
    return { fn, score: s.weight ? 1 - s.gap / s.weight : null, subcategories };
  });

  const e8Titles = catalogue.frameworks.get("essential-eight")?.controls ?? [];
  const sourceIds = new Set(questions.flatMap((q) => q.sources));
  for (const f of catalogue.frameworks.values()) if (questions.some((q) => q.refs.some((r) => r.framework === f.id))) sourceIds.add(f.source);
  const e8Source = catalogue.frameworks.get("essential-eight")?.source;
  if (e8Source) sourceIds.add(e8Source);

  const used = new Set(questions.flatMap((q) => q.refs.map((r) => r.framework)));
  if (questions.some((q) => q.e8.length)) used.add("essential-eight");
  const roleOf = (id: string) =>
    id.startsWith("cis-") ? "Recommendation mapping" : id === "essential-eight" ? "Indicative maturity" : id === "nist-csf-2" ? "Function coverage" : "Vendor guidance the questions are drawn from";
  const frameworksUsed = [...used]
    .map((id) => catalogue.frameworks.get(id))
    .filter((f) => !!f)
    .map((f) => ({ name: f.name, publisher: f.publisher, role: roleOf(f.id) }))
    .sort((x, y) => Number(y.role.startsWith("Vendor")) - Number(x.role.startsWith("Vendor")) || x.name.localeCompare(y.name));

  const domains = domainPosture(catalogue, assessment);
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  const strengths = {
    inPlace: questions.filter((q) => answers[q.id] === "yes").length,
    partial: questions.filter((q) => answers[q.id] === "partial").length,
    assessed: questions.filter((q) => answers[q.id] && answers[q.id] !== "na").length,
    passes: questions.filter((q) => answers[q.id] === "yes").sort((x, y) => severityRank[x.severity] - severityRank[y.severity] || x.id.localeCompare(y.id)),
    strongDomains: domains.filter((d) => d.score !== null && d.score >= 0.7).sort((x, y) => (y.score ?? 0) - (x.score ?? 0)),
  };

  return {
    assessment,
    answers,
    strengths,
    frameworksUsed,
    licenceNames: bundles.map((x) => {
      const tier = x.platform.licenceTiers.find((t) => t.id === assessment.licence[x.platform.id]);
      return `${x.platform.name}: ${tier?.name ?? "not specified"}`;
    }),
    notApplicable: questions.filter((q) => answers[q.id] === "na").map((question) => ({ question, reason: assessment.notes[question.id].trim() })),
    generatedAt,
    theme: {
      primary: b.primary,
      heading: readableOn(b.primary),
      onPrimary: textOn(b.primary),
      accent: b.accent,
      tint: tint(b.primary, 0.9),
    },
    platformNames: bundles.map((x) => x.platform.name),
    posture: overallPosture(catalogue, assessment),
    risks: assessAll(catalogue, assessment),
    domains,
    e8: essentialEight(questions, answers).map((r) => ({ ...r, title: e8Titles.find((c) => c.id === r.strategy)?.title ?? r.strategy })),
    roadmap: buildRoadmap(questions, jewels, answers),
    questions,
    csf,
    cis: refRows("cis-"),
    sources: [...sourceIds].map((id) => catalogue.sources.get(id)).filter((s): s is Source => !!s).sort((a, b) => a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title)),
    assetTypeName: (id) => bundles.flatMap((x) => x.assetTypes).find((a) => a.id === id)?.name ?? id,
    frameworkName: (id) => catalogue.frameworks.get(id)?.shortName ?? id,
    platformOf: (q) => bundles.find((x) => x.questions.includes(q))?.platform.id,
    licenceGap: (q) => {
      const bundle = bundles.find((x) => x.questions.includes(q));
      if (!bundle) return [];
      const have = new Set(bundle.platform.licenceTiers.find((t) => t.id === assessment.licence[bundle.platform.id])?.features ?? []);
      return q.licence.filter((l) => !have.has(l)).map((l) => bundle.platform.licenceFeatures.find((f) => f.id === l)?.name ?? l);
    },
  };
}
