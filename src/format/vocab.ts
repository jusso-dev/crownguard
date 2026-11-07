import { z } from "zod";

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
/** An answer's label, or "Unanswered". */
export const answerText = (a: Answer | undefined) => (a ? answerLabels[a] : "Unanswered");

/** A YYYY-MM-DD date as "15 September 2026", read as a calendar day so the time zone never shifts it. */
export const dayText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** Full timestamp with time zone, e.g. "8 October 2026 at 5:42 pm AEDT". */
export const stampText = (d: Date) =>
  d.toLocaleString("en-AU", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

/** "a, b and c", the en-AU way (no serial comma). */
export const andList = (items: string[]) => new Intl.ListFormat("en-AU", { type: "conjunction" }).format(items);
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

/** The top of each SOC-CMM scale. Ratings run from 0; targets from 1. */
export const socScaleTop = { maturity: 5, capability: 3 } as const;
export type SocScale = keyof typeof socScaleTop;

/** A rating against a SOC question's level descriptions: 0 to the top of its scale. */
export type SocRating = 0 | 1 | 2 | 3 | 4 | 5;
export const socRatings = Array.from({ length: socScaleTop.maturity + 1 }, (_, i) => i as SocRating);
export type SocAnswer = SocRating | "unknown";

/** Who runs the organisation's security operations. */
export const socProviders = {
  "in-house": "In house",
  outsourced: "Managed provider (MSSP or MDR)",
  hybrid: "Hybrid (in house and a provider)",
  none: "We don't have a SOC",
} as const;
export type SocProvider = keyof typeof socProviders;

export const exposures = {
  "external-sharing": "Content can be shared with people outside the organisation",
  "guest-access": "Guest or external accounts have access",
  "internet-facing": "Reachable from the internet without a trusted network or device",
  "standing-admin": "Administrators hold permanent (not just-in-time) privileges",
  "third-party-apps": "Third-party apps or integrations hold delegated or application access",
  "unmanaged-devices": "Accessible from unmanaged or personal devices",
  "ai-grounding": "Indexed by an AI assistant (Copilot / Gemini) that answers users' questions",
} as const;
export type ExposureId = keyof typeof exposures;

/** The two chapters of ASD's Essentials an assessment can be reported against. */
export const essentialsChapters = ["enterprise-it", "cloud"] as const;
export type EssentialsChapter = (typeof essentialsChapters)[number];
/** The prefix ASD puts on each chapter's action ids, e.g. IT.PRO-13.4 and CL.GOV-01.x1. */
export const essentialsActionPrefix = { "enterprise-it": "IT", cloud: "CL" } as const satisfies Record<EssentialsChapter, string>;

/** A `YYYY-MM-DD` calendar date. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isoDate = z.string().regex(ISO_DATE, "YYYY-MM-DD");
