import { catalogue, ensureReportContent } from "../content/catalogue";
import { useEnsurePlatforms, useEnsureReportContent } from "../content/useCatalogue";
import type { EssentialsChapter } from "../content/schema";
import { essentials, type EssentialsResult } from "../engine/essentials";
import { activeQuestions, effectiveAnswers } from "../engine/risk";
import { useStore } from "./store";
import { Card, Field, inputClass } from "./ui";

const chapters: Record<EssentialsChapter, { label: string; hint: string }> = {
  "enterprise-it": { label: "Enterprise IT", hint: "For most organisations. Uses ASD's published action IDs." },
  cloud: { label: "Cloud (SaaS and PaaS only)", hint: "For organisations running entirely on SaaS and PaaS. ASD hasn't published IDs for this chapter, so its IDs are provisional." },
};

const frameworkFor = (chapter: EssentialsChapter) => catalogue.frameworks.get(`asd-essentials-${chapter}`);
const available = () => (Object.keys(chapters) as EssentialsChapter[]).filter((c) => frameworkFor(c)?.essentials);

/** The indicative result behind the review card, when a chapter is chosen and the full content has loaded. */
export function useEssentialsSummary(): EssentialsResult | undefined {
  const assessment = useStore((s) => s.assessment);
  const platformsReady = useEnsurePlatforms(assessment.platforms);
  const reportReady = useEnsureReportContent();
  const framework = assessment.essentials && frameworkFor(assessment.essentials.chapter);
  if (!framework?.essentials || !framework.controls.length || !platformsReady || !reportReady) return undefined;
  return essentials(framework, activeQuestions(catalogue, assessment), effectiveAnswers(assessment));
}

/** Optional "Show ASD Essentials" picker. It adds a report section and never changes a score. */
export function EssentialsPicker() {
  const assessment = useStore((s) => s.assessment);
  const update = useStore((s) => s.update);
  const options = available();
  if (!options.length) return null;
  const chosen = assessment.essentials?.chapter;
  return (
    <Field
      label="Show ASD Essentials"
      hint={chosen ? chapters[chosen].hint : "Adds indicative Essentials ratings by domain beside the Essential Eight. Scores don't change."}
    >
      <select
        className={inputClass}
        value={chosen ?? "none"}
        aria-label="Show ASD Essentials"
        onChange={(e) => {
          const value = e.target.value === "none" ? undefined : (e.target.value as EssentialsChapter);
          if (value) void ensureReportContent();
          update(() => ({ essentials: value ? { chapter: value } : undefined }));
        }}
      >
        <option value="none">Don&apos;t show the Essentials</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {chapters[c].label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** The review step's Essentials card: the picker and, when a chapter is chosen, the phase 1 domains at a glance. */
export function EssentialsCard() {
  const summary = useEssentialsSummary();
  if (!available().length) return null;
  const phase1 = summary?.domains.filter((d) => d.type === "technical" && d.phases.includes(1)) ?? [];
  return (
    <Card className="mt-4" data-testid="essentials">
      <h2 className="text-base font-semibold">ASD Essentials (indicative)</h2>
      <p className="mt-1 max-w-[68ch] text-xs text-muted">
        Optional. ASD&apos;s Essentials sits beside the Essential Eight during the transition. The report rates each domain from the questions tagged
        with each Essentials action. It never converts maturity levels, and your scores don&apos;t change.
      </p>
      <div className="mt-4 max-w-md">
        <EssentialsPicker />
      </div>
      {summary && (
        <p className="mt-3 text-sm text-ink-2" role="status">
          Priority phase 1:{" "}
          {phase1.map((d) => `${d.name} ${d.percentage === null ? "not assessed" : `${d.percentage}% effective`}`).join(", ")}. {summary.tagged} questions in scope give
          Essentials evidence.
        </p>
      )}
    </Card>
  );
}
