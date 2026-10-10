import { useId, useState } from "react";
import { chooseLogoBackdrop, extractPalette, readableOn } from "../theme/color";
import { emptyAssessment, useStore } from "./store";
import { Button } from "./ui";

const MAX_SIDE = 600;

/** Re-encode any uploaded image as a bounded PNG (the PDF renderer only takes PNG/JPEG) and sample its colours. */
async function processLogo(file: File): Promise<{ dataUrl: string; palette: ReturnType<typeof extractPalette>; backdropOn: (cover: string) => "none" | "white" }> {
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
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const palette = extractPalette(pixels);
    const backdropOn = (cover: string) => chooseLogoBackdrop(pixels, canvas.width, canvas.height, cover);
    return { dataUrl: canvas.toDataURL("image/png"), palette, backdropOn };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Organisation logo, shared by the Organisation and Branding steps. Uploading also suggests report colours. */
export function LogoField({ testId }: { testId: string }) {
  const { logoDataUrl: logo, primary, accent } = useStore((s) => s.assessment.branding);
  const setBranding = useStore((s) => s.setBranding);
  const [error, setError] = useState<string>();
  const [suggested, setSuggested] = useState<{ primary: string; accent: string }>();
  const id = useId();

  async function onFile(file: File) {
    setError(undefined);
    if (file.size > 5_000_000) return setError("Logo must be under 5 MB.");
    try {
      const { dataUrl, palette, backdropOn } = await processLogo(file);
      const fromLogo = palette && { primary: readableOn(palette.primary), accent: palette.accent };
      // Only take colours from the logo while the report still has the default ones; never overwrite chosen colours.
      const defaults = emptyAssessment().branding;
      const untouched = primary === defaults.primary && accent === defaults.accent;
      const cover = untouched && fromLogo ? fromLogo.primary : primary;
      setBranding({ logoDataUrl: dataUrl, logoBackdrop: backdropOn(cover), ...(untouched && fromLogo) });
      setSuggested(!untouched && fromLogo && (fromLogo.primary !== primary || fromLogo.accent !== accent) ? fromLogo : undefined);
    } catch {
      setError("Couldn't read that image. Try a PNG, JPEG or SVG.");
    }
  }

  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        Logo
      </label>
      <p className="mt-0.5 text-xs text-muted">PNG, JPEG, WebP or SVG. Appears on the report cover. Processed in your browser only.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {logo && (
          <span className="grid h-12 w-28 place-items-center rounded-[var(--radius-control)] border border-rule bg-surface p-1.5">
            <img src={logo} alt="Current logo" className="max-h-full max-w-full object-contain" />
          </span>
        )}
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          data-testid={testId}
          aria-invalid={error ? true : undefined}
          className="min-w-0 max-w-full text-sm text-ink-2 file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-[var(--radius-control)] file:border file:border-solid file:border-rule-2 file:bg-surface file:px-3.5 file:py-1.5 file:text-sm file:font-medium file:text-ink file:transition-colors [@media(hover:hover)]:file:hover:bg-sunken"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
        {logo && (
          <Button variant="ghost" onClick={() => setBranding({ logoDataUrl: undefined })}>
            Remove logo
          </Button>
        )}
      </div>
      {suggested && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted" role="status">
          <span>Kept your report colours. Colours from this logo:</span>
          {[suggested.primary, suggested.accent].map((c) => (
            <span key={c} className="inline-flex items-center gap-1 font-mono uppercase">
              <span aria-hidden className="h-3 w-3 rounded-[3px] border border-rule-2" style={{ background: c }} />
              {c}
            </span>
          ))}
          <Button
            variant="ghost"
            className="min-h-9 px-2.5 py-1 text-xs"
            onClick={() => {
              setBranding(suggested);
              setSuggested(undefined);
            }}
          >
            Use logo colours
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
