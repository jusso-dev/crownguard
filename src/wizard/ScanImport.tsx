import { useRef, useState } from "react";
import { catalogue } from "../content/catalogue";
import { activeQuestions } from "../engine/risk";
import { answerLabels, type ScanStatus } from "../engine/types";
import { readScan, scanSchema, type ScanResult } from "../imports/m365Secure";
import { useStore } from "./store";
import { relativeTime } from "./time";
import { Button } from "./ui";

const PLATFORM = "microsoft";

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

/** Optional: pre-fill Microsoft answers from an M365-Secure scan (its `_Assessment-Results_<domain>.json`). */
export function ScanImport() {
  const assessment = useStore((s) => s.assessment);
  const applyScan = useStore((s) => s.applyScan);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ScanResult>();
  const [error, setError] = useState<string>();
  const [overwrite, setOverwrite] = useState(false);
  const [setLicence, setSetLicence] = useState(true);
  const [done, setDone] = useState<string>();
  const mapping = catalogue.imports.get("m365-secure");
  if (!mapping || !assessment.platforms.includes(PLATFORM)) return null;

  const platform = catalogue.platforms.get(PLATFORM)!.platform;
  const last = assessment.imports?.at(-1);

  async function onFile(file: File) {
    setError(undefined);
    setDone(undefined);
    try {
      const parsed = scanSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("this doesn't look like an M365-Secure results file (_Assessment-Results_<domain>.json)");
      const result = readScan(parsed.data, mapping!);
      if (!result.suggestions.length) throw new Error("none of the checks in this scan match a question");
      setPreview(result);
      setOverwrite(false);
      setSetLicence(!!result.licence && result.licence !== assessment.licence[PLATFORM]);
    } catch (e) {
      setError(`Couldn't import that scan: ${(e as Error).message}.`);
    }
  }

  function apply() {
    if (!preview) return;
    const n = applyScan(preview, { platform: PLATFORM, overwrite, licence: setLicence });
    setDone(`Imported ${n} answer${n === 1 ? "" : "s"} from the scan of ${preview.tenant}. Each one shows its evidence; check and adjust as needed.`);
    setPreview(undefined);
  }

  const decisive = preview?.suggestions.filter((s) => s.evidence.suggested) ?? [];
  const counts = (["yes", "partial", "no"] as const).map((a) => [a, decisive.filter((s) => s.evidence.suggested === a).length] as const);
  const undecided = (preview?.suggestions.length ?? 0) - decisive.length;
  const clashes = decisive.filter((s) => assessment.answers[s.question] && assessment.answers[s.question] !== s.evidence.suggested).length;
  const active = new Set(activeQuestions(catalogue, assessment).map((q) => q.id));
  const outOfScope = decisive.filter((s) => !active.has(s.question)).length;
  const willApply = decisive.filter((s) => overwrite || !assessment.answers[s.question]).length;
  const licenceName = platform.licenceTiers.find((t) => t.id === preview?.licence)?.name;

  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-rule bg-surface" aria-label="Import automated scan results">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Have an M365-Secure scan? Pre-fill answers from it.</p>
          <p className="mt-0.5 text-xs text-muted">
            Optional. Open the <span className="font-mono">_Assessment-Results_&lt;domain&gt;.json</span> file from{" "}
            <a className="text-accent underline decoration-accent/30 underline-offset-2" href={mapping.url} target="_blank" rel="noreferrer noopener">
              M365-Secure
            </a>
            . It's read in your browser only. {mapping.mappings.length} questions can be answered from it.
            {last && ` Last import: ${last.tenant}, scanned ${stamp(last.scannedAt)} (${relativeTime(last.importedAt)}).`}
          </p>
        </div>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          {last ? "Import another scan" : "Import scan results"}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
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
            {stamp(preview.scannedAt)}.
          </p>
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
          {licenceName && preview.licence !== assessment.licence[PLATFORM] && (
            <label className="flex cursor-pointer items-start gap-2">
              <input type="checkbox" className="mt-1 accent-[var(--color-accent)]" checked={setLicence} onChange={(e) => setSetLicence(e.target.checked)} />
              <span>
                Set the licence tier to <strong className="font-medium">{licenceName}</strong>, based on the tenant's licences.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} disabled={willApply === 0 && !setLicence}>Apply {willApply} answer{willApply === 1 ? "" : "s"}</Button>
            <Button variant="ghost" onClick={() => setPreview(undefined)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
