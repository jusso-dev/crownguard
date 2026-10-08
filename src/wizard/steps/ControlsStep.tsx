import { catalogue } from "../../content/catalogue";
import type { Question } from "../../content/schema";
import { activeQuestions } from "../../engine/risk";
import { answerLabels, type Answer } from "../../engine/types";
import { useStore } from "../store";
import { Progress, SeverityBadge, StepHeader, inputClass } from "../ui";

const answerOrder: Answer[] = ["yes", "partial", "no", "unknown", "na"];

export function ControlsStep() {
  const assessment = useStore((s) => s.assessment);
  const questions = activeQuestions(catalogue, assessment);
  const groups = assessment.platforms.flatMap((pid) => {
    const bundle = catalogue.platforms.get(pid);
    if (!bundle) return [];
    return bundle.platform.domains
      .map((d) => ({ key: `${pid}:${d.id}`, platform: bundle.platform.name, domain: d, questions: questions.filter((q) => q.domain === d.id && bundle.questions.includes(q)) }))
      .filter((g) => g.questions.length > 0);
  });
  // The open section is saved with the assessment so you come back to where you left off.
  const active = useStore((s) => s.assessment.progress?.section);
  const setActive = useStore((s) => s.setSection);
  const group = groups.find((g) => g.key === active) ?? groups[0];
  const answered = questions.filter((q) => assessment.answers[q.id]).length;

  if (!group) return <StepHeader title="Controls">Add at least one crown jewel to see the relevant controls.</StepHeader>;
  const index = groups.indexOf(group);

  return (
    <>
      <StepHeader title="How well are they protected?">
        These questions come from Microsoft and Google security guidance, mapped to CIS Benchmarks, the ASD Essential
        Eight and NIST CSF 2.0. Only questions relevant to your crown jewels are shown. If you're not sure, answer
        <strong> Unknown</strong>: it counts as a gap, and the report flags it so someone can check.
      </StepHeader>
      <Progress value={questions.length ? answered / questions.length : 0} label={`${answered} of ${questions.length} answered`} />

      <div className="mt-6 flex flex-wrap gap-1.5">
        {groups.map((g) => {
          const done = g.questions.filter((q) => assessment.answers[q.id]).length;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActive(g.key)}
              className={`rounded-full border px-3 py-1 text-sm ${g.key === group.key ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40"}`}
            >
              {g.domain.name}
              <span className="ml-1.5 text-xs opacity-70">{done}/{g.questions.length}</span>
            </button>
          );
        })}
      </div>

      <section className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold">{group.platform}</p>
        <h2 className="text-xl font-semibold">{group.domain.name}</h2>
        <p className="mt-1 text-sm text-ink-soft">{group.domain.description}</p>
        <div className="mt-5 space-y-4">
          {group.questions.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}
        </div>
        {index < groups.length - 1 && (
          <button type="button" className="mt-5 text-sm font-medium text-gold hover:underline" onClick={() => { setActive(groups[index + 1].key); window.scrollTo({ top: 0 }); }}>
            Next section: {groups[index + 1].domain.name} →
          </button>
        )}
      </section>
    </>
  );
}

function QuestionCard({ q }: { q: Question }) {
  const { assessment, setAnswer, setNote } = useStore();
  const answer = assessment.answers[q.id];
  const platform = [...catalogue.platforms.values()].find((b) => b.questions.includes(q))!.platform;
  const tierFeatures = new Set(platform.licenceTiers.find((t) => t.id === assessment.licence[platform.id])?.features ?? []);
  const missing = q.licence.filter((l) => !tierFeatures.has(l)).map((l) => platform.licenceFeatures.find((f) => f.id === l)?.name ?? l);

  return (
    <article className="rounded-xl border border-line bg-white p-5" data-question={q.id}>
      <div className="flex items-center gap-2 text-xs text-ink-soft">
        <SeverityBadge severity={q.severity} />
        <span className="font-mono">{q.id}</span>
      </div>
      <h3 className="mt-2 text-[15px] font-medium leading-snug">{q.question}</h3>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.question}>
        {answerOrder.map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={answer === a}
            onClick={() => setAnswer(q.id, a)}
            className={`rounded-md border px-3 py-1.5 text-sm transition ${answer === a ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40"}`}
          >
            {answerLabels[a]}
          </button>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-ink-soft hover:text-ink">Why this matters and what good looks like</summary>
        <div className="mt-3 space-y-3 leading-relaxed">
          <p>{q.why}</p>
          <p><span className="font-medium">Yes looks like: </span>{q.yesLooksLike}</p>
          <p><span className="font-medium">How to fix: </span>{q.remediation}</p>
          {missing.length > 0 && (
            <p className="rounded bg-amber-50 px-3 py-2 text-amber-900">Needs {missing.join(", ")}, which your selected licence tier doesn't include.</p>
          )}
          <References q={q} />
          <textarea className={inputClass} rows={2} placeholder="Notes for the report (optional)" value={assessment.notes[q.id] ?? ""} onChange={(e) => setNote(q.id, e.target.value)} />
        </div>
      </details>
    </article>
  );
}

function References({ q }: { q: Question }) {
  return (
    <div className="text-xs text-ink-soft">
      <div className="flex flex-wrap gap-1.5">
        {q.refs.map((r) => (
          <span key={`${r.framework}:${r.ref}`} className="rounded bg-paper px-1.5 py-0.5 font-mono">
            {catalogue.frameworks.get(r.framework)?.shortName ?? r.framework} {r.ref}
          </span>
        ))}
        {q.e8.map((t) => (
          <span key={t.strategy} className="rounded bg-paper px-1.5 py-0.5 font-mono">
            E8 {catalogue.frameworks.get("essential-eight")?.controls.find((c) => c.id === t.strategy)?.title ?? t.strategy} ML{t.level}
          </span>
        ))}
      </div>
      <ul className="mt-2 space-y-0.5">
        {q.sources.map((s) => {
          const src = catalogue.sources.get(s);
          return src ? (
            <li key={s}>
              <a className="underline hover:text-ink" href={src.url} target="_blank" rel="noreferrer noopener">{src.title}</a> · {src.publisher}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}
