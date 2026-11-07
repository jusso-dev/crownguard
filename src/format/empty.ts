import { SCHEMA_VERSION, type Assessment } from "./schema";

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
    createdAt: now,
    updatedAt: now,
  };
};
