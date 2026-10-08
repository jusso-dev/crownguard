import { catalogue } from "../../content/catalogue";
import { activeQuestions, assessAll, domainPosture, overallPosture, type JewelRisk } from "../../engine/risk";
import { essentialEight } from "../../engine/maturity";
import { answerLabels } from "../../engine/types";
import { useStore } from "../store";
import { BandBadge, bandColors, Card, StepHeader } from "../ui";
import { bandOf } from "../../engine/risk";

const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);

export function ReviewStep() {
  const assessment = useStore((s) => s.assessment);
  const setStep = useStore((s) => s.setStep);
  const risks = assessAll(catalogue, assessment);
  const posture = overallPosture(catalogue, assessment);
  const domains = domainPosture(catalogue, assessment);
  const questions = activeQuestions(catalogue, assessment);
  const e8 = essentialEight(questions, assessment.answers).filter((r) => r.level !== null);
  const unanswered = questions.filter((q) => !assessment.answers[q.id]).length;

  return (
    <>
      <StepHeader title="Review your risk">
        Risk for each crown jewel is impact × likelihood on a 5×5 scale. Likelihood rises with unmet controls
        (weighted by severity), with each exposure you ticked, and is at least “possible” while any critical control is
        missing. Change answers in the previous step and this page updates.
      </StepHeader>

      {unanswered > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {unanswered} question{unanswered === 1 ? " is" : "s are"} unanswered and counted as gaps.{" "}
          <button type="button" className="font-medium underline" onClick={() => setStep(3)}>Go back to answer them</button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Control posture" value={pct(posture.score)} />
        <Stat label="Answer confidence" value={pct(posture.confidence)} hint="Share of answers that aren't Unknown" />
        <Stat label="High or extreme risks" value={String(risks.filter((r) => r.band === "High" || r.band === "Extreme").length)} hint={`of ${risks.length} crown jewels`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[auto_1fr]">
        <Card>
          <h2 className="mb-3 font-semibold">Risk heatmap</h2>
          <Heatmap risks={risks} />
        </Card>
        <Card className="overflow-x-auto">
          <h2 className="mb-3 font-semibold">Crown jewels by risk</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-soft [&_th]:pb-2 [&_th]:pr-3 [&_th]:font-medium">
              <tr><th>Crown jewel</th><th>Impact</th><th>Likelihood</th><th>Risk</th><th>Open gaps</th></tr>
            </thead>
            <tbody className="divide-y divide-line [&_td]:pr-3">
              {risks.map((r) => (
                <tr key={r.jewel.id}>
                  <td className="py-2 pr-3 font-medium">{r.jewel.name}</td>
                  <td>{r.impact}</td>
                  <td>{r.likelihood}</td>
                  <td className="whitespace-nowrap"><BandBadge band={r.band} /> <span className="text-ink-soft">{r.score}</span></td>
                  <td>{r.gaps.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Posture by domain</h2>
          <ul className="space-y-2.5">
            {domains.map((d) => (
              <li key={`${d.platform}:${d.domain}`} className="text-sm">
                <div className="flex justify-between"><span>{d.name}</span><span className="text-ink-soft">{pct(d.score)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-line"><div className="h-full rounded-full bg-ink" style={{ width: pct(d.score ?? 0) }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">Essential Eight (indicative)</h2>
          <p className="mb-3 text-xs text-ink-soft">Based only on the cloud-platform controls asked here, not a full ASD assessment.</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {e8.map((r) => (
                <tr key={r.strategy}>
                  <td className="py-1.5">{catalogue.frameworks.get("essential-eight")?.controls.find((c) => c.id === r.strategy)?.title ?? r.strategy}</td>
                  <td className="text-right font-medium">ML{r.level}</td>
                  <td className="w-24 text-right text-xs text-ink-soft">of ML{r.ceiling} asked</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {risks[0] && risks[0].gaps.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Biggest gaps for “{risks[0].jewel.name}”</h2>
          <ul className="space-y-2 text-sm">
            {risks[0].gaps.slice(0, 5).map((g) => (
              <li key={g.question.id}>
                <span className="font-mono text-xs text-ink-soft">{g.question.id}</span> {g.question.question}{" "}
                <span className="text-ink-soft">({g.answer ? answerLabels[g.answer] : "Unanswered"})</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="text-xs font-medium uppercase tracking-wider text-ink-soft">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-soft">{hint}</div>}
    </Card>
  );
}

function Heatmap({ risks }: { risks: JewelRisk[] }) {
  return (
    <div className="inline-grid grid-cols-[auto_repeat(5,2.75rem)] gap-1 text-xs">
      {[5, 4, 3, 2, 1].map((impact) => (
        <div key={impact} className="contents">
          <div className="pr-1.5 text-right leading-[2.75rem] text-ink-soft">{impact}</div>
          {[1, 2, 3, 4, 5].map((likelihood) => {
            const here = risks.filter((r) => r.impact === impact && r.likelihood === likelihood);
            const c = bandColors[bandOf(impact * likelihood)];
            return (
              <div
                key={likelihood}
                title={here.map((r) => r.jewel.name).join(", ")}
                className="grid h-11 place-items-center rounded font-semibold"
                style={{ background: c.bg, color: c.fg }}
              >
                {here.length || ""}
              </div>
            );
          })}
        </div>
      ))}
      <div />
      {[1, 2, 3, 4, 5].map((l) => <div key={l} className="text-center text-ink-soft">{l}</div>)}
      <div />
      <div className="col-span-5 text-center text-ink-soft">Likelihood →  ·  ↑ Impact</div>
    </div>
  );
}
