import { contrast, readableOn, textOn } from "../../theme/color";
import { ColorField } from "../ColorField";
import { LogoField } from "../LogoField";
import { useStore } from "../store";
import { Card, Field, inputClass, StepHeader } from "../ui";

// PSPF markings for government, IDCF Data Security Levels for everyone else, and plain labels.
const markings = ["OFFICIAL", "OFFICIAL: Sensitive", "PROTECTED", "DSL-2", "DSL-3", "DSL-3, Confidential", "DSL-4", "Confidential", "Internal use only"];
export function BrandingStep() {
  const { assessment, setBranding } = useStore();
  const b = assessment.branding;
  const custom = !markings.includes(b.marking);

  const primaryContrast = contrast(b.primary, "#ffffff");

  return (
    <>
      <StepHeader title="Brand the report">
        Add your logo and we'll pick colours from it. Adjust them if you like; we'll keep text readable. The logo is
        processed in your browser and stored only with this assessment.
      </StepHeader>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="max-w-xl space-y-5">
          <LogoField testId="logo-input" />
          {b.logoDataUrl && (
            <fieldset>
              <legend className="text-sm font-medium text-ink">Logo background on the cover</legend>
              <p className="mt-0.5 text-xs text-muted">Use a white panel only if the logo is hard to see on the cover colour.</p>
              <div className="mt-2 inline-grid grid-cols-2 overflow-hidden rounded-[var(--radius-control)] border border-field bg-field gap-px" role="radiogroup" aria-label="Logo background on the cover">
                {(["none", "white"] as const).map((v) => {
                  const on = (b.logoBackdrop ?? "none") === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setBranding({ logoBackdrop: v })}
                      className={`min-h-9 px-4 text-sm transition-colors duration-150 focus-visible:-outline-offset-2 ${on ? "bg-ink font-medium text-paper" : "bg-surface text-ink-2 [@media(hover:hover)]:hover:bg-sunken"}`}
                    >
                      {v === "none" ? "None" : "White panel"}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <ColorField label="Primary colour" value={b.primary} onChange={(primary) => setBranding({ primary })} />
            <ColorField label="Accent colour" value={b.accent} onChange={(accent) => setBranding({ accent })} />
          </div>
          {primaryContrast < 4.5 && (
            <p className="text-sm text-warn">
              The primary colour is light, so headings will use a darker shade ({readableOn(b.primary).toUpperCase()}) to stay readable.
            </p>
          )}
          <Field
            label="Protective marking"
            hint="Printed in the header and footer of every page. OFFICIAL, OFFICIAL: Sensitive and PROTECTED are Australian Government (PSPF) markings. If your organisation uses the IDCF, you can use a Data Security Level instead (DSL-3 or higher suits a report that describes security gaps); applying a DSL label means you are treated as using the IDCF and its code of conduct."
          >
            <select
              className={inputClass}
              value={custom ? "__custom" : b.marking}
              onChange={(e) => setBranding({ marking: e.target.value === "__custom" ? "" : e.target.value })}
            >
              {markings.map((m) => <option key={m}>{m}</option>)}
              <option value="__custom">Custom…</option>
            </select>
            {custom && <input className={`${inputClass} mt-2`} value={b.marking} onChange={(e) => setBranding({ marking: e.target.value })} placeholder="Marking text" />}
          </Field>
          <Field label="Prepared for">
            <input className={inputClass} value={b.preparedFor} onChange={(e) => setBranding({ preparedFor: e.target.value })} placeholder="e.g. Executive Leadership Team" />
          </Field>
          <Field label="Prepared by">
            <input className={inputClass} value={b.preparedBy} onChange={(e) => setBranding({ preparedBy: e.target.value })} placeholder="Name, role" />
          </Field>
        </div>

        <figure className="self-start lg:sticky lg:top-24">
          <figcaption className="mono-label mb-2 text-muted">Cover preview</figcaption>
          <Card className="p-0">
          <div className="overflow-hidden rounded-[var(--radius-card)]">
            <div className="h-2" style={{ background: b.accent }} />
            <div className="aspect-[1/1.414] p-6" style={{ background: b.primary, color: textOn(b.primary) }}>
              <div className="text-[10px] font-semibold tracking-wider opacity-80">{b.marking}</div>
              {b.logoDataUrl && (
                <img
                  src={b.logoDataUrl}
                  alt="Logo preview"
                  className={`mt-6 max-h-16 max-w-[75%] object-contain ${b.logoBackdrop === "white" ? "rounded-[4px] bg-surface p-2" : ""}`}
                />
              )}
              <div className="mt-10 text-[10px] uppercase tracking-widest opacity-80">Crown-jewel risk assessment</div>
              <div className="mt-1 font-display text-xl font-semibold leading-tight tracking-[-0.02em]">{assessment.org.name || "Your organisation"}</div>
              <div className="mt-3 h-0.5 w-10" style={{ background: b.accent }} />
            </div>
          </div>
          </Card>
        </figure>
      </div>
    </>
  );
}
