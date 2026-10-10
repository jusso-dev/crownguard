import type { ExposureId } from "../content/schema";
import type { SocAnswer, SocProvider, SocTargets } from "./soc";
import type { AiAccess, AiAutonomy, AiCriterion, AiDataKind, AiDomain, AiLifecycle, AiRiskRating, AiStandardUse, AiTechnology, AiUsagePattern } from "./aiOptions";

export type Answer = "yes" | "partial" | "no" | "unknown" | "na";

export const answerLabels: Record<Answer, string> = {
  yes: "Yes",
  partial: "Partial",
  no: "No",
  unknown: "Unknown",
  na: "N/A",
};

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

export type ImpactRating = 1 | 2 | 3 | 4 | 5;

export interface CrownJewel {
  id: string;
  name: string;
  platform: string;
  assetType: string;
  description: string;
  classification: Classification;
  /** IDCF Data Security Level chosen by the data owner, if the organisation uses the IDCF. */
  dsl?: Dsl;
  confidentiality: ImpactRating;
  integrity: ImpactRating;
  availability: ImpactRating;
  regulations: Regulation[];
  exposures: ExposureId[];
  businessProcesses: string;
}

export interface OrgProfile {
  name: string;
  /** Australian Business Number, digits only. Optional. */
  abn?: string;
  sector: string;
  size: string;
  jurisdiction: string;
  regulations: Regulation[];
}

export type ScanStatus = "pass" | "fail" | "warning" | "review" | "info" | "unknown" | "notlicensed";

/** Automated-scan results attached to a question when an import pre-filled (or tried to pre-fill) it. */
export interface Evidence {
  /** Mapping the evidence came from, e.g. "Prowler (AWS)". */
  source: string;
  /** Scanner that produced the file, and its version, e.g. "Prowler" and "5.44.0". */
  tool?: string;
  toolVersion?: string;
  /** Account, subscription or tenant the findings were taken from. */
  account?: string;
  tenant: string;
  scannedAt: string;
  /** The answer the scan suggested, if its results were decisive. */
  suggested?: Answer;
  checks: {
    id: string;
    status: ScanStatus;
    setting: string;
    current: string;
    expected: string;
    /** For checks reported once per resource: "3 of 41 resources fail". */
    count?: string;
    /** A few of the resources behind that count. */
    examples?: string[];
  }[];
}

export interface ImportRecord {
  /** Scanner that produced the file, e.g. "Prowler (AWS)". */
  source: string;
  toolVersion?: string;
  tenant: string;
  scannedAt: string;
  importedAt: string;
  /** Answers the import set. */
  applied: number;
}

/** Who wrote the file and when, for support and debugging. */
export interface SavedBy {
  app: string;
  appVersion: string;
  /** Digest of the question and framework catalogue the file was saved against. */
  contentHash?: string;
  savedAt: string;
}

/** An answer whose question is no longer in the catalogue. Kept, never deleted. */
export interface OrphanAnswer {
  answer?: Answer;
  note?: string;
}

export interface Assessment {
  /** JSON Schema this file follows, so editors and other tools can validate it. Written on save. */
  $schema?: string;
  /** File format version, from 2. Files written before that only carried `version: 1`. */
  schemaVersion: number;
  /** Present in files written before schema 2, where it was the only version marker. */
  version?: 1;
  savedBy?: SavedBy;
  org: OrgProfile;
  /** Selected platform ids, e.g. ["microsoft"]. */
  platforms: string[];
  /** Enabled optional module ids per platform. */
  modules: Record<string, string[]>;
  /** Licence tier id per platform. */
  licence: Record<string, string>;
  jewels: CrownJewel[];
  answers: Record<string, Answer>;
  notes: Record<string, string>;
  branding: Branding;
  /** Scan evidence per question id, from optional automated imports. */
  evidence?: Record<string, Evidence>;
  imports?: ImportRecord[];
  /** Answers and notes whose question is no longer in this build's catalogue. Kept so nothing is lost. */
  orphans?: Record<string, OrphanAnswer>;
  /** Optional SOC maturity self-assessment; present when the user includes it. */
  soc?: { answers: Record<string, SocAnswer>; notes?: Record<string, string>; outOfScope: string[]; targets?: SocTargets; provider?: SocProvider };
  /**
   * Optional AI use-case register; present when the user starts one. `createdAt` is when the register itself was
   * first started, which is what the DTA's six-monthly sharing clock runs from.
   */
  aiRegister?: {
    entries: AiUseCase[];
    createdAt?: string;
    /** When the register was last shared with the DTA, so the next share can be calculated. */
    lastSharedWithDta?: string;
    /** Who confirmed the worked-out dates in the register, and when. */
    dateConfirmation?: { by: string; on: string };
  };
  /** Where the user was, so a reload or an opened file resumes in the same place. `layout` is the step list version. */
  progress?: { step: number; section?: string; socSection?: string; aiSection?: string; layout?: number };
  createdAt: string;
  updatedAt: string;
}

/**
 * One entry in the AI use-case register. The register fields follow the DTA's Standard for accountability; autonomy,
 * access, data handled and linked crown jewels are crownguard's additions.
 */
export interface AiUseCase {
  id: string;
  /** Added by "Load example entries": labelled as example data everywhere it appears. */
  example?: boolean;
  /** Preset from content/ai-register/model.yaml, e.g. "m365-copilot". */
  kind: string;
  name: string;
  /** Agency identifier (reference number). */
  reference: string;
  /**
   * Set when this entry is one part of a broader general-purpose AI, naming that parent. The DTA's Appendix B lets an
   * agency register Copilot as one use case or several; this records which approach it took.
   */
  groupOf?: string;
  description: string;
  /** The underpinning product's name, part of the description field in the Standard. */
  product: string;
  technology: AiTechnology[];
  lifecycle?: AiLifecycle;
  technicalStandard?: AiStandardUse;
  domains: AiDomain[];
  usagePatterns: AiUsagePattern[];
  ownerName: string;
  ownerEmail: string;
  /** Appendix C criteria met. Empty means not yet worked out; ["none"] means none apply. */
  criteria: AiCriterion[];
  inherentRisk?: AiRiskRating;
  residualRisk?: AiRiskRating;
  /** YYYY-MM-DD dates. Review dates are register fields only for a high inherent risk. */
  impactAssessmentDate?: string;
  lastReview?: string;
  nextReview?: string;
  autonomy?: AiAutonomy;
  access?: AiAccess;
  data: AiDataKind[];
  /** Crown jewel ids the AI can reach. */
  jewels: string[];
  answers: Record<string, Answer>;
  notes: Record<string, string>;
}

export interface Branding {
  logoDataUrl?: string;
  /** Panel behind the logo on the cover. "white" helps transparent logos that would vanish on the cover colour. */
  logoBackdrop?: "none" | "white";
  primary: string;
  accent: string;
  marking: string;
  preparedBy: string;
  preparedFor: string;
}
