import { catalogue, ensureReportContent } from "../content/catalogue";
import { useEnsurePlatforms, useEnsureReportContent } from "../content/useCatalogue";
import { activeQuestions, effectiveAnswers } from "../engine/risk";
import { ismBaselineReport, ismBaselines, type IsmBaseline, type IsmBaselineSummary } from "../engine/ism";
import { useStore } from "./store";
import { Card, Field, inputClass } from "./ui";

/** The summary behind the annotation, when a baseline is picked. */
export function useIsmSummary(): IsmBaselineSummary | undefined {
  const assessment = useStore((s) => s.assessment);
  const platformsReady = useEnsurePlatforms(assessment.platforms);
  const reportReady = useEnsureReportContent();
  if (!assessment.ismBaseline || !platformsReady || !reportReady) return undefined;
  return ismBaselineReport(catalogue, activeQuestions(catalogue, assessment), effectiveAnswers(assessment), assessment.ismBaseline);
}

/** Optional "Show ISM baseline" picker. Annotation only: it never changes a score. */
export function IsmBaselinePicker() {
  const assessment = useStore((s) => s.assessment);
  const update = useStore((s) => s.update);
  if (!catalogue.frameworks.has("ism")) return null;
  return (
    <Field label="Show ISM baseline" hint="Marks which open findings touch the controls this baseline includes. It never changes scores.">
      <select
        className={inputClass}
        value={assessment.ismBaseline ?? ""}
        aria-label="Show ISM baseline"
        onChange={(e) => {
          const value = e.target.value ? (e.target.value as IsmBaseline) : undefined;
          if (value) void ensureReportContent();
          update(() => ({ ismBaseline: value }));
        }}
      >
        <option value="">No ISM baseline</option>
        {Object.entries(ismBaselines).map(([key, b]) => (
          <option key={key} value={key}>
            {b.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The review step's ISM card: the picker and, when one is picked, how much of the report it touches. */
export function IsmBaselineCard() {
  const summary = useIsmSummary();
  if (!catalogue.frameworks.has("ism")) return null;
  return (
    <Card className="mt-4" data-testid="ism-baseline">
      <h2 className="text-base font-semibold">Information Security Manual (ISM) baseline</h2>
      <p className="mt-1 max-w-[68ch] text-xs text-muted">
        Optional. Show which open findings relate to the controls in an ISM baseline, for conversations with assessors.
        It annotates the report only; your scores don&apos;t change.
      </p>
      <div className="mt-4 max-w-md">
        <IsmBaselinePicker />
      </div>
      {summary && (
        <p className="mt-3 text-sm text-ink-2" role="status">
          {summary.findings.length} of {summary.totalFindings} open finding{summary.totalFindings === 1 ? "" : "s"} touch controls in the{" "}
          {summary.label} baseline, across {summary.controls} ISM control{summary.controls === 1 ? "" : "s"}.
        </p>
      )}
    </Card>
  );
}
