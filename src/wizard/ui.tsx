import type { ButtonHTMLAttributes, HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import type { Band } from "../engine/risk";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary:
    "border-accent bg-accent text-accent-ink [@media(hover:hover)]:hover:border-accent-hover [@media(hover:hover)]:hover:bg-accent-hover",
  secondary: "border-rule-2 bg-surface text-ink [@media(hover:hover)]:hover:border-ink/45 [@media(hover:hover)]:hover:bg-sunken",
  ghost: "border-transparent text-ink-2 [@media(hover:hover)]:hover:bg-sunken [@media(hover:hover)]:hover:text-ink",
  danger: "border-rule-2 bg-surface text-danger [@media(hover:hover)]:hover:border-danger/50 [@media(hover:hover)]:hover:bg-danger-soft",
};

/** Button with default, hover, focus, active, disabled and loading states. */
export function Button({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ease-[var(--ease-out)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${variants[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** Arrow, Home and End keys for a role="radiogroup" of role="radio" buttons: move and select, like native radios. */
export function radioKeys(e: KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const next = e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : (i + step + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/** Roving tab stop for a radio group: only the checked option (or the first, when none is) is in the tab order. */
export const radioTab = (checked: boolean, index: number, anyChecked: boolean) => (checked || (!anyChecked && index === 0) ? 0 : -1);

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent"
      style={{ animation: "spin 700ms linear infinite" }}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

/** Label + control group for sets of checkboxes or radios (a <label> must not wrap other labels). */
export function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium text-ink">{label}</legend>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

/** Border width never changes between states; focus uses the outline slot so nothing shifts. */
export const inputClass =
  "w-full rounded-[var(--radius-control)] border border-field bg-surface px-3 py-2 text-sm text-ink outline-2 outline-offset-1 outline-transparent transition-colors duration-150 placeholder:text-muted/70 [@media(hover:hover)]:hover:border-ink-2 focus-visible:border-accent focus-visible:outline-accent/35 disabled:cursor-not-allowed disabled:opacity-50";

export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`rounded-[var(--radius-card)] border border-rule bg-surface p-5 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function StepHeader({ title, step, children }: { title: string; step?: string; children?: ReactNode }) {
  return (
    <header className="mb-8">
      {step && <p className="mono-label mb-2 text-accent">{step}</p>}
      <h1 id="step-heading" tabIndex={-1} className="text-[1.75rem] font-semibold leading-tight outline-none sm:text-[2rem]">
        {title}
      </h1>
      {children && <p className="mt-3 max-w-[68ch] text-[0.9375rem] leading-relaxed text-ink-2">{children}</p>}
    </header>
  );
}

/** Toggle chip. Selected = ink fill; the cobalt accent is reserved for actions and focus. */
export function CheckboxPill({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label
      className={`inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] border px-3 py-1.5 text-sm transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus ${
        checked ? "border-ink bg-ink text-paper" : "border-rule-2 bg-surface text-ink-2 [@media(hover:hover)]:hover:border-ink/45 [@media(hover:hover)]:hover:text-ink"
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border text-[10px] leading-none ${checked ? "border-paper/60 text-paper" : "border-field"}`}
      >
        {checked ? "✓" : ""}
      </span>
      {children}
    </label>
  );
}

export const bandClasses: Record<Band, string> = {
  Low: "bg-band-low text-band-low-ink",
  Medium: "bg-band-medium text-band-medium-ink",
  High: "bg-band-high text-band-high-ink",
  Extreme: "bg-band-extreme text-band-extreme-ink",
};

export function BandBadge({ band }: { band: Band }) {
  return <span className={`mono-label rounded-[4px] px-1.5 py-0.5 ${bandClasses[band]}`}>{band}</span>;
}

const severityStyle = {
  critical: "bg-sev-critical-soft text-sev-critical",
  high: "bg-sev-high-soft text-sev-high",
  medium: "bg-sev-medium-soft text-sev-medium",
  low: "bg-sunken text-muted",
};

export function SeverityBadge({ severity }: { severity: keyof typeof severityStyle }) {
  return <span className={`mono-label rounded-[4px] px-1.5 py-0.5 ${severityStyle[severity]}`}>{severity}</span>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1.5 font-mono text-xs tabular-nums text-muted">{label}</div>}
      <div
        className="h-1 overflow-hidden rounded-full bg-rule"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease-out)]" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
