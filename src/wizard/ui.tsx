import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Band } from "../engine/risk";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-ink text-white hover:bg-ink-soft disabled:opacity-40",
    secondary: "border border-line bg-white text-ink hover:border-ink/40",
    ghost: "text-ink-soft hover:bg-black/5",
    danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-ink-soft/80">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-white px-3 py-2 text-sm shadow-xs placeholder:text-ink-soft/50 focus:border-gold focus:outline-none";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-white p-5 ${className}`}>{children}</div>;
}

export function StepHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-soft">{children}</p>}
    </header>
  );
}

export function CheckboxPill({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label
      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
        checked ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/40"
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

export const bandColors: Record<Band, { bg: string; fg: string }> = {
  Low: { bg: "#d9efe1", fg: "#1d5c36" },
  Medium: { bg: "#fbefc8", fg: "#7a5200" },
  High: { bg: "#fbd9c4", fg: "#8a3200" },
  Extreme: { bg: "#f6c9c9", fg: "#8c1414" },
};

export function BandBadge({ band }: { band: Band }) {
  const c = bandColors[band];
  return (
    <span className="rounded px-2 py-0.5 text-xs font-semibold" style={{ background: c.bg, color: c.fg }}>
      {band}
    </span>
  );
}

const severityStyle = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-slate-100 text-slate-700",
};

export function SeverityBadge({ severity }: { severity: keyof typeof severityStyle }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${severityStyle[severity]}`}>{severity}</span>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <div className="mb-1 text-xs text-ink-soft">{label}</div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}
