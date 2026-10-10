import type { AiRegisterModel, Catalogue, Question, SocModel, SocQuestion, Source } from "../content/schema";
import { aiRegisterSummary, shareWithDta, type AiRegisterSummary, type ShareStatus } from "../engine/aiRegister";
import { aiRegisterSources } from "../content/aiRegisterSources";
import { essentialEight, type E8Result } from "../engine/maturity";
import {
  activeQuestions,
  answerValue,
  effectiveAnswers,
  assessAll,
  domainPosture,
  gapStats,
  overallPosture,
  questionsForJewel,
  type DomainPosture,
  type JewelRisk,
} from "../engine/risk";
import { buildRoadmap, type RoadmapItem } from "../engine/roadmap";
import { socMaturity, type SocProvider, type SocResult } from "../engine/soc";
import { idcfRows, jewelDsl, systemCell, type IdcfCell, type IdcfRow, type JewelDsl } from "../engine/idcf";
import { ismBaselineReport, type IsmBaselineSummary } from "../engine/ism";
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
  /**
   * IDCF Data Security Level view: a matrix per platform plus its whole-system and data-movement questions, and the
   * Rule 2 check for each jewel with a DSL, built from the questions that apply to that jewel.
   */
  idcf?: { platforms: { id: string; name: string; rows: IdcfRow[]; system: IdcfCell }[]; jewels: JewelDsl[] };
  /** The optional SOC maturity self-assessment, when included and the module's content is present. */
  soc?: {
    model: SocModel;
    questions: SocQuestion[];
    result: SocResult;
    provider?: SocProvider;
    notes: Record<string, string>;
    /** The SOC-CMM page the structure comes from, and the licence deed, for attribution links. */
    source?: Source;
    licence?: Source;
  };
  /** The optional AI use-case register, when included and the module's content is present. */
  aiRegister?: AiRegisterSummary & { model: AiRegisterModel; share: ShareStatus };
  risks: JewelRisk[];
  domains: DomainPosture[];
  e8: (E8Result & { title: string })[];
  roadmap: RoadmapItem[];
  questions: Question[];
  csf: { fn: string; score: number | null; subcategories: number }[];
  cis: FrameworkRow[];
  /** Every ISM control the in-scope questions map to, with its shortened statement and status. */
  ism: FrameworkRow[];
  /** The chosen ISM baseline's annotation, when one is picked. Never changes a score. */
  ismBaseline?: IsmBaselineSummary;
  sources: Source[];
  assetTypeName: (id: string) => string;
  frameworkName: (id: string) => string;
  licenceGap: (q: Question) => string[];
  platformOf: (q: Question) => string | undefined;
}

/**
 * The standalone AI use-case register report: the register itself and the sources behind it, with none of the
 * crown-jewel scoring — `buildAiRegisterReport` never calls the crown-jewel engine.
 */
export interface AiRegisterReportModel {
  assessment: Assessment;
  generatedAt: Date;
  theme: ReportTheme;
  aiRegister: NonNullable<ReportModel["aiRegister"]>;
  sources: Source[];
}

const themeOf = (b: Assessment["branding"]): ReportTheme => ({
  primary: b.primary,
  heading: readableOn(b.primary),
  onPrimary: textOn(b.primary),
  accent: b.accent,
  tint: tint(b.primary, 0.9),
});

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

  const refRows = (matches: (framework: string) => boolean): FrameworkRow[] => {
    const rows = new Map<string, FrameworkRow>();
    for (const q of questions)
      for (const r of q.refs.filter((r) => matches(r.framework))) {
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
  for (const f of catalogue.frameworks.values())
    if (questions.some((q) => q.refs.some((r) => r.framework === f.id))) for (const id of [f.source, ...f.sources]) sourceIds.add(id);
  const e8Source = catalogue.frameworks.get("essential-eight")?.source;
  if (e8Source) sourceIds.add(e8Source);

  const socModule = assessment.soc && catalogue.soc;
  const soc = socModule
    ? (() => {
        const { model } = socModule;
        for (const id of [model.source, model.licenceSource, ...model.sources]) sourceIds.add(id);
        return {
          model,
          questions: socModule.questions,
          result: socMaturity(model, socModule.questions, assessment.soc!),
          provider: assessment.soc!.provider,
          notes: assessment.soc!.notes ?? {},
          source: catalogue.sources.get(model.source),
          licence: catalogue.sources.get(model.licenceSource),
        };
      })()
    : undefined;

  const risks = assessAll(catalogue, assessment);
  const aiModule = assessment.aiRegister && catalogue.aiRegister;
  const aiRegister = aiModule ? { ...aiRegisterSummary(catalogue, assessment, risks, generatedAt), model: aiModule.model, share: shareWithDta(assessment, generatedAt) } : undefined;
  if (aiModule) for (const id of aiRegisterSources(aiModule)) sourceIds.add(id);

  const used = new Set(questions.flatMap((q) => q.refs.map((r) => r.framework)));
  if (questions.some((q) => q.e8.length)) used.add("essential-eight");
  const roleOf = (id: string) =>
    id.startsWith("cis-")
      ? "Recommendation mapping"
      : id === "essential-eight"
        ? "Indicative maturity"
        : id === "nist-csf-2"
          ? "Function coverage"
          : id === "idcf"
            ? "Data Security Level protection requirements"
            : id === "ism"
              ? "Guideline mapping"
              : "Vendor guidance the questions are drawn from";

  const titled = (rs: E8Result[]) => rs.map((r) => ({ ...r, title: e8Titles.find((c) => c.id === r.strategy)?.title ?? r.strategy }));
  const idcf = catalogue.frameworks.has("idcf")
    ? (() => {
        const platforms = bundles.map((bundle) => {
          const qs = questions.filter((q) => bundle.questions.includes(q));
          const e8 = titled(essentialEight(qs, answers));
          return { id: bundle.platform.id, name: bundle.platform.name, qs, e8, rows: idcfRows(qs, answers, e8), system: systemCell(qs, answers) };
        });
        const jewelsDsl = jewels
          .map((j) => {
            const p = platforms.find((x) => x.id === j.platform);
            if (!p) return undefined;
            // Physical, authorised-person and whole-system parts from this jewel's questions; cyber stays tenant-wide.
            const mine = questionsForJewel(j, p.qs);
            return jewelDsl(j, idcfRows(mine, answers, p.e8, p.qs), systemCell(mine, answers));
          })
          .filter((x): x is JewelDsl => !!x);
        return { platforms: platforms.map(({ id, name, rows, system }) => ({ id, name, rows, system })), jewels: jewelsDsl };
      })()
    : undefined;
  const frameworksUsed = [...used]
    .map((id) => catalogue.frameworks.get(id))
    .filter((f) => !!f)
    .map((f) => ({ name: f.name, publisher: f.publisher, role: roleOf(f.id) }))
    .sort((x, y) => Number(y.role.startsWith("Vendor")) - Number(x.role.startsWith("Vendor")) || x.name.localeCompare(y.name));
  if (soc)
    frameworksUsed.push({
      name: `SOC-CMM® model v${soc.model.basisVersion.split(".").slice(0, 2).join(".")} (domain and aspect structure)`,
      publisher: soc.source?.publisher ?? "SOC-CMM",
      role: "Structure for the optional SOC maturity self-assessment (indicative)",
    });
  if (aiRegister)
    for (const id of new Set(aiRegister.entries.flatMap((r) => r.questions.flatMap((q) => q.refs.map((x) => x.framework)))))
      if (!used.has(id)) {
        const f = catalogue.frameworks.get(id);
        if (f) frameworksUsed.push({ name: f.name, publisher: f.publisher, role: "Mapping for the optional AI use-case register's readiness questions" });
      }

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
    theme: themeOf(b),
    platformNames: bundles.map((x) => x.platform.name),
    posture: overallPosture(catalogue, assessment),
    idcf,
    soc,
    aiRegister,
    risks,
    domains,
    e8: essentialEight(questions, answers).map((r) => ({ ...r, title: e8Titles.find((c) => c.id === r.strategy)?.title ?? r.strategy })),
    roadmap: buildRoadmap(questions, jewels, answers),
    questions,
    csf,
    cis: refRows((framework) => framework.startsWith("cis-")),
    ism: refRows((framework) => framework === "ism"),
    ismBaseline: assessment.ismBaseline ? ismBaselineReport(catalogue, questions, answers, assessment.ismBaseline) : undefined,
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

/**
 * The model behind the standalone `AiRegisterDocument`: the register, its dates and caveats, and the sources behind
 * them. It reads nothing about platforms or crown jewels and never calls the crown-jewel engine.
 */
export function buildAiRegisterReport(catalogue: Catalogue, assessment: Assessment, generatedAt = new Date()): AiRegisterReportModel {
  const aiModule = catalogue.aiRegister;
  if (!aiModule) throw new Error("this build of crownguard doesn't include the AI use-case register content");
  return {
    assessment,
    generatedAt,
    theme: themeOf(assessment.branding),
    aiRegister: {
      ...aiRegisterSummary(catalogue, assessment, [], generatedAt),
      model: aiModule.model,
      share: shareWithDta(assessment, generatedAt),
    },
    sources: [...new Set(aiRegisterSources(aiModule))]
      .map((id) => catalogue.sources.get(id))
      .filter((s): s is Source => !!s)
      .sort((a, b) => a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title)),
  };
}
