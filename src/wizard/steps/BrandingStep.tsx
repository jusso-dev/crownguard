import { useState } from "react";
import { contrast, extractPalette, readableOn, textOn } from "../../theme/color";
import { useStore } from "../store";
import { Button, Card, Field, inputClass, StepHeader } from "../ui";

const markings = ["OFFICIAL", "OFFICIAL: Sensitive", "PROTECTED", "Confidential", "Internal use only"];
const MAX_SIDE = 600;

/** Re-encode any uploaded image as a bounded PNG (the PDF renderer only takes PNG/JPEG) and sample its colours. */
async function processLogo(file: File): Promise<{ dataUrl: string; palette: ReturnType<typeof extractPalette> }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || MAX_SIDE;
    const h = img.naturalHeight || MAX_SIDE / 2;
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const palette = extractPalette(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
    return { dataUrl: canvas.toDataURL("image/png"), palette };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandingStep() {
  const { assessment, setBranding } = useStore();
  const b = assessment.branding;
  const [error, setError] = useState<string>();
  const custom = !markings.includes(b.marking);

  async function onLogo(file: File) {
    setError(undefined);
    if (file.size > 5_000_000) return setError("Logo must be under 5 MB.");
    try {
      const { dataUrl, palette } = await processLogo(file);
      setBranding({
        logoDataUrl: dataUrl,
        ...(palette && { primary: readableOn(palette.primary), accent: palette.accent }),
      });
    } catch {
      setError("Couldn't read that image. Try a PNG, JPEG or SVG.");
    }
  }

  const primaryContrast = contrast(b.primary, "#ffffff");

  return (
    <>
      <StepHeader title="Brand the report">
        Add your logo and we'll pick colours from it. Adjust them if you like; we'll keep text readable. The logo is
        processed in your browser and stored only with this assessment.
      </StepHeader>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="max-w-xl space-y-5">
          <Field label="Logo" hint="PNG, JPEG, WebP or SVG. A horizontal logo on a transparent background works best.">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                data-testid="logo-input"
                className="min-w-0 max-w-full text-sm text-ink-2 file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-[var(--radius-control)] file:border file:border-solid file:border-rule-2 file:bg-surface file:px-3.5 file:py-1.5 file:text-sm file:font-medium file:text-ink file:transition-colors [@media(hover:hover)]:file:hover:bg-sunken"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onLogo(f);
                }}
              />
              {b.logoDataUrl && <Button variant="ghost" onClick={() => setBranding({ logoDataUrl: undefined })}>Remove</Button>}
            </div>
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Primary colour">
              <input type="color" className="h-10 w-full cursor-pointer rounded-[var(--radius-control)] border border-field bg-surface p-1" value={b.primary} onChange={(e) => setBranding({ primary: e.target.value })} />
            </Field>
            <Field label="Accent colour">
              <input type="color" className="h-10 w-full cursor-pointer rounded-[var(--radius-control)] border border-field bg-surface p-1" value={b.accent} onChange={(e) => setBranding({ accent: e.target.value })} />
            </Field>
          </div>
          {primaryContrast < 4.5 && (
            <p className="text-sm text-warn">
              The primary colour is light, so headings will use a darker shade ({readableOn(b.primary)}) to stay readable.
            </p>
          )}
          <Field label="Protective marking" hint="Printed in the header and footer of every page.">
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
              {b.logoDataUrl && <img src={b.logoDataUrl} alt="Logo preview" className="mt-6 max-h-14 max-w-[70%] rounded-[4px] bg-surface p-2" />}
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
