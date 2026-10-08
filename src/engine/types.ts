import type { ExposureId } from "../content/schema";

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
  confidentiality: ImpactRating;
  integrity: ImpactRating;
  availability: ImpactRating;
  regulations: Regulation[];
  exposures: ExposureId[];
  businessProcesses: string;
}

export interface OrgProfile {
  name: string;
  sector: string;
  size: string;
  jurisdiction: string;
  regulations: Regulation[];
}

export interface Assessment {
  version: 1;
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
  /** Where the user was, so a reload or an opened file resumes in the same place. */
  progress?: { step: number; section?: string };
  createdAt: string;
  updatedAt: string;
}

export interface Branding {
  logoDataUrl?: string;
  primary: string;
  accent: string;
  marking: string;
  preparedBy: string;
  preparedFor: string;
}
