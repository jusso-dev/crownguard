import { useRef, useState } from "react";
import { catalogue } from "../../content/catalogue";
import type { SocQuestion } from "../../content/schema";
import { isRating, levelFor, socMaturity, socProviders, type SocAnswer, type SocProvider } from "../../engine/soc";
import { NOTE_MAX } from "../assessmentSchema";
import { useStore } from "../store";
import { Button, Card, FieldGroup, Progress, StepHeader, focusHeading, inputClass, radioKeys, radioTab } from "../ui";

const fmt = (n: number | null) => (n === null ? "–" : n.toFixed(1));
const halves = (from: number, to: number) => Array.from({ length: (to - from) * 2 + 1 }, (_, i) => from + i / 2);

export function SocStep() {
  const assessment = useStore((s) => s.assessment);
  const setSocIncluded = useStore((s) => s.setSocIncluded);
  const active = useStore((s) => s.assessment.progress?.socSection);
  const setActive = useStore((s) => s.setSocSection);
  const heading = useRef<HTMLHeadingElement>(null);
  const module = catalogue.soc;

  if (!module) return <StepHeader title="How mature are your security operations?">This build of crownguard doesn't include the SOC maturity questions.</StepHeader>;
  const { model, questions } = module;
  const aspects = model.domains.reduce((n, d) => n + d.aspects.length, 0);

  const intro = (
    <StepHeader title="How mature are your security operations?" step="Optional">
      If you have a security operations centre (SOC), in house or through a managed provider, rate how mature it is across
      the five domains of the SOC-CMM® v2.4 model: business, people, process, technology and services. This is a short,
      indicative self-assessment aligned to that model, not a SOC-CMM assessment. The results get their own section in the
      report and don&apos;t change your crown-jewel risk ratings.
    </StepHeader>
  );

  if (!assessment.soc)
    return (
      <>
        {intro}
        <Card>
          <p className="max-w-[68ch] text-sm leading-relaxed text-ink-2">
            {questions.length} questions on {aspects} aspects in {model.domains.length} domains, about 30 to 45 minutes. Each
            question describes what each level looks like, so you choose the description that best matches today. Skip this step
            if you don&apos;t have a SOC or a managed detection and response service.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setSocIncluded(true);
              // The button goes away: move focus to the first question of the step.
              requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-soc-provider] [role="radio"][tabindex="0"]')?.focus());
            }}
          >
            Include SOC maturity in this report
          </Button>
        </Card>
        <Attribution />
      </>
    );

  const soc = assessment.soc;
  const result = socMaturity(model, questions, soc);
  const domain = model.domains.find((d) => d.id === active) ?? model.domains[0];
  const index = model.domains.indexOf(domain);
  const domainResult = result.domains[index];

  return (
    <>
      {intro}
      <Provider value={soc.provider} />
      <Targets />

      <div className="mt-8">
        <Progress value={result.total ? result.answered / result.total : 0} label={`${result.answered} of ${result.total} answered`} />
      </div>

      <nav className="mt-8 flex flex-wrap gap-x-1 border-b border-rule" aria-label="SOC maturity domains">
        {result.domains.map((d) => {
          const total = d.aspects.reduce((n, a) => n + (a.inScope ? a.total : 0), 0);
          const done = d.aspects.reduce((n, a) => n + (a.inScope ? a.answered : 0), 0);
          const selected = d.id === domain.id;
          return (
            <button
              key={d.id}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => setActive(d.id)}
              className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm transition-colors duration-150 ${
                selected ? "border-accent font-medium text-ink" : "border-transparent text-muted [@media(hover:hover)]:hover:border-rule-2 [@media(hover:hover)]:hover:text-ink"
              }`}
            >
              {d.name}
              <span className={`font-mono text-[0.6875rem] tabular-nums ${done === total ? "text-ok" : selected ? "text-accent" : "text-muted"}`}>
                {done}/{total}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 ref={heading} tabIndex={-1} className="text-[1.375rem] font-semibold leading-tight outline-none">
            {domain.name}
          </h2>
          <p className="font-mono text-xs tabular-nums text-muted">
            Maturity {fmt(domainResult.maturity)} of 5 · target {domainResult.target.maturity.toFixed(1)}
            {domain.capability && ` · capability ${fmt(domainResult.capability)} of 3 · target ${domainResult.target.capability!.toFixed(1)}`}
          </p>
        </div>
        <p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">{domain.description}</p>
        {domain.scopable && (
          <p className="mt-1.5 max-w-[68ch] text-sm text-muted">
            Leave an aspect out of scoring only when your organisation genuinely doesn&apos;t need it. If you need it but don&apos;t have it, rate it 0.
          </p>
        )}
        {domainResult.aspects.map((aspect) => (
          <div key={aspect.id} className="mt-8" data-aspect={aspect.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-sans text-base font-semibold tracking-normal">{aspect.name}</h3>
              {domain.scopable && (
                <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--color-accent)]"
                    aria-label={`${aspect.name}: not needed here (leave out of scoring)`}
                    checked={!aspect.inScope}
                    onChange={(e) => useStore.getState().setSocScope(aspect.id, !e.target.checked)}
                  />
                  Not needed here (leave out of scoring)
                </label>
              )}
            </div>
            {aspect.inScope ? (
              <div className="mt-3 space-y-3">
                {questions
                  .filter((q) => q.aspect === aspect.id)
                  .map((q) => (
                    <SocQuestionCard key={q.id} q={q} />
                  ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">Left out of scoring and out of the {domain.name.toLowerCase()} score.</p>
            )}
          </div>
        ))}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          {index < model.domains.length - 1 && (
            <Button
              variant="secondary"
              onClick={() => {
                setActive(model.domains[index + 1].id);
                // Start the next domain at its heading, for keyboard and screen-reader users too.
                focusHeading(heading);
              }}
            >
              Next domain: {model.domains[index + 1].name} →
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm("Remove the SOC maturity answers from this assessment?")) setSocIncluded(false);
            }}
          >
            Remove SOC maturity
          </Button>
        </div>
      </section>
      <Attribution />
    </>
  );
}

function Provider({ value }: { value: SocProvider | undefined }) {
  const setSocProvider = useStore((s) => s.setSocProvider);
  return (
    <Card>
      <FieldGroup label="Who runs your security operations?" hint="Answer for the service you actually receive. With a provider, its contract, service description and reports are your evidence.">
        <div role="radiogroup" aria-label="Who runs your security operations?" className="flex flex-wrap gap-2" data-soc-provider onKeyDown={radioKeys}>
          {(Object.keys(socProviders) as SocProvider[]).map((p, i) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={value === p}
              tabIndex={radioTab(value === p, i, value !== undefined)}
              onClick={() => setSocProvider(p)}
              className={`min-h-9 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm transition-colors duration-150 ${
                value === p ? "border-ink bg-ink font-medium text-paper" : "border-rule-2 bg-surface text-ink-2 [@media(hover:hover)]:hover:border-ink/45 [@media(hover:hover)]:hover:text-ink"
              }`}
            >
              {socProviders[p]}
            </button>
          ))}
        </div>
      </FieldGroup>
      {value === "none" && (
        <p className="mt-3 max-w-[68ch] text-sm text-ink-2">
          Without a SOC most aspects will rate low. That is still a useful baseline for a business case, or you can remove this section below.
        </p>
      )}
    </Card>
  );
}

/** Target levels per domain: SOC-CMM's defaults (maturity 3, capability 2) unless the organisation sets its own. */
function Targets() {
  const model = catalogue.soc!.model;
  const targets = useStore((s) => s.assessment.soc?.targets);
  const setSocTarget = useStore((s) => s.setSocTarget);
  const changed = model.domains.some((d) => targets?.[d.id]?.maturity !== undefined || targets?.[d.id]?.capability !== undefined);
  // Open at first when the targets were changed; after that the user decides (resetting the last one doesn't close it).
  const [open, setOpen] = useState(changed);
  const select = (domain: string, kind: "maturity" | "capability", max: number, label: string) => {
    const fallback = model.targets[kind];
    return (
      <select
        aria-label={label}
        className={`${inputClass} w-24`}
        value={targets?.[domain]?.[kind] ?? fallback}
        onChange={(e) => {
          const v = Number(e.target.value);
          setSocTarget(domain, kind, v === fallback ? undefined : v);
        }}
      >
        {halves(1, max).map((v) => (
          <option key={v} value={v}>
            {v.toFixed(1)}
          </option>
        ))}
      </select>
    );
  };
  return (
    <details className="mt-4 rounded-[var(--radius-card)] border border-rule bg-surface px-5 py-3 text-sm" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-ink-2 transition-colors [@media(hover:hover)]:hover:text-ink">
        Targets: maturity {model.targets.maturity} in every domain and capability {model.targets.capability} for technology and services
        {changed ? " (changed)" : ""}
      </summary>
      <p className="mt-3 max-w-[68ch] text-ink-2">
        These are SOC-CMM&apos;s default targets, a common baseline for a SOC that runs consistently. Set your own where the business
        needs more or less.
      </p>
      <table className="mt-3 text-sm">
        <thead className="mono-label text-left text-muted [&_th]:pb-2 [&_th]:pr-4 [&_th]:font-medium">
          <tr>
            <th>Domain</th>
            <th>Maturity (1–5)</th>
            <th>Capability (1–3)</th>
          </tr>
        </thead>
        <tbody className="[&_td]:py-1 [&_td]:pr-4">
          {model.domains.map((d) => (
            <tr key={d.id}>
              <td className="text-ink">{d.name}</td>
              <td>{select(d.id, "maturity", 5, `${d.name} maturity target`)}</td>
              <td>{d.capability ? select(d.id, "capability", 3, `${d.name} capability target`) : <span className="text-muted">–</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function SocQuestionCard({ q }: { q: SocQuestion }) {
  const soc = useStore((s) => s.assessment.soc);
  const setSocAnswer = useStore((s) => s.setSocAnswer);
  const setSocNote = useStore((s) => s.setSocNote);
  const scale = catalogue.soc!.model.scales[q.kind];
  const answer = soc?.answers[q.id];
  const valid = answer === "unknown" || isRating(q, answer);
  const option = (value: SocAnswer, index: number, label: string, description?: string) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={answer === value}
      tabIndex={radioTab(answer === value, index, valid)}
      aria-label={label}
      aria-describedby={description ? `${q.id}-${value}` : undefined}
      onClick={() => setSocAnswer(q.id, value)}
      className={`grid min-h-9 grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:-outline-offset-2 max-sm:grid-cols-1 ${
        answer === value ? "bg-ink text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink"
      }`}
    >
      <span className={`font-medium ${answer === value ? "text-paper" : "text-ink"}`}>{label}</span>
      {description && <span id={`${q.id}-${value}`}>{description}</span>}
    </button>
  );

  return (
    <article className="rounded-[var(--radius-card)] border border-rule bg-surface p-5 sm:p-6" data-soc-question={q.id}>
      <div className="flex items-center gap-2.5">
        <span className="mono-label rounded-[4px] bg-sunken px-1.5 py-0.5 text-muted">{q.kind === "maturity" ? "Maturity 0–5" : "Capability 0–3"}</span>
        <span className="font-mono text-[0.6875rem] text-muted">{q.id}</span>
        {valid && (
          <span className="ml-auto font-mono text-[0.6875rem] text-ok" aria-hidden>
            ✓ {answer === "unknown" ? "unknown" : `${answer} ${levelFor(scale, answer).name}`}
          </span>
        )}
      </div>
      <h4 className="mt-3 font-sans text-base font-medium leading-snug tracking-normal">{q.question}</h4>
      <p className="mt-1.5 max-w-[72ch] text-sm leading-relaxed text-ink-2">{q.why}</p>
      <div
        className="mt-4 grid max-w-3xl gap-px overflow-hidden rounded-[var(--radius-control)] border border-field bg-field"
        role="radiogroup"
        aria-label={q.question}
        onKeyDown={radioKeys}
      >
        {q.levels.map((text, i) => option(i as SocAnswer, i, `${i} ${scale[i].name}`, text))}
        {option("unknown", q.levels.length, "Unknown", "Not sure yet. Scores 0 until you find out.")}
      </div>
      <details className="group mt-4 border-t border-rule pt-3 text-sm">
        <summary className="text-muted transition-colors [@media(hover:hover)]:hover:text-ink">Notes and references</summary>
        <div className="mt-3 max-w-[72ch] space-y-3 leading-relaxed text-ink-2">
          {q.refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {q.refs.map((r) => (
                <span key={`${r.framework}:${r.ref}`} className="rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">
                  {catalogue.frameworks.get(r.framework)?.shortName ?? r.framework} {r.ref}
                </span>
              ))}
            </div>
          )}
          <textarea
            className={inputClass}
            rows={2}
            maxLength={NOTE_MAX}
            aria-label={`Notes for the report on ${q.id}`}
            placeholder="Notes for the report (optional): evidence, or what would move this up a level"
            value={soc?.notes?.[q.id] ?? ""}
            onChange={(e) => setSocNote(q.id, e.target.value)}
          />
        </div>
      </details>
    </article>
  );
}

function Attribution() {
  const model = catalogue.soc!.model;
  const source = catalogue.sources.get(model.source);
  const licence = catalogue.sources.get(model.licenceSource);
  const link = "text-accent underline decoration-accent/30 underline-offset-2";
  return (
    <p className="mt-10 max-w-[72ch] border-t border-rule pt-4 text-xs leading-relaxed text-muted">
      {model.attribution}{" "}
      {source && (
        <a className={link} href={source.url} target="_blank" rel="noreferrer noopener">
          SOC-CMM
        </a>
      )}
      {source && licence && " · "}
      {licence && (
        <a className={link} href={licence.url} target="_blank" rel="noreferrer noopener">
          {model.licence} licence
        </a>
      )}
    </p>
  );
}
