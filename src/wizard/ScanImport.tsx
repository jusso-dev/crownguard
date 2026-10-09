import { useRef, useState } from "react";
import { catalogue } from "../content/catalogue";
import { activeQuestions } from "../engine/risk";
import { answerLabels, type Assessment, type ScanStatus } from "../engine/types";
import { detectImporter, importers, type ScanImporter, type ScanResult } from "../imports";
import { useStore } from "./store";
import { relativeTime } from "./time";
import { Button } from "./ui";

export const statusStyle: Record<ScanStatus, string> = {
  pass: "bg-ok-soft text-ok",
  fail: "bg-sev-critical-soft text-sev-critical",
  warning: "bg-sev-medium-soft text-sev-medium",
  review: "bg-sunken text-muted",
  info: "bg-sunken text-muted",
  unknown: "bg-sunken text-muted",
  notlicensed: "bg-sunken text-muted",
};

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Why an importer can't be used with this assessment, in the assessor's words. Undefined when it can be. */
function unusable(importer: ScanImporter, assessment: Assessment): string | undefined {
  const platform = catalogue.platforms.get(importer.platform)?.platform;
  const name = platform?.name ?? importer.platform;
  if (!assessment.platforms.includes(importer.platform)) return `${name} isn't in scope for this assessment`;
  if (importer.requiresModule && !Object.values(assessment.modules).some((m) => m.includes(importer.requiresModule!)))
    return `${platform?.modules.find((m) => m.id === importer.requiresModule)?.name ?? importer.requiresModule} isn't turned on for ${name}`;
  return undefined;
}

/** Optional: pre-fill answers from an automated scan (M365-Secure, Prowler). The file is read in your browser only. */
export function ScanImport() {
  const assessment = useStore((s) => s.assessment);
  const applyScan = useStore((s) => s.applyScan);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ScanResult>();
  const [previewer, setPreviewer] = useState<ScanImporter>();
  const [error, setError] = useState<string>();
  const [overwrite, setOverwrite] = useState(false);
  const [setLicence, setSetLicence] = useState(true);
  const [done, setDone] = useState<string>();

  const usable = importers.filter((i) => catalogue.imports.has(i.id) && !unusable(i, assessment));
  if (!usable.length) return null;

  const last = assessment.imports?.at(-1);

  async function onFile(file: File) {
    setError(undefined);
    setDone(undefined);
    setPreview(undefined);
    try {
      const text = await file.text();
      const found = detectImporter(text);
      if (!found) {
        // Nothing recognises it. Let a scanner say why, so the message names the file that was expected.
        for (const i of usable) {
          const mapping = catalogue.imports.get(i.id);
          if (!mapping) continue;
          try {
            i.read(text, mapping);
          } catch (e) {
            throw new Error((e as Error).message);
          }
        }
        throw new Error("this file isn't output from a scanner crownguard can read");
      }
      const mapping = catalogue.imports.get(found.id);
      const reason = unusable(found, assessment);
      if (!mapping || reason) throw new Error(`This is a ${found.label} scan. ${reason ?? "crownguard has no mapping for it"}, so nothing was applied`);
      const result = found.read(text, mapping);
      if (!result.suggestions.length) throw new Error("none of the checks in this scan match a question");
      setPreview(result);
      setPreviewer(found);
      setOverwrite(false);
      setSetLicence(!!result.licence && result.licence !== assessment.licence[found.platform]);
    } catch (e) {
      setError(`Couldn't import that scan: ${(e as Error).message}.`);
    }
  }

  function apply() {
    if (!preview || !previewer) return;
    const n = applyScan(preview, { platform: previewer.platform, overwrite, licence: setLicence });
    setDone(`Imported ${n} answer${n === 1 ? "" : "s"} from the scan of ${preview.tenant}. Each one shows its evidence; check and adjust as needed.`);
    setPreview(undefined);
    setPreviewer(undefined);
  }

  const decisive = preview?.suggestions.filter((s) => s.evidence.suggested) ?? [];
  const counts = (["yes", "partial", "no"] as const).map((a) => [a, decisive.filter((s) => s.evidence.suggested === a).length] as const);
  const undecided = (preview?.suggestions.length ?? 0) - decisive.length;
  const clashes = decisive.filter((s) => assessment.answers[s.question] && assessment.answers[s.question] !== s.evidence.suggested).length;
  const active = new Set(activeQuestions(catalogue, assessment).map((q) => q.id));
  const outOfScope = decisive.filter((s) => !active.has(s.question)).length;
  const willApply = decisive.filter((s) => overwrite || !assessment.answers[s.question]).length;
  const licenceName = previewer && catalogue.platforms.get(previewer.platform)?.platform.licenceTiers.find((t) => t.id === preview?.licence)?.name;

  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-rule bg-surface" aria-label="Import automated scan results">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Already run a scan? Pre-fill answers from it.</p>
          <p className="mt-0.5 text-xs text-muted">
            Optional. Each file is read in your browser only.{" "}
            {usable.map((i, n) => (
              <span key={i.id}>
                {n > 0 && " "}
                <a className="text-accent underline decoration-accent/30 underline-offset-2" href={i.url} target="_blank" rel="noreferrer noopener">
                  {i.label}
                </a>{" "}
                <span className="font-mono">{i.hint}</span> ({catalogue.imports.get(i.id)!.mappings.length} questions)
                {n < usable.length - 1 ? ";" : "."}
              </span>
            ))}
            {last && ` Last import: ${last.tenant}, scanned ${stamp(last.scannedAt)} (${relativeTime(last.importedAt)}).`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {last ? "Import another scan" : "Import scan results"}
        </Button>
        <input
          ref={input}
          type="file"
          accept={usable.map((i) => i.accept).join(",")}
          className="hidden"
          data-testid="scan-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {error && (
        <p role="alert" className="border-t border-rule px-4 py-2.5 text-sm text-danger sm:px-5">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="border-t border-rule bg-ok-soft px-4 py-2.5 text-sm text-ok sm:px-5">
          {done}
        </p>
      )}

      {preview && (
        <div className="space-y-4 border-t border-rule bg-paper p-4 text-sm sm:px-5" data-testid="scan-preview">
          <p className="text-ink">
            Scan of <strong className="font-medium">{preview.tenant}</strong> <span className="font-mono text-xs text-muted">{preview.domain}</span>, run{" "}
            {stamp(preview.scannedAt)}
            {preview.toolVersion ? `, ${preview.tool} ${preview.toolVersion}` : `, ${preview.tool}`}.
          </p>
          {preview.accounts && preview.accounts.length > 1 && (
            <p className="text-xs text-muted">
              Findings from {preview.accounts.length} accounts were combined:{" "}
              {preview.accounts.map((a) => (a.name ? `${a.name} (${a.id})` : a.id)).join(", ")}. Import once per account if you would rather keep them apart.
            </p>
          )}
          {preview.warnings?.map((w) => (
            <p key={w} role="status" className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              {w}
            </p>
          ))}
          <ul className="flex flex-wrap gap-2">
            {counts.map(([a, n]) => (
              <li key={a} className="rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-1.5">
                <span className="font-mono tabular-nums text-ink">{n}</span> <span className="text-muted">{answerLabels[a]}</span>
              </li>
            ))}
            <li className="rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-1.5">
              <span className="font-mono tabular-nums text-ink">{undecided}</span> <span className="text-muted">need your review</span>
            </li>
          </ul>
          <p className="text-xs text-muted">
            Checks marked review, info, unknown or not licensed can't settle a question, so those stay for you to answer.
            {preview.unmapped > 0 && ` ${preview.unmapped} other ${preview.unmapped === 1 ? "check" : "checks"} in the scan ${preview.unmapped === 1 ? "doesn't" : "don't"} map to a question.`}
            {outOfScope > 0 &&
              ` ${outOfScope} ${outOfScope === 1 ? "answer is" : "answers are"} for crown jewels you haven't added; ${outOfScope === 1 ? "it appears" : "they appear"} if you add them.`}
          </p>
          {preview.unmappedFailing.length > 0 && (
            <details>
              <summary className="cursor-pointer font-medium text-ink">
                {preview.unmappedFailing.length} failing {preview.unmappedFailing.length === 1 ? "check" : "checks"} crownguard has no question for
              </summary>
              <p className="mt-2 text-xs text-muted">
                Copy these into your notes if they matter to your environment. They also tell us which mappings to add next.
              </p>
              <textarea
                readOnly
                rows={Math.min(6, preview.unmappedFailing.length)}
                value={preview.unmappedFailing.join("\n")}
                aria-label="Failing checks with no matching question"
                className="mt-2 w-full rounded-[var(--radius-control)] border border-rule bg-surface p-2 font-mono text-xs text-ink"
                onFocus={(e) => e.currentTarget.select()}
              />
            </details>
          )}
          {clashes > 0 && (
            <fieldset>
              <legend className="font-medium text-ink">{clashes} question{clashes === 1 ? " you've" : "s you've"} already answered differently</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                {[
                  [false, "Keep my answers"],
                  [true, "Use the scan's answers"],
                ].map(([v, label]) => (
                  <label key={String(v)} className="inline-flex cursor-pointer items-center gap-2">
                    <input type="radio" name="scan-overwrite" className="accent-[var(--color-accent)]" checked={overwrite === v} onChange={() => setOverwrite(v as boolean)} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {licenceName && preview.licence !== assessment.licence[previewer!.platform] && (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={setLicence} onChange={(e) => setSetLicence(e.target.checked)} />
              <span>
                Set the licence tier to <strong className="font-medium">{licenceName}</strong>, based on the tenant's licences.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} disabled={willApply === 0 && !setLicence}>
              Apply {willApply} answer{willApply === 1 ? "" : "s"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(undefined);
                setPreviewer(undefined);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
