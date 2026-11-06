import { percent } from "../engine/percent";
import { needsReason } from "../engine/risk";
import type { Catalogue } from "../content/schema";
import type { ReportModel } from "../report/model";

/** Compact, JSON-serialisable score summary, with SOC, IDCF and AI register results when present. */
export function scoreSummary(model: ReportModel) {
  return {
    posture: model.posture,
    inPlace: model.strengths.inPlace,
    partial: model.strengths.partial,
    assessed: model.strengths.assessed,
    inScope: model.questions.length,
    unanswered: model.questions.filter((q) => !model.answers[q.id]).map((q) => q.id),
    naMissingReason: Object.keys(model.assessment.answers).filter((id) => needsReason(model.assessment, id)),
    risks: model.risks.map((r) => ({
      jewel: r.jewel.name,
      impact: r.impact,
      likelihood: r.likelihood,
      score: r.score,
      band: r.band,
      confidence: r.confidence,
      gaps: r.gaps.length,
    })),
    domains: model.domains,
    e8: model.e8.map((e) => ({
      strategy: e.strategy,
      title: e.title,
      level: e.level,
      ceiling: e.ceiling,
      blockers: e.blockers.map((q) => q.id),
      unasked: e.unasked,
    })),
    roadmap: model.roadmap.map((r) => ({
      id: r.question.id,
      severity: r.question.severity,
      effort: r.question.effort,
      phase: r.phase,
      reduction: r.reduction,
    })),
    ...(model.essentials
      ? {
          essentials: {
            framework: model.essentials.framework.id,
            chapter: model.essentials.chapter,
            release: model.essentials.framework.release,
            provisionalIds: model.essentials.framework.provisional,
            indicative: true,
            domains: model.essentials.domains.map((d) => ({
              id: d.id,
              name: d.name,
              type: d.type,
              phases: d.phases,
              percentage: d.percentage,
              counts: d.counts,
              principles: d.principles.map((p) => ({
                id: p.id,
                rating: p.rating,
                actions: p.actions.filter((a) => a.rating !== null).map((a) => ({ id: a.id, rating: a.rating, questions: a.evidence.map((x) => x.question.id) })),
              })),
            })),
            gaps: model.essentials.gaps.map((g) => ({ principle: g.principle, strategies: g.strategies, gapAnalysisFinding: g.gap })),
          },
        }
      : {}),
    ...(model.soc
      ? {
          soc: {
            overall: model.soc.result.overall,
            overallTarget: model.soc.result.overallTarget,
            confidence: model.soc.result.confidence,
            answered: model.soc.result.answered,
            total: model.soc.result.total,
            priorities: model.soc.result.priorities.map((p) => ({
              aspect: p.aspect.id,
              domain: p.domain,
              kind: p.kind,
              score: p.score,
              target: p.target,
              gap: p.gap,
            })),
            provider: model.soc.provider,
          },
        }
      : {}),
    ...(model.idcf
      ? {
          idcf: {
            platforms: model.idcf.platforms.map((p) => ({
              id: p.id,
              name: p.name,
              system: p.system.status,
              rows: p.rows.length,
            })),
            jewels: model.idcf.jewels.map((j) => ({
              name: j.jewel.name,
              dsl: j.jewel.dsl,
              gaps: j.gaps.map((q) => q.id),
              text: j.text,
            })),
          },
        }
      : {}),
    ...(model.aiRegister
      ? {
          aiRegister: {
            inScope: model.aiRegister.inScope,
            undetermined: model.aiRegister.undetermined,
            highRisk: model.aiRegister.highRisk,
            openGaps: model.aiRegister.openGaps,
            criticalGaps: model.aiRegister.criticalGaps,
            missingFields: model.aiRegister.missingFields,
            examples: model.aiRegister.examples,
            entries: model.aiRegister.entries.length,
            share: model.aiRegister.share,
          },
        }
      : {}),
  };
}

/** Short human summary for `cg score --format text`. */
export function scoreText(model: ReportModel): string {
  const s = scoreSummary(model);
  const posture = s.posture.score === null ? "n/a" : `${percent(s.posture.score)}%`;
  const lines = [
    `${model.assessment.org.name || "(unnamed)"} — posture ${posture} (confidence ${percent(s.posture.confidence)}%)`,
    `${s.inPlace} in place, ${s.partial} partial, ${s.assessed} assessed of ${s.inScope} in scope`,
    `Risks: ${s.risks.map((r) => `${r.jewel} ${r.band} (${r.score})`).join("; ") || "none"}`,
    `Essential Eight: ${s.e8.map((e) => `${e.strategy}=ML${e.level ?? "–"}`).join(", ") || "n/a"}`,
  ];
  if (s.essentials)
    lines.push(
      `Essentials (${s.essentials.chapter}, indicative): ${s.essentials.domains
        .map((d) => `${d.id}=${d.percentage === null ? "not assessed" : `${d.percentage}%`} (FE ${d.counts["fully-effective"]}, PE ${d.counts["partially-effective"]}, NE ${d.counts["not-effective"]}, NA ${d.counts["not-assessed"]})`)
        .join(", ")}`,
    );
  if (s.soc) lines.push(`SOC overall ${s.soc.overall ?? "n/a"} (target ${s.soc.overallTarget})`);
  if (s.aiRegister) lines.push(`AI register: ${s.aiRegister.entries} entries, ${s.aiRegister.openGaps} open gaps`);
  if (s.idcf) lines.push(`IDCF: ${s.idcf.jewels.length} jewel DSL checks across ${s.idcf.platforms.length} platform(s)`);
  return lines.join("\n");
}

/** JSON-serialisable catalogue view for `cg catalogue`. */
export function catalogueView(catalogue: Catalogue, platform?: string) {
  const bundles = platform
    ? ([catalogue.platforms.get(platform)].filter(Boolean) as NonNullable<ReturnType<Catalogue["platforms"]["get"]>>[])
    : [...catalogue.platforms.values()];
  return bundles.map((b) => ({
    platform: { id: b.platform.id, name: b.platform.name, modules: b.platform.modules },
    licenceTiers: b.platform.licenceTiers,
    licenceFeatures: b.platform.licenceFeatures,
    domains: b.platform.domains,
    assetTypes: b.assetTypes,
    questions: b.questions,
  }));
}
