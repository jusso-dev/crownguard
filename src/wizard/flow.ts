import type { Assessment } from "../format/schema";
import type { Mode } from "../format/vocab";

export const stepLabels = {
  org: "Organisation",
  environment: "Environment",
  jewels: "Crown jewels",
  controls: "Controls",
  soc: "SOC maturity",
  "ai-register": "AI register",
  review: "Review",
  branding: "Branding",
  report: "Report",
} as const;
export type StepId = keyof typeof stepLabels;

/**
 * Every version of each flow's step list, oldest first. A saved `progress.step` is an index into the list its
 * `progress.layout` names, so a list is never edited in place: a change adds a new layout at the end.
 */
const layouts: Record<Mode, readonly (readonly StepId[])[]> = {
  full: [
    ["org", "environment", "jewels", "controls", "review", "branding", "report"],
    ["org", "environment", "jewels", "controls", "soc", "review", "branding", "report"],
    ["org", "environment", "jewels", "controls", "soc", "ai-register", "review", "branding", "report"],
  ],
  // The standalone flow arrived with the full flow's layout 3, so its first list is numbered 3 as well.
  "ai-register": [[], [], ["org", "ai-register", "review", "branding", "report"]],
};

/** The current layout number, written beside every saved position. */
export const STEP_LAYOUT = layouts.full.length;

/** Which flow this assessment runs in. Files saved before the standalone flow existed carry no mode and are full. */
export const modeOf = (a: Assessment): Mode => a.mode ?? "full";

export const stepsOf = (mode: Mode = "full"): readonly StepId[] => layouts[mode][STEP_LAYOUT - 1];
/** The step labels for a flow, in order. */
export const stepsFor = (mode: Mode = "full"): readonly string[] => stepsOf(mode).map((id) => stepLabels[id]);
/** Where a step sits in a flow, or -1 when the flow doesn't have it. */
export const stepIndex = (mode: Mode, id: StepId) => stepsOf(mode).indexOf(id);

/** Move a saved position onto the current step list, keeping the user on the same step. */
export function migrateProgress(p: Assessment["progress"], mode: Mode = "full"): Assessment["progress"] {
  if (!p) return p;
  const saved = layouts[mode][(p.layout ?? 1) - 1];
  const id = saved?.[p.step];
  return { ...p, step: id ? Math.max(0, stepIndex(mode, id)) : p.step, layout: STEP_LAYOUT };
}

export const clampStep = (n: number | undefined, mode: Mode = "full") => Math.min(stepsOf(mode).length - 1, Math.max(0, Math.trunc(n ?? 0)));

/** The furthest step that can be entered: a step needs the minimum inputs of the steps before it. */
export function reachableStep(a: Assessment): number {
  const mode = modeOf(a);
  if (!a.org.name.trim()) return 0;
  if (!a.platforms.length && stepIndex(mode, "environment") >= 0) return stepIndex(mode, "environment");
  if (!a.jewels.length && stepIndex(mode, "jewels") >= 0) return stepIndex(mode, "jewels");
  return stepsOf(mode).length - 1;
}

/** The step to show: the saved position, kept inside the step list and no further than `reachableStep`. */
export const currentStep = (a: Assessment) => Math.min(clampStep(a.progress?.step, modeOf(a)), reachableStep(a));
