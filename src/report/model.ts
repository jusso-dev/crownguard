import type { AiRegisterModel, Catalogue, Framework, Question, SocModel, SocQuestion, Source } from "../content/schema";
import { SOURCES_LAST_CHECKED } from "../content/sourcesChecked";
import { aiRegisterSummary, shareWithDta, type AiRegisterSummary, type ShareStatus } from "../engine/aiRegister";
import { aiRegisterSources } from "../content/aiRegisterSources";
import { formatAbn, isValidAbn } from "../engine/abn";
import { essentialEight, type E8Result } from "../engine/maturity";
import {
  activeQuestions,
  bySeverity,
  effectiveAnswers,
  assessAll,
  domainPosture,
  gapStats,
  isGap,
  metStatus,
  scoreOf,
  overallPosture,
  questionPlatform,
  questionsForJewel,
  type DomainPosture,
  type JewelRisk,
  isHighRisk,
} from "../engine/risk";
import { buildRoadmap, phases, type RoadmapItem } from "../engine/roadmap";
import { socMaturity, type SocResult } from "../engine/soc";
import type { SocProvider, Answer } from "../format/vocab";
import { idcfRows, jewelDsl, systemCell, type IdcfCell, type IdcfRow, type JewelDsl } from "../engine/idcf";
import { ismBaselineReport, type IsmBaselineSummary } from "../engine/ism";
import { essentials as essentialsResult, transitionGaps, type DomainResult, type EssentialsResult, type TransitionGap } from "../engine/essentials";
import type { Assessment, Evidence, ImportRecord } from "../format/schema";
import { readableOn, textOn, tint } from "../theme/color";

export interface ReportTheme {
  primary: string;
  /** Primary darkened if needed so it reads as text on white. */
  heading: string;
  onPrimary: string;
  accent: string;
  tint: string;
}

/** Who a document is for and when it was made: the cover and the running header and footer. */
export interface DocumentHeader {
  org: string;
  /** The ABN formatted for print, when the one recorded is valid. */
  abn?: string;
  branding: Assessment["branding"];
  theme: ReportTheme;
  generatedAt: Date;
  answersAsAt: Date;
}

interface FrameworkRow {
  framework: string;
  frameworkName: string;
  ref: string;
  title?: string;
  questions: { question: Question; answer: Answer | undefined }[];
  status: ReturnType<typeof metStatus>;
}

/** A control that isn't fully in place, with everything printed beside it. */
export interface Finding {
  question: Question;
  answer: Answer | undefined;
  /** Licence features the fix needs that the platform's chosen licence tier doesn't include. */
  licenceGap: string[];
  note?: string;
  evidence?: Evidence;
  /** Framework, Essential Eight and Essentials references, as printed. */
  refs: string[];
  /** Controls in the chosen ISM baseline that this finding touches. */
  ismBaseline: string[];
}

type TitledE8 = E8Result & { title: string };

export type AiRegisterSlice = AiRegisterSummary & {
  model: AiRegisterModel;
  share: ShareStatus;
  /** Who confirmed the worked-out dates, and when, once someone has. */
  dateConfirmation?: { by: string; on?: string };
};

/** The SOC priorities printed in full. Notes on the rest are listed with the other assessor notes. */
export const SOC_PRIORITIES_SHOWN = 8;

export interface ReportModel {
  header: DocumentHeader;
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
    /** Essential Eight strategies at indicative Maturity Level 1 or above. */
    e8Reached: TitledE8[];
  };
  /** Where to focus, after the strengths in the executive summary. */
  focus: {
    highOrExtreme: number;
    /** Controls still Unknown or unanswered. */
    unknown: number;
    /** The first few actions in the first roadmap phase. */
    quickWins: RoadmapItem[];
  };
  /** Frameworks the in-scope questions actually map to, vendor guidance first. */
  frameworksUsed: { name: string; publisher: string; role: string }[];
  /** Licence tier name per selected platform. */
  licenceNames: string[];
  /** YYYY-MM-DD derived at build time from watch/state.json (feed cursors / git date of the file). */
  sourcesLastChecked?: string;
  platformNames: string[];
  posture: { score: number | null; confidence: number };
  /**
   * IDCF Data Security Level view: a matrix per platform plus its whole-system and data-movement questions, and the
   * Rule 2 check for each jewel with a DSL, built from the questions that apply to that jewel.
   */
  idcf?: {
    platforms: { id: string; name: string; rows: IdcfRow[]; system: IdcfCell }[];
    jewels: JewelDsl[];
    /** Some crown jewel in scope has no Data Security Level. */
    unclassified: boolean;
  };
  /** The optional SOC maturity self-assessment, when included and the module's content is present. */
  soc?: {
    model: SocModel;
    questions: SocQuestion[];
    result: SocResult;
    provider?: SocProvider;
    /** The SOC-CMM model version the structure follows, e.g. "2.4". */
    version: string;
    aspects: number;
    /** Domains with an aspect in scope, and how many of those reach their maturity target. */
    assessed: number;
    onTarget: number;
    /** Questions unanswered or answered Unknown, all scored 0. */
    unsure: number;
    /** Each question's note, trimmed, when it has one. */
    notes: Record<string, string>;
    /** Notes not already shown beside a printed priority or capability gap, in question order. */
    otherNotes: { id: string; aspect: string; kind: SocQuestion["kind"]; note: string }[];
    /** The SOC-CMM page the structure comes from, and the licence deed, for attribution links. */
    source?: Source;
    licence?: Source;
  };
  /** The optional AI use-case register, when included and the module's content is present. */
  aiRegister?: AiRegisterSlice;
  risks: (JewelRisk & { assetTypeName: string })[];
  domains: DomainPosture[];
  /** Each domain's open findings, in domain order. Domains with none are left out. */
  findings: { domain: DomainPosture; items: Finding[] }[];
  e8: TitledE8[];
  roadmap: RoadmapItem[];
  questions: Question[];
  csf: { fn: string; score: number | null; subcategories: number }[];
  cis: FrameworkRow[];
  /** Every ISM control the in-scope questions map to, with its shortened statement and status. */
  ism: FrameworkRow[];
  ismName: string;
  /** The chosen ISM baseline's annotation, when one is picked. Never changes a score. */
  ismBaseline?: IsmBaselineSummary;
  /**
   * The optional ASD Essentials section for the chosen chapter: indicative ratings by phase and domain, and the
   * Essential Eight to Essentials gap view. Built from `essentials:` tags only; nothing in it comes from `e8`.
   */
  essentials?: EssentialsResult & {
    gaps: (TransitionGap & { strategyTitles: string[] })[];
    /** Technical domains ASD puts in priority phase 1. */
    priorityDomains: DomainResult[];
  };
  /** Scans imported into the assessment. */
  imports: ImportRecord[];
  /** Questions that carry at least one mapped scan check, in catalogue order. */
  scanEvidence: { question: Question; evidence: Evidence }[];
  sources: Source[];
}

/**
 * The standalone AI use-case register report: the register itself and the sources behind it, with none of the
 * crown-jewel scoring — `buildAiRegisterReport` never calls the crown-jewel engine.
 */
export interface AiRegisterReportModel {
  header: DocumentHeader;
  aiRegister: AiRegisterSlice;
  sources: Source[];
}

const headerOf = (a: Assessment, generatedAt: Date): DocumentHeader => ({
  org: a.org.name,
  abn: a.org.abn && isValidAbn(a.org.abn) ? formatAbn(a.org.abn) : undefined,
  branding: a.branding,
  theme: {
    primary: a.branding.primary,
    heading: readableOn(a.branding.primary),
    onPrimary: textOn(a.branding.primary),
    accent: a.branding.accent,
    tint: tint(a.branding.primary, 0.9),
  },
  generatedAt,
  answersAsAt: new Date(a.updatedAt),
});

const sourcesOf = (catalogue: Catalogue, ids: Iterable<string>): Source[] =>
  [...new Set(ids)]
    .map((id) => catalogue.sources.get(id))
    .filter((s): s is Source => !!s)
    .sort((a, b) => a.publisher.localeCompare(b.publisher) || a.title.localeCompare(b.title));

function aiRegisterOf(catalogue: Catalogue, assessment: Assessment, model: AiRegisterModel, risks: JewelRisk[], generatedAt: Date): AiRegisterSlice {
  const confirmed = assessment.aiRegister?.dateConfirmation;
  return {
    ...aiRegisterSummary(catalogue, assessment, risks, generatedAt),
    model,
    share: shareWithDta(assessment, generatedAt),
    dateConfirmation: confirmed?.by ? { by: confirmed.by, on: confirmed.on || undefined } : undefined,
  };
}

const CSF = "nist-csf-2";
const E8 = "essential-eight";
const ISM = "ism";
const VENDOR_ROLE = "Vendor guidance the questions are drawn from";
const frameworkRoles: Record<string, string> = {
  [E8]: "Indicative maturity",
  [CSF]: "Function coverage",
  idcf: "Data Security Level protection requirements",
  [ISM]: "Guideline mapping",
};
const roleOf = (f: Framework) =>
  f.essentials ? "Indicative effectiveness ratings by domain" : f.id.startsWith("cis-") ? "Recommendation mapping" : (frameworkRoles[f.id] ?? VENDOR_ROLE);

export function buildReport(catalogue: Catalogue, assessment: Assessment, generatedAt = new Date()): ReportModel {
  const questions = activeQuestions(catalogue, assessment);
  const answers = effectiveAnswers(assessment);
  const bundles = assessment.platforms.map((p) => catalogue.platforms.get(p)).filter((x) => !!x);
  const jewels = assessment.jewels.filter((j) => assessment.platforms.includes(j.platform));
  const platformOf = questionPlatform(catalogue, assessment.platforms);
  const frameworkName = (id: string) => catalogue.frameworks.get(id)?.shortName ?? id;

  const refRows = (matches: (framework: string) => boolean): FrameworkRow[] => {
    const rows = new Map<string, FrameworkRow>();
    for (const q of questions)
      for (const r of q.refs.filter((r) => matches(r.framework))) {
        const key = `${r.framework}:${r.ref}`;
        const row = rows.get(key) ?? {
          framework: r.framework,
          frameworkName: frameworkName(r.framework),
          ref: r.ref,
          title: catalogue.frameworks.get(r.framework)?.controls.find((c) => c.id === r.ref)?.title,
          questions: [],
          status: "Not applicable" as const,
        };
        row.questions.push({ question: q, answer: answers[q.id] });
        rows.set(key, row);
      }
    return [...rows.values()]
      .map((r) => ({ ...r, status: metStatus(r.questions.map((x) => x.answer)) }))
      .sort((a, b) => a.framework.localeCompare(b.framework) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  };

  const csfControls = catalogue.frameworks.get(CSF)?.controls ?? [];
  const csf = [...new Set(csfControls.map((c) => c.group).filter((g) => g !== undefined))].map((fn) => {
    const ids = new Set(csfControls.filter((c) => c.group === fn).map((c) => c.id));
    const refs = (q: Question) => q.refs.filter((r) => r.framework === CSF && ids.has(r.ref)).map((r) => r.ref);
    const qs = questions.filter((q) => refs(q).length > 0);
    return { fn, score: scoreOf(gapStats(qs, answers)), subcategories: new Set(qs.flatMap(refs)).size };
  });

  const e8Controls = catalogue.frameworks.get(E8)?.controls ?? [];
  const e8Title = (strategy: string) => e8Controls.find((c) => c.id === strategy)?.title ?? strategy;
  const titled = (rs: E8Result[]): TitledE8[] => rs.map((r) => ({ ...r, title: e8Title(r.strategy) }));
  const e8 = titled(essentialEight(questions, answers));

  const sourceIds = new Set(questions.flatMap((q) => q.sources));
  for (const f of catalogue.frameworks.values())
    if (questions.some((q) => q.refs.some((r) => r.framework === f.id))) for (const id of [f.source, ...f.sources]) sourceIds.add(id);
  const e8Source = catalogue.frameworks.get(E8)?.source;
  if (e8Source) sourceIds.add(e8Source);

  const socModule = assessment.soc && catalogue.soc;
  const soc = socModule
    ? (() => {
        const { model, questions: socQuestions } = socModule;
        const input = assessment.soc!;
        for (const id of [model.source, model.licenceSource, ...model.sources]) sourceIds.add(id);
        const result = socMaturity(model, socQuestions, input);
        const notes = Object.fromEntries(
          Object.entries(input.notes ?? {})
            .map(([id, note]) => [id, note.trim()] as const)
            .filter(([, note]) => note),
        );
        const shown = new Set([...result.priorities.slice(0, SOC_PRIORITIES_SHOWN), ...result.capabilityGaps].map((p) => p.question.id));
        const aspects = model.domains.flatMap((d) => d.aspects);
        const assessed = result.domains.filter((d) => d.maturity !== null);
        return {
          model,
          questions: socQuestions,
          result,
          provider: input.provider,
          version: model.basisVersion.split(".").slice(0, 2).join("."),
          aspects: aspects.length,
          assessed: assessed.length,
          onTarget: assessed.filter((d) => d.maturity! >= d.target.maturity).length,
          unsure: result.total - result.answered + result.unknown,
          notes,
          otherNotes: socQuestions
            .filter((q) => notes[q.id] && !shown.has(q.id))
            .map((q) => ({ id: q.id, aspect: aspects.find((a) => a.id === q.aspect)?.name ?? q.aspect, kind: q.kind, note: notes[q.id] })),
          source: catalogue.sources.get(model.source),
          licence: catalogue.sources.get(model.licenceSource),
        };
      })()
    : undefined;

  const risks = assessAll(catalogue, assessment);
  const aiModule = assessment.aiRegister && catalogue.aiRegister;
  const aiRegister = aiModule ? aiRegisterOf(catalogue, assessment, aiModule.model, risks, generatedAt) : undefined;
  if (aiModule) for (const id of aiRegisterSources(aiModule)) sourceIds.add(id);

  const chapterFramework = assessment.essentials ? catalogue.frameworks.get(`asd-essentials-${assessment.essentials.chapter}`) : undefined;
  // Only a framework file that carries the chapter structure gives the section anything to show.
  const essentialsFramework = chapterFramework?.essentials ? chapterFramework : undefined;
  const essentials = essentialsFramework
    ? (() => {
        const result = essentialsResult(essentialsFramework, questions, answers);
        for (const id of [essentialsFramework.source, ...essentialsFramework.sources]) sourceIds.add(id);
        return {
          ...result,
          gaps: transitionGaps(result).map((g) => ({ ...g, strategyTitles: g.strategies.map(e8Title) })),
          priorityDomains: result.domains.filter((d) => d.type === "technical" && d.phases.includes(1)),
        };
      })()
    : undefined;
  const essentialsActions = new Set(essentialsFramework?.controls.map((c) => c.id));

  const used = new Set(questions.flatMap((q) => q.refs.map((r) => r.framework)));
  if (questions.some((q) => q.e8.length)) used.add(E8);

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
        return {
          platforms: platforms.map(({ id, name, rows, system }) => ({ id, name, rows, system })),
          jewels: jewelsDsl,
          unclassified: jewels.some((j) => !j.dsl),
        };
      })()
    : undefined;

  const frameworksUsed = [...used]
    .map((id) => catalogue.frameworks.get(id))
    .filter((f) => !!f)
    .map((f) => ({ name: f.name, publisher: f.publisher, role: roleOf(f) }))
    .sort((x, y) => Number(y.role === VENDOR_ROLE) - Number(x.role === VENDOR_ROLE) || x.name.localeCompare(y.name));
  if (essentialsFramework)
    frameworksUsed.push({ name: essentialsFramework.name, publisher: essentialsFramework.publisher, role: roleOf(essentialsFramework) });
  if (soc)
    frameworksUsed.push({
      name: `SOC-CMM® model v${soc.version} (domain and aspect structure)`,
      publisher: soc.source?.publisher ?? "SOC-CMM",
      role: "Structure for the optional SOC maturity self-assessment (indicative)",
    });
  if (aiRegister)
    for (const id of new Set(aiRegister.entries.flatMap((r) => r.questions.flatMap((q) => q.refs.map((x) => x.framework)))))
      if (!used.has(id)) {
        const f = catalogue.frameworks.get(id);
        if (f) frameworksUsed.push({ name: f.name, publisher: f.publisher, role: "Mapping for the optional AI use-case register's readiness questions" });
      }

  const ismBaseline = assessment.ismBaseline ? ismBaselineReport(catalogue, questions, answers, assessment.ismBaseline) : undefined;
  /** Scan evidence with at least one mapped check. */
  const evidenceOf = (q: Question) => {
    const evidence = assessment.evidence?.[q.id];
    return evidence?.checks.length ? evidence : undefined;
  };
  const licenceGap = (q: Question) => {
    const bundle = bundles.find((x) => x.questions.includes(q));
    if (!bundle) return [];
    const have = new Set(bundle.platform.licenceTiers.find((t) => t.id === assessment.licence[bundle.platform.id])?.features ?? []);
    return q.licence.filter((l) => !have.has(l)).map((l) => bundle.platform.licenceFeatures.find((f) => f.id === l)?.name ?? l);
  };
  const findingOf = (q: Question): Finding => ({
    question: q,
    answer: answers[q.id],
    licenceGap: licenceGap(q),
    note: assessment.notes[q.id]?.trim() || undefined,
    evidence: evidenceOf(q),
    refs: [
      ...q.refs.map((r) => `${frameworkName(r.framework)} ${r.ref}`),
      ...q.e8.map((t) => `E8 ${t.strategy} ML${t.level}`),
      ...q.essentials
        .filter((t) => essentialsActions.has(t.action))
        .map((t) => `Essentials ${t.action}${essentials?.framework.provisional ? " (provisional ID)" : ""} (${t.domains.join(", ")})`),
    ],
    ismBaseline: ismBaseline?.findings.find((f) => f.question.id === q.id)?.controls ?? [],
  });

  const domains = domainPosture(catalogue, assessment);
  const roadmap = buildRoadmap(questions, jewels, answers, platformOf);
  const assetTypeName = (id: string) => bundles.flatMap((x) => x.assetTypes).find((a) => a.id === id)?.name ?? id;

  return {
    header: headerOf(assessment, generatedAt),
    assessment,
    answers,
    strengths: {
      inPlace: questions.filter((q) => answers[q.id] === "yes").length,
      partial: questions.filter((q) => answers[q.id] === "partial").length,
      assessed: questions.filter((q) => answers[q.id] && answers[q.id] !== "na").length,
      passes: questions.filter((q) => answers[q.id] === "yes").sort(bySeverity),
      strongDomains: domains.filter((d) => d.score !== null && d.score >= 0.7).sort((x, y) => (y.score ?? 0) - (x.score ?? 0)),
      e8Reached: e8.filter((r) => (r.level ?? 0) >= 1),
    },
    focus: {
      highOrExtreme: risks.filter((r) => isHighRisk(r.band)).length,
      unknown: questions.filter((q) => (answers[q.id] ?? "unknown") === "unknown").length,
      quickWins: roadmap.filter((r) => r.phase === phases[0]).slice(0, 5),
    },
    frameworksUsed,
    licenceNames: bundles.map((x) => {
      const tier = x.platform.licenceTiers.find((t) => t.id === assessment.licence[x.platform.id]);
      return `${x.platform.name}: ${tier?.name ?? "not specified"}`;
    }),
    notApplicable: questions.filter((q) => answers[q.id] === "na").map((question) => ({ question, reason: assessment.notes[question.id].trim() })),
    sourcesLastChecked: SOURCES_LAST_CHECKED !== "unknown" ? SOURCES_LAST_CHECKED : undefined,
    platformNames: bundles.map((x) => x.platform.name),
    posture: overallPosture(catalogue, assessment),
    idcf,
    soc,
    aiRegister,
    risks: risks.map((r) => ({ ...r, assetTypeName: assetTypeName(r.jewel.assetType) })),
    domains,
    findings: domains
      .map((domain) => ({
        domain,
        items: questions.filter((q) => q.domain === domain.domain && platformOf(q) === domain.platform && isGap(answers[q.id])).map(findingOf),
      }))
      .filter((d) => d.items.length > 0),
    e8,
    roadmap,
    questions,
    csf,
    cis: refRows((framework) => framework.startsWith("cis-")),
    ism: refRows((framework) => framework === ISM),
    ismName: frameworkName(ISM),
    ismBaseline,
    essentials,
    imports: assessment.imports ?? [],
    scanEvidence: questions.flatMap((question) => {
      const evidence = evidenceOf(question);
      return evidence ? [{ question, evidence }] : [];
    }),
    sources: sourcesOf(catalogue, sourceIds),
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
    header: headerOf(assessment, generatedAt),
    aiRegister: aiRegisterOf(catalogue, assessment, aiModule.model, [], generatedAt),
    sources: sourcesOf(catalogue, aiRegisterSources(aiModule)),
  };
}
