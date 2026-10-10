import { useRef, useState, type ReactNode } from "react";
import { catalogue } from "../../content/catalogue";
import { exposures, type AiKind, type AiQuestion } from "../../content/schema";
import {
  aiAccess,
  aiAutonomy,
  aiBases,
  aiCriteria,
  aiData,
  aiDomains,
  aiLifecycles,
  aiRiskRatings,
  aiStandardUse,
  aiTechnologies,
  aiUsagePatterns,
  type AiBasis,
  type AiCriterion,
} from "../../engine/aiOptions";
import {
  aiFieldLabels,
  aiFieldSources,
  aiNeedsReason,
  aiRegisterSummary,
  composeKillSwitchNote,
  highRiskNotification,
  parseKillSwitchNote,
  shareWithDta,
  type AiReadiness,
  type KillSwitchNote,
} from "../../engine/aiRegister";
import { aboutRows, basisLabel, registerTable, toCsv } from "../../engine/aiExport";
import { assessAll } from "../../engine/risk";
import { answerLabels, type AiUseCase, type Answer } from "../../engine/types";
import { NOTE_MAX } from "../assessmentSchema";
import { download, slug } from "../download";
import { FoundApps, type FoundAppsState } from "../FoundApps";
import { useStore, modeOf } from "../store";
import { BandBadge, Button, Card, CheckboxPill, Field, FieldGroup, Progress, SeverityBadge, StepHeader, focusHeading, inputClass, radioKeys, radioTab } from "../ui";
import { buildXlsx } from "../xlsx";

const ADD = "add";
const answerOrder: Answer[] = ["yes", "partial", "no", "unknown", "na"];
/** The open-gaps filter: one basis of readiness question, or all of them. */
type GapFilter = "all" | AiBasis;
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
const link = "text-accent underline decoration-accent/30 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent";
const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
const dayText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function ExampleBadge() {
  return <span className="mono-label rounded-[4px] bg-warn-soft px-1.5 py-0.5 text-warn">Example</span>;
}

export function AiRegisterStep() {
  const assessment = useStore((s) => s.assessment);
  const setAiIncluded = useStore((s) => s.setAiIncluded);
  const loadAiExamples = useStore((s) => s.loadAiExamples);
  const active = useStore((s) => s.assessment.progress?.aiSection);
  const setActive = useStore((s) => s.setAiSection);
  const [gapBasis, setGapBasis] = useState<GapFilter>("all");
  // The Found apps panel remounts when the register is started, so its parsed file and messages live here.
  const [found, setFound] = useState<FoundAppsState>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const module = catalogue.aiRegister;
  // In the standalone flow this step is the assessment itself: no crown jewels, no Controls, nothing to remove it from.
  const standalone = modeOf(assessment) === "ai-register";

  if (!module) return <StepHeader title="Which AI tools and agents do you use?">This build of crownguard doesn&apos;t include the AI use-case register.</StepHeader>;
  const { model, questions } = module;

  const intro = (
    <StepHeader title="Which AI tools and agents do you use?" {...(standalone ? {} : { step: "Optional" })}>
      {standalone ? (
        <>
          Record each AI use case your organisation runs, from Copilot, Gemini and ChatGPT to third-party AI apps and your
          own agents, and check it against the Australian Government&apos;s policy for the responsible use of AI and the
          DTA&apos;s agentic AI addendum. You get a register with the fields the DTA&apos;s Standard for accountability
          sets out, a readiness check for each use case, and a PDF you can file or share.
        </>
      ) : (
        <>
          Record each AI use case your organisation runs, from Copilot, Gemini and ChatGPT to third-party AI apps and your own
          agents, and check it against the Australian Government&apos;s policy for the responsible use of AI and the DTA&apos;s
          agentic AI addendum. You get a register with the fields the DTA&apos;s Standard for accountability sets out, a
          readiness check for each use case, and a section in the report.
        </>
      )}
    </StepHeader>
  );

  if (!assessment.aiRegister)
    return (
      <>
        {intro}
        <Card>
          <p className="max-w-[68ch] text-sm leading-relaxed text-ink-2">
            Add each use case from a preset, fill in the register fields, then answer up to {questions.length} readiness questions on{" "}
            {model.themes.map((t) => t.name.toLowerCase()).join(", ").replace(/, ([^,]*)$/, " and $1")}. Only the questions that fit the use
            case are asked: agent questions only for AI that can take actions, for example.
            {standalone ? "" : " The register doesn't change your crown-jewel risk ratings unless you tick the exposures it suggests."}
          </p>
          <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-2">{model.appliesTo}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setAiIncluded(true);
                requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-ai-add] button")?.focus());
              }}
            >
              Start an AI use-case register
            </Button>
            <Button variant="secondary" onClick={() => loadAiExamples()}>
              Load example entries
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">Example entries are labelled as examples everywhere they appear, and you can remove them in one step.</p>
        </Card>
        <FoundApps state={found} setState={setFound} />
        <KeyDates />
        <Footer />
      </>
    );

  const risks = assessAll(catalogue, assessment);
  const summary = aiRegisterSummary(catalogue, assessment, risks);
  const entries = summary.entries;
  const current = active === ADD ? undefined : (entries.find((r) => r.entry.id === active) ?? entries[0]);
  const index = current ? entries.indexOf(current) : -1;

  return (
    <>
      {intro}
      {summary.examples > 0 && <ExampleNotice count={summary.examples} />}
      <div className="grid overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface sm:grid-cols-4" data-testid="ai-summary">
        <Tile label="Use cases" value={String(entries.length)} hint={summary.undetermined ? `${summary.undetermined} not yet checked for scope` : "all checked for scope"} />
        <Tile label="In scope of the policy" value={String(summary.inScope)} hint={`${summary.highRisk} with a high inherent risk`} />
        <Tile label="Open readiness gaps" value={String(summary.openGaps)} hint={`${summary.criticalGaps} critical`} />
        <Tile label="Register fields missing" value={String(summary.missingFields)} hint="across all use cases" />
      </div>
      <KeyDates />
      <FoundApps state={found} setState={setFound} />

      <nav className="mt-8 flex flex-wrap gap-x-1 border-b border-rule" aria-label="AI use cases">
        {entries.map((r) => {
          const selected = r.entry.id === current?.entry.id;
          return (
            <button
              key={r.entry.id}
              type="button"
              aria-current={selected ? "true" : undefined}
              onClick={() => setActive(r.entry.id)}
              className={`-mb-px inline-flex max-w-72 items-center gap-2 border-b-2 px-2.5 py-2.5 text-left text-sm transition-colors duration-150 ${
                selected ? "border-accent font-medium text-ink" : "border-transparent text-muted [@media(hover:hover)]:hover:border-rule-2 [@media(hover:hover)]:hover:text-ink"
              }`}
            >
              <span className="truncate">{r.entry.name || "Unnamed use case"}</span>
              <span className={`shrink-0 font-mono text-[0.6875rem] tabular-nums ${r.gaps.length === 0 && r.answered > 0 ? "text-ok" : selected ? "text-accent" : "text-muted"}`}>
                {pct(r.score)}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-current={!current ? "true" : undefined}
          onClick={() => setActive(ADD)}
          className={`-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-sm transition-colors duration-150 ${
            !current ? "border-accent font-medium text-ink" : "border-transparent text-muted [@media(hover:hover)]:hover:border-rule-2 [@media(hover:hover)]:hover:text-ink"
          }`}
        >
          + Add a use case
        </button>
      </nav>

      {current ? (
        <Entry
          key={current.entry.id}
          r={current}
          standalone={standalone}
          headingRef={heading}
          gapBasis={gapBasis}
          onGapBasis={setGapBasis}
          next={entries[index + 1]?.entry}
          onNext={(id) => {
            setActive(id);
            focusHeading(heading);
          }}
        />
      ) : (
        <AddPanel kinds={model.kinds} onAdded={() => focusHeading(heading)} />
      )}

      <Exports />
      {!standalone && (
        <div className="mt-6">
          <Button
            variant="ghost"
            onClick={() => {
              if (confirm("Remove the AI use-case register, and every entry in it, from this assessment?")) setAiIncluded(false);
            }}
          >
            Remove the AI register
          </Button>
        </div>
      )}
      <Footer />
    </>
  );
}

export function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-rule p-4 not-first:border-t sm:not-first:border-t-0 sm:not-first:border-l">
      <div className="mono-label text-muted">{label}</div>
      <div className="mt-1.5 font-display text-[1.75rem] font-semibold leading-none tabular-nums text-ink">{value}</div>
      <div className="mt-1.5 text-xs text-muted">{hint}</div>
    </div>
  );
}

function ExampleNotice({ count }: { count: number }) {
  const removeAiExamples = useStore((s) => s.removeAiExamples);
  return (
    <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-control)] border border-warn/20 bg-warn-soft px-4 py-2.5 text-sm text-warn">
      <span>
        <strong className="font-semibold">Example data.</strong> {count} example {count === 1 ? "entry is" : "entries are"} loaded to show how the register works.
        They&apos;re labelled as examples here, in the exports and in the report, and aren&apos;t real use cases.
      </span>
      <button type="button" className="font-medium underline underline-offset-2" onClick={() => removeAiExamples()}>
        Remove example entries
      </button>
    </div>
  );
}

function Cite({ ids, label = "Source" }: { ids: readonly string[]; label?: string }) {
  const sources = ids.map((id) => catalogue.sources.get(id)).filter((s) => !!s);
  if (!sources.length) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {label}:{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 && " · "}
          <a className={link} href={s.url} target="_blank" rel="noreferrer noopener">
            {s.title}
          </a>
        </span>
      ))}
    </p>
  );
}

function KeyDates() {
  const model = catalogue.aiRegister!.model;
  const assessment = useStore((s) => s.assessment);
  const updateAiRegister = useStore((s) => s.updateAiRegister);
  const reg = assessment.aiRegister;
  const share = reg ? shareWithDta(assessment) : undefined;
  const confirmation = reg?.dateConfirmation;
  const setConfirmation = (patch: { by?: string; on?: string }) => {
    const c = { by: confirmation?.by ?? "", on: confirmation?.on ?? "", ...patch };
    updateAiRegister({ dateConfirmation: c.by.trim() || c.on ? c : undefined });
  };
  return (
    <>
      {reg && (
        <Card className="mt-4" data-testid="ai-register-dates">
          <h2 className="font-sans text-lg font-semibold tracking-normal">Register dates</h2>
          <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
            The DTA counts the register&apos;s six-monthly sharing from the date it was created. Record that date and when you
            last shared the register, and note who confirmed the dates marked * below: crownguard works those out from the
            sources&apos; wording rather than reading them off a page.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Register created" hint="Starts the six-monthly sharing clock">
              <input className={`${inputClass} max-w-48`} type="date" value={reg.createdAt ?? ""} onChange={(x) => updateAiRegister({ createdAt: x.target.value || undefined })} />
            </Field>
            <Field label="Last shared with the DTA" hint="Once you've shared it, the clock runs from this date">
              <input className={`${inputClass} max-w-48`} type="date" value={reg.lastSharedWithDta ?? ""} onChange={(x) => updateAiRegister({ lastSharedWithDta: x.target.value || undefined })} />
            </Field>
            <Field label="Worked-out dates confirmed by" hint="The person who confirmed the dates marked * below">
              <input className={inputClass} maxLength={200} autoComplete="off" value={confirmation?.by ?? ""} onChange={(x) => setConfirmation({ by: x.target.value })} />
            </Field>
            <Field label="and confirmed on">
              <input className={`${inputClass} max-w-48`} type="date" value={confirmation?.on ?? ""} onChange={(x) => setConfirmation({ on: x.target.value })} />
            </Field>
          </div>
          <p
            className={`mt-4 rounded-[var(--radius-control)] border px-3 py-2 text-sm ${
              share?.overdue ? "border-danger/20 bg-danger-soft text-danger" : share?.soon ? "border-warn/20 bg-warn-soft text-warn" : "border-rule bg-paper text-ink-2"
            }`}
            data-testid="ai-share"
          >
            {share?.due
              ? `Next share with the DTA due ${dayText(share.due)}, counted from ${
                  share.basis === "shared" ? "the last share" : "the register's creation"
                }${share.overdue ? " — overdue" : share.soon ? " — due within 30 days" : ""}.`
              : "Record the date the register was created and crownguard works out when the next share with the DTA is due."}
          </p>
        </Card>
      )}
      <details className="mt-4 rounded-[var(--radius-card)] border border-rule bg-surface px-5 py-3 text-sm" data-testid="ai-dates">
        <summary className="text-ink-2 transition-colors [@media(hover:hover)]:hover:text-ink">Key dates and recurring requirements for Commonwealth agencies</summary>
        <ul className="mt-3 max-w-[72ch] space-y-3">
          {model.dates.map((d) => {
            const src = catalogue.sources.get(d.source);
            return (
              <li key={d.text} className="grid gap-x-4 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
                <span className="font-mono text-xs leading-5 text-ink">{d.date ? dayText(d.date) : "Ongoing"}{d.derived ? " *" : ""}</span>
                <span className="text-ink-2">
                  {d.text}{" "}
                  {src && (
                    <a className={`${link} text-xs`} href={src.url} target="_blank" rel="noreferrer noopener">
                      {src.title}
                    </a>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {model.dates.some((d) => d.derived) && <p className="mt-3 text-xs text-muted">* Worked out from the source&apos;s wording, not a date it prints.</p>}
        <p className="mt-2 max-w-[72ch] text-xs text-muted">{model.appliesTo}</p>
      </details>
    </>
  );
}

function AddPanel({ kinds, onAdded }: { kinds: AiKind[]; onAdded: () => void }) {
  const addAiUseCase = useStore((s) => s.addAiUseCase);
  return (
    <section className="mt-8" data-ai-add>
      <h2 className="text-[1.375rem] font-semibold leading-tight">Add a use case</h2>
      <p className="mt-1.5 max-w-[68ch] text-sm text-ink-2">
        Pick the closest match. It fills in the usual technology type, usage pattern and access, which you can change. For a
        general-purpose tool such as Copilot you can register one use case at its highest risk, or one for each distinct use.
      </p>
      <Cite ids={["dta-ai-policy-appendices"]} label="Appendix B" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {kinds.map((k) => (
          <Card key={k.id} className="flex flex-col">
            <h3 className="font-sans text-base font-semibold tracking-normal">{k.name}</h3>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-2">{k.description}</p>
            <Button
              variant="secondary"
              className="mt-3 self-start"
              aria-label={`Add AI use case: ${k.name}`}
              onClick={() => {
                addAiUseCase(k);
                onAdded();
              }}
            >
              + Add
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}

/** A row of single-choice buttons, like the SOC provider question. */
function Choice<K extends string>({ label, options, value, onChange }: { label: string; options: Record<K, string>; value: K | undefined; onChange: (v: K) => void }) {
  const keys = Object.keys(options) as K[];
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" onKeyDown={radioKeys}>
      {keys.map((k, i) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          tabIndex={radioTab(value === k, i, value !== undefined)}
          onClick={() => onChange(k)}
          className={`min-h-9 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm transition-colors duration-150 ${
            value === k ? "border-ink bg-ink font-medium text-paper" : "border-rule-2 bg-surface text-ink-2 [@media(hover:hover)]:hover:border-ink/45 [@media(hover:hover)]:hover:text-ink"
          }`}
        >
          {options[k]}
        </button>
      ))}
    </div>
  );
}

/** Single choice with a description under each option, like the SOC level choices. */
function DetailedChoice<K extends string>({ label, options, value, onChange }: { label: string; options: Record<K, { label: string; detail: string }>; value: K | undefined; onChange: (v: K) => void }) {
  const keys = Object.keys(options) as K[];
  return (
    <div className="grid max-w-3xl gap-px overflow-hidden rounded-[var(--radius-control)] border border-field bg-field" role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
      {keys.map((k, i) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          aria-label={options[k].label}
          tabIndex={radioTab(value === k, i, value !== undefined)}
          onClick={() => onChange(k)}
          className={`grid min-h-9 grid-cols-[minmax(0,15rem)_minmax(0,1fr)] gap-x-3 px-3 py-2 text-left text-sm transition-colors duration-150 focus-visible:-outline-offset-2 max-sm:grid-cols-1 ${
            value === k ? "bg-ink text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink"
          }`}
        >
          <span className={`font-medium ${value === k ? "text-paper" : "text-ink"}`}>{options[k].label}</span>
          <span>{options[k].detail}</span>
        </button>
      ))}
    </div>
  );
}

function Pills<K extends string>({ options, value, onChange }: { options: Record<K, string>; value: K[]; onChange: (v: K[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(options) as K[]).map((k) => (
        <CheckboxPill key={k} checked={value.includes(k)} onChange={(on) => onChange(toggle(value, k, on))}>
          {options[k]}
        </CheckboxPill>
      ))}
    </div>
  );
}

function SubHeading({ children, sources }: { children: ReactNode; sources?: readonly string[] }) {
  return (
    <div className="mb-4">
      <h3 className="font-sans text-lg font-semibold tracking-normal">{children}</h3>
      {sources && <Cite ids={sources} />}
    </div>
  );
}

function Entry({
  r,
  standalone,
  headingRef,
  gapBasis,
  onGapBasis,
  next,
  onNext,
}: {
  r: AiReadiness;
  /** Standalone AI register flow: no crown jewels or Controls answers to relate this use case to. */
  standalone: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  gapBasis: GapFilter;
  onGapBasis: (b: GapFilter) => void;
  next?: AiUseCase;
  onNext: (id: string) => void;
}) {
  const update = useStore((s) => s.updateAiUseCase);
  const removeAiUseCase = useStore((s) => s.removeAiUseCase);
  const jewels = useStore((s) => s.assessment.jewels);
  const upsertJewel = useStore((s) => s.upsertJewel);
  const e = r.entry;
  const set = (patch: Partial<AiUseCase>) => update(e.id, patch);
  const model = catalogue.aiRegister!.model;
  const setCriteria = (c: AiCriterion, on: boolean) => {
    if (c === "none") return set({ criteria: on ? ["none"] : [] });
    return set({ criteria: toggle(e.criteria.filter((x) => x !== "none"), c, on) });
  };

  return (
    <section className="mt-8" data-ai-entry={e.id}>
      <div className="flex flex-wrap items-center gap-2.5">
        {e.example && <ExampleBadge />}
        <span className="mono-label text-muted">{r.kind?.name ?? "AI use case"}</span>
        {e.foundBy && (
          <span className="mono-label rounded-[4px] bg-sunken px-1.5 py-0.5 text-ink-2" data-testid="ai-found-by">
            Found by import · {e.foundBy}
          </span>
        )}
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="mt-1.5 text-[1.375rem] font-semibold leading-tight outline-none">
        {e.name || "Unnamed use case"}
      </h2>

      <Card className="mt-6">
        <SubHeading sources={aiFieldSources.register}>Register details</SubHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={aiFieldLabels.name}>
            <input className={inputClass} value={e.name} maxLength={200} onChange={(x) => set({ name: x.target.value })} />
          </Field>
          <Field label={aiFieldLabels.reference} hint="Your own reference, so the entry can be found again">
            <input className={inputClass} value={e.reference} maxLength={100} placeholder="e.g. AI-2026-004" onChange={(x) => set({ reference: x.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={aiFieldLabels.description} hint="What the AI does and the business objective it serves">
              <textarea className={inputClass} rows={3} maxLength={4000} value={e.description} onChange={(x) => set({ description: x.target.value })} />
            </Field>
          </div>
          <Field label="Underpinning product" hint="Part of the description in the Standard, if it's built on a product">
            <input className={inputClass} value={e.product} maxLength={200} onChange={(x) => set({ product: x.target.value })} />
          </Field>
          <div />
          <div className="sm:col-span-2">
            <FieldGroup label={aiFieldLabels.technology} hint="Tick all that apply. There's no separate type for agents: record the technology they use.">
              <Pills options={aiTechnologies} value={e.technology} onChange={(technology) => set({ technology })} />
            </FieldGroup>
          </div>
          <FieldGroup label={aiFieldLabels.lifecycle}>
            <Choice label={aiFieldLabels.lifecycle} options={aiLifecycles} value={e.lifecycle} onChange={(lifecycle) => set({ lifecycle })} />
          </FieldGroup>
          <FieldGroup label={aiFieldLabels.technicalStandard}>
            <Choice label={aiFieldLabels.technicalStandard} options={aiStandardUse} value={e.technicalStandard} onChange={(technicalStandard) => set({ technicalStandard })} />
          </FieldGroup>
          <div className="sm:col-span-2">
            <FieldGroup label={aiFieldLabels.domains}>
              <Pills options={aiDomains} value={e.domains} onChange={(domains) => set({ domains })} />
            </FieldGroup>
          </div>
          <div className="sm:col-span-2">
            <FieldGroup label={aiFieldLabels.usagePatterns}>
              <Pills options={aiUsagePatterns} value={e.usagePatterns} onChange={(usagePatterns) => set({ usagePatterns })} />
            </FieldGroup>
            <Cite ids={aiFieldSources.classification} label="Domains and usage patterns" />
          </div>
          <Field label={aiFieldLabels.ownerName}>
            <input className={inputClass} value={e.ownerName} maxLength={200} autoComplete="off" onChange={(x) => set({ ownerName: x.target.value })} />
          </Field>
          <Field label={aiFieldLabels.ownerEmail}>
            <input className={inputClass} type="email" value={e.ownerEmail} maxLength={254} autoComplete="off" onChange={(x) => set({ ownerEmail: x.target.value })} />
          </Field>
        </div>
      </Card>

      <Card className="mt-4">
        <SubHeading sources={aiFieldSources.criteria}>Is it in scope of the policy?</SubHeading>
        <FieldGroup label={aiFieldLabels.criteria} hint="A use case is in scope if any of these apply. Incidental uses, such as grammar checking, aren't.">
          <div className="flex flex-col items-start gap-2">
            {(Object.keys(aiCriteria) as AiCriterion[]).map((c) => (
              <CheckboxPill key={c} checked={e.criteria.includes(c)} onChange={(on) => setCriteria(c, on)}>
                {aiCriteria[c]}
              </CheckboxPill>
            ))}
          </div>
        </FieldGroup>
        {r.suggestCriterion4 && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
            You recorded personal, sensitive or classified information below, so criterion 4 may apply.
            <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => setCriteria("c4", true)}>
              Tick criterion 4
            </button>
          </p>
        )}
        <p className="mt-3 text-sm text-muted" data-testid="ai-scope">
          {r.inScope === undefined
            ? "Not worked out yet. Tick the criteria that apply, or None of these."
            : r.inScope
              ? "In scope: the policy's register, owner and impact assessment requirements apply."
              : "Not in scope of the policy. Keeping it in the register still helps you track it."}
        </p>
      </Card>

      <Card className="mt-4">
        <SubHeading sources={aiFieldSources.risk}>Impact assessment</SubHeading>
        <p className="-mt-2 mb-4 max-w-[68ch] text-sm text-ink-2">
          Copy these from the use case&apos;s AI impact assessment. crownguard records them; it doesn&apos;t work them out.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldGroup label={aiFieldLabels.inherentRisk}>
            <Choice label={aiFieldLabels.inherentRisk} options={aiRiskRatings} value={e.inherentRisk} onChange={(inherentRisk) => set({ inherentRisk })} />
          </FieldGroup>
          <FieldGroup label={aiFieldLabels.residualRisk}>
            <Choice label={aiFieldLabels.residualRisk} options={aiRiskRatings} value={e.residualRisk} onChange={(residualRisk) => set({ residualRisk })} />
          </FieldGroup>
          <Field label={aiFieldLabels.impactAssessmentDate}>
            <input className={`${inputClass} max-w-48`} type="date" value={e.impactAssessmentDate ?? ""} onChange={(x) => set({ impactAssessmentDate: x.target.value || undefined })} />
          </Field>
          <div />
          {e.inherentRisk === "high" && (
            <>
              <Field label={aiFieldLabels.lastReview} hint="Needed in the register for a high inherent risk">
                <input className={`${inputClass} max-w-48`} type="date" value={e.lastReview ?? ""} onChange={(x) => set({ lastReview: x.target.value || undefined })} />
              </Field>
              <Field label={aiFieldLabels.nextReview} hint="At least every 12 months">
                <input className={`${inputClass} max-w-48`} type="date" value={e.nextReview ?? ""} onChange={(x) => set({ nextReview: x.target.value || undefined })} />
              </Field>
            </>
          )}
        </div>
        {e.inherentRisk === "medium" && (
          <p className="mt-3 max-w-[68ch] text-sm text-ink-2">For a medium inherent risk, the policy says to consider governing the use case through a designated board or senior executive.</p>
        )}
        {e.inherentRisk === "high" && <NotificationDraft entry={e} />}
      </Card>

      <Card className="mt-4">
        <SubHeading sources={[...aiFieldSources.autonomy, ...aiFieldSources.access]}>What it can do and reach</SubHeading>
        <p className="-mt-2 mb-4 max-w-[68ch] text-sm text-ink-2">
          These aren&apos;t DTA register fields. They decide which readiness questions apply
          {standalone ? "." : ", and link the use case to your crown jewels."}
        </p>
        <div className="space-y-6">
          <FieldGroup label="Oversight model" hint="Using the agentic AI addendum's key terms">
            <DetailedChoice label="Oversight model" options={aiAutonomy} value={e.autonomy} onChange={(autonomy) => set({ autonomy })} />
          </FieldGroup>
          <FieldGroup label="Access level">
            <DetailedChoice label="Access level" options={aiAccess} value={e.access} onChange={(access) => set({ access })} />
          </FieldGroup>
          <FieldGroup label="Data it handles" hint="Tick all that apply">
            <Pills options={aiData} value={e.data} onChange={(data) => set({ data })} />
          </FieldGroup>
          {standalone ? (
            <p className="text-sm text-muted" data-testid="ai-no-jewels">
              The full crown-jewel assessment links each use case to the crown jewels it can reach. Switch this register to
              a full assessment on the Report step when you&apos;re ready, and nothing here is lost.
            </p>
          ) : (
            <>
              <FieldGroup label="Crown jewels it can reach" hint="Tick the crown jewels this AI can read from or act on">
                {jewels.length === 0 ? (
                  <p className="text-sm text-muted">No crown jewels recorded yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {jewels.map((j) => (
                      <CheckboxPill key={j.id} checked={e.jewels.includes(j.id)} onChange={(on) => set({ jewels: toggle(e.jewels, j.id, on) })}>
                        {j.name}
                      </CheckboxPill>
                    ))}
                  </div>
                )}
              </FieldGroup>
              {r.jewels.some((j) => j.risk) && (
                <ul className="space-y-1.5 text-sm" aria-label="Risk of linked crown jewels">
                  {r.jewels.map(({ jewel, risk }) =>
                    risk ? (
                      <li key={jewel.id} className="flex flex-wrap items-center gap-2">
                        <BandBadge band={risk.band} />
                        <span className="text-ink">{jewel.name}</span>
                        <span className="font-mono text-xs text-muted">{risk.score}/25 · {risk.gaps.length} open control gaps</span>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
              {r.exposures.length > 0 && (
                <div className="rounded-[var(--radius-control)] border border-rule bg-paper px-4 py-3 text-sm" data-testid="ai-exposures">
                  <p className="text-ink-2">
                    This kind of AI usually adds an exposure to the crown jewels it reaches. Ticking one raises that crown jewel&apos;s likelihood on the Review step.
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {r.exposures.map(({ jewel, exposure }) => (
                      <li key={`${jewel.id}:${exposure}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-ink">
                          {jewel.name}: {exposures[exposure].toLowerCase()}
                        </span>
                        <button
                          type="button"
                          className="font-medium text-accent underline underline-offset-2"
                          aria-label={`Tick exposure on ${jewel.name}: ${exposures[exposure]}`}
                          onClick={() => upsertJewel({ ...jewel, exposures: [...jewel.exposures, exposure] })}
                        >
                          Tick it
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {r.related.length > 0 && (
                <div className="text-sm">
                  <p className="font-medium text-ink">Your Controls answers on the same tool</p>
                  <ul className="mt-2 space-y-1.5">
                    {r.related.map(({ question, answer }) => (
                      <li key={question.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] gap-3">
                        <span className="pt-0.5 font-mono text-[0.6875rem] text-muted">{question.id}</span>
                        <span className="text-ink-2">{question.question}</span>
                        <span className={`font-mono text-xs ${answer === "yes" ? "text-ok" : "text-muted"}`}>{answer ? answerLabels[answer] : "Unanswered"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </Card>

      <div className="mt-10">
        <SubHeading>Readiness</SubHeading>
        <p className="-mt-2 mb-4 max-w-[68ch] text-sm text-ink-2">
          {r.questions.length} questions apply to this use case. If you&apos;re not sure, answer <strong>Unknown</strong>: it counts as a gap until someone checks.
        </p>
        <Progress value={r.questions.length ? r.answered / r.questions.length : 0} label={`${r.answered} of ${r.questions.length} answered`} />
        {model.themes.map((t) => {
          const qs = r.questions.filter((q) => q.theme === t.id);
          if (!qs.length) return null;
          return (
            <div key={t.id} className="mt-8">
              <h4 className="font-sans text-base font-semibold tracking-normal">{t.name}</h4>
              <p className="mt-0.5 text-sm text-muted">{t.description}</p>
              <div className="mt-3 space-y-3">
                {qs.map((q) => (
                  <ReadinessCard key={q.id} q={q} entry={e} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Gaps r={r} basis={gapBasis} onBasis={onGapBasis} />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {next && (
          <Button variant="secondary" onClick={() => onNext(next.id)}>
            Next use case: {next.name || "Unnamed use case"} →
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm(`Remove “${e.name || "this use case"}” from the register?`)) removeAiUseCase(e.id);
          }}
        >
          Remove this use case
        </Button>
      </div>
    </section>
  );
}

/**
 * The draft high-risk notification the Standard for accountability describes, assembled from the entry. It's text for
 * the accountable official to edit and paste into their own email to the DTA: crownguard never sends anything.
 */
function NotificationDraft({ entry }: { entry: AiUseCase }) {
  const derived = highRiskNotification(entry);
  // null means "follow the entry"; once the user edits it, the draft is theirs until they rebuild it.
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const text = draft ?? derived;
  const src = catalogue.sources.get("dta-ai-accountability");
  return (
    <div className="mt-5 rounded-[var(--radius-control)] border border-rule bg-paper px-4 py-3 text-sm" data-testid="ai-notification">
      <p className="max-w-[68ch] text-ink-2">
        <strong className="font-medium text-ink">Draft notification for the DTA.</strong> For a high inherent risk the Standard for
        accountability says to notify the DTA of the type of AI, its intended application, how the risk rating was reached and
        its sensitivities. The draft below is assembled from this entry so you can read it, edit it and paste it into your own
        email. crownguard doesn&apos;t send it or open a mail client.
      </p>
      <textarea
        className={`${inputClass} mt-3 font-mono text-xs leading-relaxed`}
        rows={6}
        aria-label="Draft high-risk notification text"
        value={text}
        onChange={(x) => {
          setDraft(x.target.value);
          setCopied(false);
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void copyText(text, setCopied, setCopyError)}>
          Copy notification text
        </Button>
        {draft !== null && draft !== derived && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            Rebuild from the entry
          </Button>
        )}
        {copied && <span role="status" className="font-mono text-xs text-ok">Copied</span>}
      </div>
      {copyError && <p role="alert" className="mt-1.5 text-xs text-danger">Couldn&apos;t copy: {copyError}. Select the text and copy it.</p>}
      <p className="mt-2 max-w-[68ch] text-xs text-muted">
        Send it to ai@dta.gov.au by typing that address into your own email.{" "}
        {src && (
          <a className={link} href={src.url} target="_blank" rel="noreferrer noopener">
            {src.title}
          </a>
        )}
      </p>
    </div>
  );
}

/** Copy the draft to the clipboard, reporting success inline and any failure without losing the caught error. */
async function copyText(text: string, setCopied: (v: boolean) => void, setCopyError: (v: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    setCopyError("");
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  } catch (e) {
    setCopied(false);
    setCopyError((e as Error).message || "the clipboard isn't available");
  }
}

function ReadinessCard({ q, entry }: { q: AiQuestion; entry: AiUseCase }) {
  const setAiAnswer = useStore((s) => s.setAiAnswer);
  const setAiNote = useStore((s) => s.setAiNote);
  const answer = entry.answers[q.id];
  const missingReason = aiNeedsReason(entry, q.id);
  const reasonId = `${entry.id}-${q.id}-na-reason`;
  // The switch-off question carries the kill-switch worksheet in its note, instead of the free-text note below.
  const isKillSwitch = q.id === "AIR-OFF-001";
  return (
    <article className="rounded-[var(--radius-card)] border border-rule bg-surface p-5 sm:p-6" data-ai-question={q.id}>
      <div className="flex flex-wrap items-center gap-2.5">
        <SeverityBadge severity={q.severity} />
        <span className="font-mono text-[0.6875rem] text-muted">{q.id}</span>
        <span className="rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">{aiBases[q.basis]}</span>
        {answer && !missingReason && <span className="ml-auto font-mono text-[0.6875rem] text-ok" aria-hidden>✓ answered</span>}
        {missingReason && <span className="ml-auto font-mono text-[0.6875rem] text-warn" aria-hidden>reason needed</span>}
      </div>
      <h5 className="mt-3 font-sans text-base font-medium leading-snug tracking-normal">{q.question}</h5>
      <div className="mt-4 grid max-w-md grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-control)] border border-field bg-field" role="radiogroup" aria-label={q.question} onKeyDown={radioKeys}>
        {answerOrder.map((a, i) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={answer === a}
            tabIndex={radioTab(answer === a, i, answer !== undefined)}
            onClick={() => setAiAnswer(entry.id, q.id, a)}
            className={`min-h-9 px-1 py-1.5 text-[0.8125rem] transition-colors duration-150 focus-visible:-outline-offset-2 sm:px-3 sm:text-sm ${
              answer === a ? "bg-ink font-medium text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink"
            }`}
          >
            {answerLabels[a]}
          </button>
        ))}
      </div>
      {isKillSwitch && <KillSwitchWorksheet entry={entry} showReason={answer === "na"} missingReason={missingReason} />}
      {!isKillSwitch && answer === "na" && (
        <div className="mt-4 max-w-[72ch]">
          <label htmlFor={reasonId} className="text-sm font-medium text-ink">
            Why doesn&apos;t this apply? <span className="font-normal text-muted">(required)</span>
          </label>
          <textarea
            id={reasonId}
            rows={2}
            required
            aria-required="true"
            aria-invalid={missingReason}
            className={`${inputClass} mt-1.5 ${missingReason ? "border-warn!" : ""}`}
            value={entry.notes[q.id] ?? ""}
            maxLength={NOTE_MAX}
            onChange={(x) => setAiNote(entry.id, q.id, x.target.value)}
          />
          <p className={`mt-1 text-xs ${missingReason ? "text-warn" : "text-muted"}`}>
            {missingReason ? "Until you give a reason this counts as unanswered and is scored as a gap." : "Shown in the report with this use case."}
          </p>
        </div>
      )}
      <details className="group mt-4 border-t border-rule pt-3 text-sm">
        <summary className="text-muted transition-colors [@media(hover:hover)]:hover:text-ink">Why this matters and what good looks like</summary>
        <div className="mt-4 max-w-[72ch] space-y-3 leading-relaxed text-ink-2">
          <p>{q.why}</p>
          <p><span className="font-medium text-ink">Yes looks like: </span>{q.yesLooksLike}</p>
          <p><span className="font-medium text-ink">How to fix: </span>{q.remediation}</p>
          <div className="text-xs text-muted">
            <div className="flex flex-wrap gap-1.5">
              {q.refs.map((ref) => (
                <span key={`${ref.framework}:${ref.ref}`} className="rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">
                  {catalogue.frameworks.get(ref.framework)?.shortName ?? ref.framework} {ref.ref}
                </span>
              ))}
            </div>
            <ul className="mt-2 space-y-0.5">
              {q.sources.map((s) => {
                const src = catalogue.sources.get(s);
                return src ? (
                  <li key={s}>
                    <a className={link} href={src.url} target="_blank" rel="noreferrer noopener">{src.title}</a> · {src.publisher}
                  </li>
                ) : null;
              })}
            </ul>
          </div>
          {!isKillSwitch && answer !== "na" && (
            <textarea
              className={inputClass}
              rows={2}
              maxLength={NOTE_MAX}
              aria-label={`Notes for the report on ${q.id}`}
              placeholder="Notes for the report (optional)"
              value={entry.notes[q.id] ?? ""}
              onChange={(x) => setAiNote(entry.id, q.id, x.target.value)}
            />
          )}
        </div>
      </details>
    </article>
  );
}

/**
 * Optional structured note for the kill-switch question. It's written into that question's note as labelled lines, so
 * it travels with the answer and prints with it in the report; nothing about it needs a field of its own.
 */
function KillSwitchWorksheet({ entry, showReason, missingReason }: { entry: AiUseCase; showReason: boolean; missingReason: boolean }) {
  const updateAiUseCase = useStore((s) => s.updateAiUseCase);
  const n = parseKillSwitchNote(entry.notes?.["AIR-OFF-001"]);
  const set = (key: keyof KillSwitchNote, value: string) =>
    updateAiUseCase(entry.id, { notes: { ...entry.notes, "AIR-OFF-001": composeKillSwitchNote({ ...n, [key]: value }) } });
  const fields: [keyof KillSwitchNote, string][] = [
    ["stop", "How to stop it (identity, tokens, connectors)"],
    ["who", "Who may stop it"],
    ["targetTime", "Target time to stop"],
    ["tested", "Date it was last tested"],
    ["rollback", "Rollback approach"],
    ...(showReason ? ([["reason", "Why it doesn't apply"]] as [keyof KillSwitchNote, string][]) : []),
  ];
  return (
    <fieldset className="mt-4 rounded-[var(--radius-control)] border border-rule bg-sunken p-4">
      <legend className="px-1 text-sm font-medium text-ink">Switch-off worksheet (optional)</legend>
      <p className="max-w-[72ch] text-xs text-muted">
        The agentic AI addendum asks agencies to set and test their own minimum requirements for stopping an agent. The
        addendum doesn&apos;t say what they are, so write yours here. It saves against this question and prints with it in the
        report. Nothing is sent anywhere.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className={`block text-sm ${key === "reason" || key === "rollback" ? "sm:col-span-2" : ""}`}>
            <span className="font-medium text-ink">
              {label}
              {key === "reason" && missingReason ? <span className="ml-1 font-normal text-danger">(required)</span> : <span className="font-normal text-muted"> (optional)</span>}
            </span>
            <input
              type={key === "tested" ? "date" : "text"}
              value={n[key]}
              onChange={(e) => set(key, e.target.value)}
              aria-invalid={key === "reason" && missingReason ? true : undefined}
              className={`${inputClass} mt-1 w-full`}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Gaps({ r, basis, onBasis }: { r: AiReadiness; basis: GapFilter; onBasis: (b: GapFilter) => void }) {
  // Only the bases that actually have an open gap are worth offering as a filter.
  const offered = [...new Set(r.gaps.map((g) => g.question.basis).filter((b): b is AiBasis => !!b))];
  const shown = basis === "all" ? r.gaps : r.gaps.filter((g) => g.question.basis === basis);
  return (
    <Card className="mt-8" data-testid="ai-gaps">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-lg font-semibold tracking-normal">Readiness for this use case</h3>
        <p className="font-mono text-xs tabular-nums text-muted">
          {pct(r.score)} in place · {r.gaps.length} open {r.gaps.length === 1 ? "gap" : "gaps"} · {r.missing.length} register {r.missing.length === 1 ? "field" : "fields"} missing
        </p>
      </div>
      <ul className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4" aria-label="Readiness by theme">
        {r.themes.map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-2 border-b border-rule pb-1.5">
            <span className="text-ink">{t.name}</span>
            <span className={`font-mono text-xs ${t.status === "Met" ? "text-ok" : t.status === "Not met" ? "text-danger" : "text-muted"}`}>{t.status}</span>
          </li>
        ))}
      </ul>
      {r.flags.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm text-warn">
          {r.flags.map((f) => (
            <li key={f} className="rounded-[var(--radius-control)] border border-warn/20 bg-warn-soft px-3 py-2">{f}</li>
          ))}
        </ul>
      )}
      {r.gaps.length > 0 && (
        <>
          <h4 className="mt-5 text-sm font-semibold">Open gaps, most severe first</h4>
          {offered.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter open gaps by where the requirement comes from">
              {([["all", "All gaps"] as const, ...offered.map((b) => [b, aiBases[b]] as const)] as [GapFilter, string][]).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={basis === value}
                  onClick={() => onBasis(value)}
                  className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-xs transition-colors duration-150 ${
                    basis === value ? "border-accent bg-accent-soft font-medium text-ink" : "border-rule text-muted [@media(hover:hover)]:hover:border-rule-2 [@media(hover:hover)]:hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <ul className="mt-2 space-y-2 text-sm">
            {shown.map((g) => (
              <li key={g.question.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
                <span className="pt-0.5 font-mono text-[0.6875rem] text-muted">{g.question.id}</span>
                <span className="text-ink">
                  {g.question.question}{" "}
                  <span className="text-muted">
                    ({g.answer ? answerLabels[g.answer] : "Unanswered"} · {g.question.severity}
                    {basisLabel(g.question.basis) ? ` · ${basisLabel(g.question.basis)}` : ""})
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {shown.length === 0 && <p className="mt-2 text-sm text-muted">No open gaps come from that requirement.</p>}
        </>
      )}
      {r.missing.length > 0 && (
        <>
          <h4 className="mt-5 text-sm font-semibold">Register fields still to fill in</h4>
          <p className="mt-1 text-sm text-ink-2">{r.missing.map((f) => aiFieldLabels[f]).join(" · ")}</p>
        </>
      )}
    </Card>
  );
}

function Exports() {
  const assessment = useStore((s) => s.assessment);
  const entries = assessment.aiRegister?.entries.length ?? 0;
  const file = (ext: string) => {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${slug(assessment.org.name)}-ai-use-case-register-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}.${ext}`;
  };
  return (
    <Card className="mt-10">
      <h2 className="text-base font-semibold">Download the register</h2>
      <p className="mt-1 max-w-[68ch] text-sm text-ink-2">
        One row per use case. The first columns are the Standard for accountability&apos;s minimum fields, in its order; crownguard&apos;s readiness
        columns follow, so you can keep or drop them. The spreadsheet adds an About sheet with the dates, notes and sources. Files are made in your browser.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!entries} onClick={() => download(file("csv"), toCsv(registerTable(catalogue, assessment)), "text/csv;charset=utf-8")}>
          Download CSV
        </Button>
        <Button
          variant="secondary"
          disabled={!entries}
          onClick={() => {
            const t = registerTable(catalogue, assessment);
            const bytes = buildXlsx([
              { name: "Register", rows: [t.headers, ...t.rows], header: true, widths: t.headers.map((h) => (/Description|gaps|missing/i.test(h) ? 48 : 22)) },
              { name: "About", rows: aboutRows(catalogue, assessment), widths: [18, 110] },
            ]);
            download(file("xlsx"), bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
          }}
        >
          Download XLSX
        </Button>
      </div>
    </Card>
  );
}

function Footer() {
  const model = catalogue.aiRegister!.model;
  return (
    <>
      {model.caveats.length > 0 && (
        <details className="mt-10 rounded-[var(--radius-card)] border border-rule bg-surface px-5 py-3 text-sm" data-testid="ai-caveats">
          <summary className="text-ink-2 transition-colors [@media(hover:hover)]:hover:text-ink">What the sources leave open, and how crownguard handles it</summary>
          <ul className="mt-3 max-w-[72ch] space-y-3 text-ink-2">
            {model.caveats.map((c) => (
              <li key={c.text}>
                {c.text}
                <Cite ids={c.sources} />
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-10 max-w-[72ch] border-t border-rule pt-4 text-xs leading-relaxed text-muted">{model.attribution}</p>
    </>
  );
}
