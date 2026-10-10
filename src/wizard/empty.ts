import type { Assessment } from "../engine/types";
import { SCHEMA_VERSION } from "./assessmentSchema";

/** Version of the step list. Layout 2 added "SOC maturity" after Controls; layout 3 added "AI register" after it. */
export const STEP_LAYOUT = 3;

/** A blank assessment the schema accepts: current `schemaVersion`, empty org, no platforms. */
export const emptyAssessment = (): Assessment => {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    org: { name: "", sector: "", size: "", jurisdiction: "Australia", regulations: [] },
    platforms: [],
    modules: {},
    licence: {},
    jewels: [],
    answers: {},
    notes: {},
    branding: { primary: "#1f3a5f", accent: "#d97706", marking: "OFFICIAL: Sensitive", preparedBy: "", preparedFor: "" },
    progress: { step: 0, layout: STEP_LAYOUT },
    createdAt: now,
    updatedAt: now,
  };
};
