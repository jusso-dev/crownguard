/**
 * The closed value lists a saved assessment uses, each with its display label. The file schema, the engine and the
 * UI all derive their enums and types from these, so adding a value is one edit here (plus a schema version bump
 * when an older build would refuse it, see `migrations.ts`).
 */

export const answerLabels = {
  yes: "Yes",
  partial: "Partial",
  no: "No",
  unknown: "Unknown",
  na: "N/A",
} as const;
export type Answer = keyof typeof answerLabels;
/** In the order the answer buttons show them. */
export const answers = Object.keys(answerLabels) as Answer[];

/**
 * Which flow an assessment runs in: the full crown-jewel assessment, or the standalone AI use-case register with its
 * own short wizard and its own PDF. Saved files from before this existed carry no `mode` and mean "full".
 */
export const modes = ["full", "ai-register"] as const;
export type Mode = (typeof modes)[number];

export const classifications = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  "highly-confidential": "Highly confidential",
} as const;
export type Classification = keyof typeof classifications;

/**
 * Data Security Levels from the Home Affairs Industry Data Classification Framework (IDCF). Optional per crown jewel:
 * a missing level means "not classified under the IDCF", never DSL-0.
 */
export const dsls = { "dsl-0": "DSL-0", "dsl-1": "DSL-1", "dsl-2": "DSL-2", "dsl-3": "DSL-3", "dsl-4": "DSL-4", "dsl-5-plus": "DSL-5+" } as const;
export type Dsl = keyof typeof dsls;

export const regulations = {
  "privacy-act": "Privacy Act 1988 / Notifiable Data Breaches",
  soci: "SOCI Act (critical infrastructure)",
  "cps-234": "APRA CPS 234",
  pci: "PCI DSS",
  gdpr: "GDPR",
  hipaa: "HIPAA",
  other: "Other regulatory or contractual obligation",
} as const;
export type Regulation = keyof typeof regulations;

/** Confidentiality, integrity and availability impact, 1 (minimal) to 5 (severe). */
export const impactRatings = [1, 2, 3, 4, 5] as const;
export type ImpactRating = (typeof impactRatings)[number];

export const scanStatuses = ["pass", "fail", "warning", "review", "info", "unknown", "notlicensed"] as const;
export type ScanStatus = (typeof scanStatuses)[number];

/** Panel behind the logo on the cover. "white" helps transparent logos that would vanish on the cover colour. */
export const logoBackdrops = ["none", "white"] as const;
export type LogoBackdrop = (typeof logoBackdrops)[number];

/**
 * The ISM baselines an assessor can annotate a report with, matching ASD's OSCAL baseline profiles. Each maps to the
 * ISM's own `applicability` code on every control in `content/frameworks/ism.yaml`. Annotation only: choosing a
 * baseline never changes a score, it marks which findings touch controls the baseline includes.
 */
export const ismBaselines = {
  NON_CLASSIFIED: { label: "NON_CLASSIFIED", applicability: "NC" },
  OFFICIAL_SENSITIVE: { label: "OFFICIAL: Sensitive", applicability: "OS" },
  PROTECTED: { label: "PROTECTED", applicability: "P" },
} as const;
export type IsmBaseline = keyof typeof ismBaselines;

/** A rating against a SOC question's level descriptions: 0-5 for maturity, 0-3 for capability. */
export const socRatings = [0, 1, 2, 3, 4, 5] as const;
export type SocRating = (typeof socRatings)[number];
export type SocAnswer = SocRating | "unknown";

/** Who runs the organisation's security operations. */
export const socProviders = {
  "in-house": "In house",
  outsourced: "Managed provider (MSSP or MDR)",
  hybrid: "Hybrid (in house and a provider)",
  none: "We don't have a SOC",
} as const;
export type SocProvider = keyof typeof socProviders;
