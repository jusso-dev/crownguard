import type { ReactNode } from "react";
import { catalogue } from "../content/catalogue";
import { NOTE_MAX } from "../format/schema";
import { answerLabels, answers, type Answer } from "../format/vocab";
import { inputClass, radioKeys, radioTab } from "./ui";

/** "✓ answered" or "reason needed" beside a question's id. */
export function AnswerState({ answer, missingReason }: { answer: Answer | undefined; missingReason: boolean }) {
  if (missingReason) return <span className="ml-auto font-mono text-[0.6875rem] text-warn" aria-hidden>reason needed</span>;
  if (answer) return <span className="ml-auto font-mono text-[0.6875rem] text-ok" aria-hidden>✓ answered</span>;
  return null;
}

/** Yes / Partial / No / Unknown / N/A for one question. */
export function AnswerButtons({ label, answer, onAnswer }: { label: string; answer: Answer | undefined; onAnswer: (a: Answer) => void }) {
  return (
    <div
      className="mt-4 grid max-w-md grid-cols-5 gap-px overflow-hidden rounded-[var(--radius-control)] border border-field bg-field"
      role="radiogroup"
      aria-label={label}
      onKeyDown={radioKeys}
    >
      {answers.map((a, i) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={answer === a}
          tabIndex={radioTab(answer === a, i, answer !== undefined)}
          onClick={() => onAnswer(a)}
          className={`min-h-9 px-1 py-1.5 text-[0.8125rem] transition-colors duration-150 focus-visible:-outline-offset-2 sm:px-3 sm:text-sm ${
            answer === a ? "bg-ink font-medium text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink"
          }`}
        >
          {answerLabels[a]}
        </button>
      ))}
    </div>
  );
}

/** The reason an N/A answer needs. Until it's given, the answer is scored as a gap. */
export function NaReason({
  id,
  value,
  onChange,
  missing,
  placeholder,
  shownIn,
}: {
  id: string;
  value: string;
  onChange: (note: string) => void;
  missing: boolean;
  placeholder?: string;
  /** Where the reason appears once given. */
  shownIn: string;
}) {
  return (
    <div className="mt-4 max-w-[72ch]">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Why doesn&apos;t this apply? <span className="font-normal text-muted">(required)</span>
      </label>
      <textarea
        id={id}
        rows={2}
        required
        aria-required="true"
        aria-invalid={missing}
        aria-describedby={`${id}-help`}
        className={`${inputClass} mt-1.5 ${missing ? "border-warn!" : ""}`}
        placeholder={placeholder}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className={`mt-1 text-xs ${missing ? "text-warn" : "text-muted"}`}>
        {missing ? "Until you give a reason this counts as unanswered and is scored as a gap." : shownIn}
      </p>
    </div>
  );
}

/** The optional note a question carries into the report. */
export function ReportNote({ questionId, value, onChange }: { questionId: string; value: string; onChange: (note: string) => void }) {
  return (
    <textarea
      className={inputClass}
      rows={2}
      maxLength={NOTE_MAX}
      aria-label={`Notes for the report on ${questionId}`}
      placeholder="Notes for the report (optional)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

const chip = "rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2";
export const linkClass = "text-accent underline decoration-accent/30 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent";

/** A question's framework references and the sources behind it. `extra` adds chips after the references. */
export function References({ refs, sources, extra }: { refs: { framework: string; ref: string }[]; sources: string[]; extra?: ReactNode }) {
  return (
    <div className="text-xs text-muted">
      <div className="flex flex-wrap gap-1.5">
        {refs.map((r) => (
          <span key={`${r.framework}:${r.ref}`} className={chip}>
            {catalogue.frameworks.get(r.framework)?.shortName ?? r.framework} {r.ref}
          </span>
        ))}
        {extra}
      </div>
      {sources.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {sources.map((s) => {
            const src = catalogue.sources.get(s);
            return src ? (
              <li key={s}>
                <a className={linkClass} href={src.url} target="_blank" rel="noreferrer noopener">{src.title}</a> · {src.publisher}
              </li>
            ) : null;
          })}
        </ul>
      )}
    </div>
  );
}

export const refChip = chip;
