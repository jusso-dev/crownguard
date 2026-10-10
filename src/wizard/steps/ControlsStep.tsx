import { catalogue } from "../../content/catalogue";
import type { Question } from "../../content/schema";
import { activeQuestions, effectiveAnswers, needsReason } from "../../engine/risk";
import { answerLabels, type Answer, type Evidence } from "../../engine/types";
import { NOTE_MAX } from "../assessmentSchema";
import { scrollToFoundApps } from "../FoundApps";
import { steps, useStore } from "../store";
import { Button, Progress, SeverityBadge, StepHeader, inputClass, radioKeys, radioTab } from "../ui";
import { ScanImport, stamp, statusStyle } from "../ScanImport";

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
  const answers = effectiveAnswers(assessment);
  const answered = questions.filter((q) => answers[q.id]).length;

  if (!group) return <StepHeader title="Controls">Add at least one crown jewel to see the relevant controls.</StepHeader>;
  const index = groups.indexOf(group);

  return (
    <>
      <StepHeader title="How well are they protected?">
        These questions come from Microsoft, Google and AWS security guidance, mapped to CIS Benchmarks, the ASD Essential
        Eight, NIST CSF 2.0 and the IDCF. Only questions relevant to your crown jewels are shown. If you're not sure, answer
        <strong> Unknown</strong>: it counts as a gap, and the report flags it so someone can check.
      </StepHeader>
      <Progress value={questions.length ? answered / questions.length : 0} label={`${answered} of ${questions.length} answered`} />
      <ScanImport />

      <nav className="mt-8 flex flex-wrap gap-x-1 border-b border-rule" aria-label="Control sections">
        {groups.map((g) => {
          const done = g.questions.filter((q) => answers[q.id]).length;
          const selected = g.key === group.key;
          const complete = done === g.questions.length;
          return (
            <button
              key={g.key}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => setActive(g.key)}
              className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm transition-colors duration-150 ${
                selected ? "border-accent font-medium text-ink" : "border-transparent text-muted [@media(hover:hover)]:hover:border-rule-2 [@media(hover:hover)]:hover:text-ink"
              }`}
            >
              {g.domain.name}
              <span className={`font-mono text-[0.6875rem] tabular-nums ${complete ? "text-ok" : selected ? "text-accent" : "text-muted"}`}>
                {done}/{g.questions.length}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="mt-8">
        <p className="mono-label text-muted">{group.platform}</p>
        <h2 className="mt-1.5 text-[1.375rem] font-semibold leading-tight">{group.domain.name}</h2>
        <p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">{group.domain.description}</p>
        {["apps-consent", "oauth-apps"].includes(group.domain.id) && (
          <p className="mt-3 max-w-[68ch] rounded-[var(--radius-control)] border border-rule bg-surface px-4 py-2.5 text-sm text-ink-2" data-testid="found-apps-link">
            Looking for AI tools people have already connected? The AI register step has a &ldquo;Found apps&rdquo; panel that reads an app consent
            export and lists the AI assistants, note-takers and agents in it.{" "}
            <button
              type="button"
              className="font-medium text-accent underline decoration-accent/30 underline-offset-2"
              onClick={() => {
                useStore.getState().setStep(steps.indexOf("AI register"));
                scrollToFoundApps();
              }}
            >
              Find the apps people have connected →
            </button>
          </p>
        )}
        <div className="mt-6 space-y-3">
          {group.questions.map((q) => (
            <QuestionCard key={q.id} q={q} />
          ))}
        </div>
        {index < groups.length - 1 && (
          <Button variant="secondary" className="mt-6" onClick={() => { setActive(groups[index + 1].key); window.scrollTo({ top: 0 }); }}>
            Next section: {groups[index + 1].domain.name} →
          </Button>
        )}
      </section>
    </>
  );
}

function QuestionCard({ q }: { q: Question }) {
  const { assessment, setAnswer, setNote } = useStore();
  const answer = assessment.answers[q.id];
  const missingReason = needsReason(assessment, q.id);
  const evidence = assessment.evidence?.[q.id];
  const reasonId = `${q.id}-na-reason`;
  const platform = [...catalogue.platforms.values()].find((b) => b.questions.includes(q))!.platform;
  const tierFeatures = new Set(platform.licenceTiers.find((t) => t.id === assessment.licence[platform.id])?.features ?? []);
  const missing = q.licence.filter((l) => !tierFeatures.has(l)).map((l) => platform.licenceFeatures.find((f) => f.id === l)?.name ?? l);

  return (
    <article className="rounded-[var(--radius-card)] border border-rule bg-surface p-5 sm:p-6" data-question={q.id}>
      <div className="flex items-center gap-2.5">
        <SeverityBadge severity={q.severity} />
        <span className="font-mono text-[0.6875rem] text-muted">{q.id}</span>
        {answer && !missingReason && <span className="ml-auto font-mono text-[0.6875rem] text-ok" aria-hidden>✓ answered</span>}
        {missingReason && <span className="ml-auto font-mono text-[0.6875rem] text-warn" aria-hidden>reason needed</span>}
      </div>
      <h3 className="mt-3 font-sans text-base font-medium leading-snug tracking-normal">{q.question}</h3>
      <div
        className="mt-4 grid max-w-md grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-control)] border border-field bg-field"
        role="radiogroup"
        aria-label={q.question}
        onKeyDown={radioKeys}
      >
        {answerOrder.map((a, i) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={answer === a}
            tabIndex={radioTab(answer === a, i, answer !== undefined)}
            onClick={() => setAnswer(q.id, a)}
            className={`min-h-9 px-1 py-1.5 text-[0.8125rem] transition-colors duration-150 focus-visible:-outline-offset-2 sm:px-3 sm:text-sm ${
              answer === a ? "bg-ink font-medium text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink"
            }`}
          >
            {answerLabels[a]}
          </button>
        ))}
      </div>
      {evidence && <EvidencePanel evidence={evidence} answer={answer} />}
      {answer === "na" && (
        <div className="mt-4 max-w-[72ch]">
          <label htmlFor={reasonId} className="text-sm font-medium text-ink">
            Why doesn't this apply? <span className="font-normal text-muted">(required)</span>
          </label>
          <textarea
            id={reasonId}
            rows={2}
            required
            aria-required="true"
            aria-invalid={missingReason}
            aria-describedby={`${reasonId}-help`}
            className={`${inputClass} mt-1.5 ${missingReason ? "border-warn!" : ""}`}
            placeholder="e.g. No on-premises Active Directory; we are cloud-only."
            value={assessment.notes[q.id] ?? ""}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(q.id, e.target.value)}
          />
          <p id={`${reasonId}-help`} className={`mt-1 text-xs ${missingReason ? "text-warn" : "text-muted"}`}>
            {missingReason
              ? "Until you give a reason this counts as unanswered and is scored as a gap."
              : "Shown in the report's list of controls marked not applicable."}
          </p>
        </div>
      )}
      <details className="group mt-4 border-t border-rule pt-3 text-sm">
        <summary className="text-muted transition-colors [@media(hover:hover)]:hover:text-ink">Why this matters and what good looks like</summary>
        <div className="mt-4 max-w-[72ch] space-y-3 leading-relaxed text-ink-2">
          <p>{q.why}</p>
          <p><span className="font-medium text-ink">Yes looks like: </span>{q.yesLooksLike}</p>
          <p><span className="font-medium text-ink">How to fix: </span>{q.remediation}</p>
          {missing.length > 0 && (
            <p className="rounded-[var(--radius-control)] border border-warn/20 bg-warn-soft px-3 py-2 text-warn">Needs {missing.join(", ")}, which your selected licence tier doesn't include.</p>
          )}
          <References q={q} />
          {answer !== "na" && (
            <textarea className={inputClass} rows={2} maxLength={NOTE_MAX} aria-label={`Notes for the report on ${q.id}`} placeholder="Notes for the report (optional)" value={assessment.notes[q.id] ?? ""} onChange={(e) => setNote(q.id, e.target.value)} />
          )}
        </div>
      </details>
    </article>
  );
}

function EvidencePanel({ evidence, answer }: { evidence: Evidence; answer: Answer | undefined }) {
  const tally = Object.entries(
    evidence.checks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {}),
  )
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  return (
    <details className="mt-3 rounded-[var(--radius-control)] border border-rule bg-paper px-3 py-2 text-sm" data-testid="evidence">
      <summary className="text-ink-2">
        <span className="mono-label mr-2 text-muted">Scan evidence</span>
        {evidence.suggested
          ? answer && answer !== evidence.suggested
            ? `You changed this from the scan's ${answerLabels[evidence.suggested]}`
            : `${evidence.source} suggests ${answerLabels[evidence.suggested]}`
          : `${evidence.source} couldn't decide; check this one yourself`}
        <span className="text-muted"> · {tally}</span>
      </summary>
      <p className="mt-2 text-xs text-muted">
        {evidence.tenant}, scanned {stamp(evidence.scannedAt)}
      </p>
      <ul className="mt-2 space-y-2">
        {evidence.checks.map((c, i) => (
          <li key={`${c.id}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
            <span className={`mono-label self-start rounded-[4px] px-1.5 py-0.5 ${statusStyle[c.status]}`}>{c.status}</span>
            <span className="text-ink">
              {c.setting || c.id} <span className="font-mono text-[0.6875rem] text-muted">{c.id}</span>
            </span>
            {(c.current || c.expected) && (
              <span className="col-start-2 text-xs text-muted">
                {c.current && <>Found: {c.current}</>}
                {c.current && c.expected && " · "}
                {c.expected && <>Expected: {c.expected}</>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

function References({ q }: { q: Question }) {
  return (
    <div className="text-xs text-muted">
      <div className="flex flex-wrap gap-1.5">
        {q.refs.map((r) => (
          <span key={`${r.framework}:${r.ref}`} className="rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">
            {catalogue.frameworks.get(r.framework)?.shortName ?? r.framework} {r.ref}
          </span>
        ))}
        {q.e8.map((t) => (
          <span key={t.strategy} className="rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">
            E8 {catalogue.frameworks.get("essential-eight")?.controls.find((c) => c.id === t.strategy)?.title ?? t.strategy} ML{t.level}
          </span>
        ))}
      </div>
      <ul className="mt-2 space-y-0.5">
        {q.sources.map((s) => {
          const src = catalogue.sources.get(s);
          return src ? (
            <li key={s}>
              <a className="text-accent underline decoration-accent/30 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent" href={src.url} target="_blank" rel="noreferrer noopener">{src.title}</a> · {src.publisher}
            </li>
          ) : null;
        })}
      </ul>
    </div>
  );
}
