import { catalogue } from "../../content/catalogue";
import { activeQuestions, assessAll, domainPosture, effectiveAnswers, needsReason, overallPosture, type JewelRisk } from "../../engine/risk";
import { essentialEight } from "../../engine/maturity";
import { levelFor, socMaturity } from "../../engine/soc";
import { answerLabels } from "../../engine/types";
import { modeOf, stepsFor, useStore } from "../store";
import { BandBadge, bandClasses, Card, StepHeader } from "../ui";
import { bandOf } from "../../engine/risk";
import { IsmBaselineCard, useIsmSummary } from "../IsmBaseline";
import { aiFieldLabels, aiRegisterSummary } from "../../engine/aiRegister";
import { ExampleBadge, Tile } from "./AiRegisterStep";

const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);

export function ReviewStep() {
  const assessment = useStore((s) => s.assessment);
  const setStep = useStore((s) => s.setStep);
  const ism = useIsmSummary();
  // The standalone register has no crown jewels to review: it gets the register's own summary instead.
  if (modeOf(assessment) === "ai-register") return <AiRegisterReview />;
  const risks = assessAll(catalogue, assessment);
  const posture = overallPosture(catalogue, assessment);
  const domains = domainPosture(catalogue, assessment);
  const questions = activeQuestions(catalogue, assessment);
  const answers = effectiveAnswers(assessment);
  const e8 = essentialEight(questions, answers).filter((r) => r.level !== null);
  const unanswered = questions.filter((q) => !answers[q.id]).length;
  const naWithoutReason = questions.filter((q) => needsReason(assessment, q.id)).length;

  return (
    <>
      <StepHeader title="Review your risk">
        Risk for each crown jewel is impact × likelihood on a 5×5 scale. Likelihood rises with unmet controls
        (weighted by severity), with each exposure you ticked, and is at least “possible” while any critical control is
        missing. Change answers in the previous step and this page updates.
      </StepHeader>

      {unanswered > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-warn/20 bg-warn-soft px-4 py-2.5 text-sm text-warn">
          <span>
            {unanswered} question{unanswered === 1 ? " is" : "s are"} unanswered and counted as gaps
            {naWithoutReason > 0 && ` (including ${naWithoutReason} N/A without a reason)`}.
          </span>
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => setStep(3)}>Go back to answer them</button>
        </div>
      )}

      {/* The page's one dark beat: the headline numbers. */}
      <div className="grid overflow-hidden rounded-[var(--radius-card)] bg-graphite text-on-graphite sm:grid-cols-3">
        <Stat label="Control posture" value={pct(posture.score)} hint="Severity-weighted controls in place" />
        <Stat label="Answer confidence" value={pct(posture.confidence)} hint="Share of answers that aren't Unknown" />
        <Stat label="High or extreme risks" value={String(risks.filter((r) => r.band === "High" || r.band === "Extreme").length)} hint={`of ${risks.length} crown jewels`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-4 text-base font-semibold">Risk heatmap</h2>
          <Heatmap risks={risks} />
        </Card>
        <Card className="overflow-x-auto">
          <h2 className="mb-4 text-base font-semibold">Crown jewels by risk</h2>
          <table className="w-full text-sm">
            <thead className="mono-label text-left text-muted [&_th]:whitespace-nowrap [&_th]:pb-2.5 [&_th]:pr-3 [&_th]:font-medium">
              <tr><th>Crown jewel</th><th>Impact</th><th>Likelihood</th><th>Risk</th><th>Open gaps</th></tr>
            </thead>
            <tbody className="divide-y divide-rule tabular-nums [&_td]:py-2.5 [&_td]:pr-3">
              {risks.map((r) => (
                <tr key={r.jewel.id}>
                  <td className="font-medium text-ink">{r.jewel.name}</td>
                  <td>{r.impact}</td>
                  <td>{r.likelihood}</td>
                  <td className="whitespace-nowrap"><BandBadge band={r.band} /> <span className="ml-1 font-mono text-xs text-muted">{r.score}/25</span></td>
                  <td>{r.gaps.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold">Posture by domain</h2>
          <ul className="space-y-2.5">
            {domains.map((d) => (
              <li key={`${d.platform}:${d.domain}`} className="text-sm">
                <div className="flex justify-between gap-3"><span className="text-ink">{d.name}</span><span className="font-mono text-xs tabular-nums text-muted">{pct(d.score)}</span></div>
                <div className="mt-1.5 h-1 rounded-full bg-rule"><div className="h-full rounded-full bg-ink-2" style={{ width: pct(d.score ?? 0) }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-1 text-base font-semibold">Essential Eight (indicative)</h2>
          <p className="mb-4 text-xs text-muted">Based only on the cloud-platform controls asked here, not a full ASD assessment.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-rule">
              {e8.map((r) => (
                <tr key={r.strategy}>
                  <td className="py-2 pr-3 text-ink">{catalogue.frameworks.get("essential-eight")?.controls.find((c) => c.id === r.strategy)?.title ?? r.strategy}</td>
                  <td className="text-right font-mono text-sm font-medium text-ink">ML{r.level}</td>
                  <td className="w-28 pl-3 text-right font-mono text-[0.6875rem] text-muted">of ML{r.ceiling} asked</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <IsmBaselineCard />
      <SocCard />
      <AiRegisterCard />

      {risks[0] && risks[0].gaps.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-4 text-base font-semibold">Biggest gaps for “{risks[0].jewel.name}”</h2>
          <ul className="space-y-3 text-sm">
            {risks[0].gaps.slice(0, 5).map((g) => (
              <li key={g.question.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <span className="pt-0.5 font-mono text-[0.6875rem] text-muted">{g.question.id}</span>
                <span className="text-ink">
                  {g.question.question} <span className="text-muted">({g.answer ? answerLabels[g.answer] : "Unanswered"})</span>
                  {ism?.findings.some((f) => f.question.id === g.question.id) && (
                    <span className="mono-label ml-2 rounded-[4px] bg-sunken px-1.5 py-0.5 text-muted">ISM {ism.label}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** The optional SOC maturity result, reported separately from crown-jewel risk. */
function SocCard() {
  const soc = useStore((s) => s.assessment.soc);
  const setStep = useStore((s) => s.setStep);
  const module = catalogue.soc;
  if (!soc || !module) return null;
  const r = socMaturity(module.model, module.questions, soc);
  const outOfScope = r.domains.reduce((n, d) => n + d.aspects.filter((a) => !a.inScope).length, 0);
  return (
    <Card className="mt-4" data-testid="soc-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">SOC maturity (indicative)</h2>
        <button type="button" className="text-sm font-medium text-accent underline underline-offset-2" onClick={() => setStep(4)}>
          Edit SOC answers
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {r.answered} of {r.total} answered{r.unknown ? `, ${r.unknown} unknown (scored 0)` : ""}
        {outOfScope ? `, ${outOfScope} aspect${outOfScope === 1 ? "" : "s"} left out of scoring` : ""}. Reported separately; it doesn&apos;t change the risk ratings.
      </p>
      <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-5">
        {r.domains.map((d) => (
          <li key={d.id} className="text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-ink">{d.name}</span>
              <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted">{d.maturity === null ? "not assessed" : `${d.maturity.toFixed(1)} of 5`}</span>
            </div>
            <div
              className="relative mt-1.5 h-1 rounded-full bg-rule"
              role="img"
              aria-label={d.maturity === null ? `${d.name}: not assessed` : `${d.name}: maturity ${d.maturity.toFixed(1)} of 5, target ${d.target.maturity.toFixed(1)}`}
            >
              <div className="h-full rounded-full bg-ink-2" style={{ width: `${((d.maturity ?? 0) / 5) * 100}%` }} />
              <div className="absolute -top-0.5 h-2 w-px bg-accent" style={{ left: `${(d.target.maturity / 5) * 100}%` }} />
            </div>
            <div className="mt-1 text-xs text-muted">
              {d.maturity !== null && `${levelFor(module.model.scales.maturity, d.maturity).name} · `}target {d.target.maturity.toFixed(1)}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The optional AI use-case register: readiness per use case, reported apart from crown-jewel risk. */
function AiRegisterCard() {
  const assessment = useStore((s) => s.assessment);
  const setStep = useStore((s) => s.setStep);
  if (!assessment.aiRegister || !catalogue.aiRegister) return null;
  const summary = aiRegisterSummary(catalogue, assessment, assessAll(catalogue, assessment));
  return (
    <Card className="mt-4" data-testid="ai-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">AI use-case register</h2>
        <button type="button" className="text-sm font-medium text-accent underline underline-offset-2" onClick={() => setStep(5)}>
          Edit AI register
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {summary.entries.length} use case{summary.entries.length === 1 ? "" : "s"}, {summary.inScope} in scope of the policy, {summary.openGaps} open readiness gap
        {summary.openGaps === 1 ? "" : "s"} ({summary.criticalGaps} critical), {summary.missingFields} register field{summary.missingFields === 1 ? "" : "s"} missing.
        Readiness doesn&apos;t change the risk ratings; exposures you tick on linked crown jewels do.
      </p>
      {summary.entries.length > 0 && (
        <ul className="mt-4 space-y-3">
          {summary.entries.map((r) => (
            <li key={r.entry.id} className="text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="flex items-center gap-2 text-ink">
                  {r.entry.example && <ExampleBadge />}
                  {r.entry.name || "Unnamed use case"}
                </span>
                <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted">
                  {pct(r.score)} ready · {r.gaps.length} gap{r.gaps.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-rule" role="img" aria-label={`${r.entry.name}: readiness ${pct(r.score)}`}>
                <div className="h-full rounded-full bg-ink-2" style={{ width: pct(r.score ?? 0) }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The standalone AI register's review step: the register's summary tiles and its open gaps, nothing about crown jewels. */
function AiRegisterReview() {
  const assessment = useStore((s) => s.assessment);
  const setStep = useStore((s) => s.setStep);
  const module = catalogue.aiRegister;
  const summary = module ? aiRegisterSummary(catalogue, assessment) : undefined;
  const registerStep = stepsFor("ai-register").indexOf("AI register");
  return (
    <>
      <StepHeader title="Review your register">
        Everything you&apos;ve recorded so far, and what&apos;s left to fill in. Readiness is an indicative self-check
        against the policy, not a DTA assessment. Change anything on the AI register step and this page updates.
      </StepHeader>

      {summary && (
        <>
          <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface sm:grid-cols-4" data-testid="ai-review-summary">
            <Tile label="Use cases" value={String(summary.entries.length)} hint={summary.undetermined ? `${summary.undetermined} not yet checked for scope` : "all checked for scope"} />
            <Tile label="In scope of the policy" value={String(summary.inScope)} hint={`${summary.highRisk} with a high inherent risk`} />
            <Tile label="Open readiness gaps" value={String(summary.openGaps)} hint={`${summary.criticalGaps} critical`} />
            <Tile label="Register fields missing" value={String(summary.missingFields)} hint="across all use cases" />
          </div>

          <Card className="mt-4" data-testid="ai-review-gaps">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold">Open gaps</h2>
              <button type="button" className="text-sm font-medium text-accent underline underline-offset-2" onClick={() => setStep(registerStep)}>
                Edit the register
              </button>
            </div>
            {summary.entries.length === 0 && <p className="mt-3 text-sm text-muted">No use cases recorded yet.</p>}
            <ul className="mt-4 space-y-5">
              {summary.entries.map((r) =>
                r.gaps.length === 0 && r.missing.length === 0 ? null : (
                  <li key={r.entry.id} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {r.entry.example && <ExampleBadge />}
                      <span className="font-medium text-ink">{r.entry.name || "Unnamed use case"}</span>
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {r.gaps.length} open {r.gaps.length === 1 ? "gap" : "gaps"}
                        {r.missing.length ? ` · ${r.missing.length} register field${r.missing.length === 1 ? "" : "s"} missing` : ""}
                      </span>
                    </div>
                    {r.gaps.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {r.gaps.map((g) => (
                          <li key={g.question.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                            <span className="pt-0.5 font-mono text-[0.6875rem] text-muted">{g.question.id}</span>
                            <span className="text-ink">
                              {g.question.question} <span className="text-muted">({g.answer ? answerLabels[g.answer] : "Unanswered"})</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.missing.length > 0 && (
                      <p className="mt-2 text-ink-2">Register fields still to fill in: {r.missing.map((f) => aiFieldLabels[f]).join(" · ")}.</p>
                    )}
                  </li>
                ),
              )}
              {summary.entries.every((r) => r.gaps.length === 0 && r.missing.length === 0) && summary.entries.length > 0 && (
                <li className="text-sm text-ink-2">Nothing open: every readiness question is answered and every register field is filled in.</li>
              )}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-graphite-2 p-5 not-first:border-t sm:not-first:border-t-0 sm:not-first:border-l">
      <div className="mono-label text-on-graphite-2">{label}</div>
      <div className="mt-2 font-display text-[2.25rem] font-semibold leading-none tracking-[-0.03em] tabular-nums text-on-graphite">{value}</div>
      {hint && <div className="mt-2 text-xs text-on-graphite-2">{hint}</div>}
    </div>
  );
}

function Heatmap({ risks }: { risks: JewelRisk[] }) {
  return (
    <div className="inline-grid grid-cols-[auto_repeat(5,2.75rem)] gap-1 font-mono text-[0.6875rem]">
      {[5, 4, 3, 2, 1].map((impact) => (
        <div key={impact} className="contents">
          <div className="pr-1.5 text-right leading-[2.75rem] text-muted">{impact}</div>
          {[1, 2, 3, 4, 5].map((likelihood) => {
            const here = risks.filter((r) => r.impact === impact && r.likelihood === likelihood);
            return (
              <div
                key={likelihood}
                title={here.map((r) => r.jewel.name).join(", ")}
                className={`grid h-11 place-items-center rounded-[4px] text-sm font-medium ${bandClasses[bandOf(impact * likelihood)]}`}
              >
                {here.length || ""}
              </div>
            );
          })}
        </div>
      ))}
      <div />
      {[1, 2, 3, 4, 5].map((l) => <div key={l} className="pt-1 text-center text-muted">{l}</div>)}
      <div />
      <div className="col-span-5 pt-1 text-center text-muted">Likelihood → · rows: impact</div>
    </div>
  );
}
