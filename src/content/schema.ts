import { z } from "zod";

const id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase kebab-case id");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const sourceSchema = z.object({
  id,
  title: z.string().min(3),
  publisher: z.string().min(2),
  url: z.url(),
  retrieved: date,
});

export const frameworkSchema = z.object({
  id,
  name: z.string(),
  shortName: z.string(),
  publisher: z.string(),
  source: id,
  // When true, every question ref to this framework must match a control id below.
  closed: z.boolean().default(true),
  note: z.string().optional(),
  controls: z
    .array(z.object({ id: z.string().min(1), title: z.string().min(2), group: z.string().optional() }))
    .default([]),
});

export const tiers = ["identity", "privileged", "data", "collaboration", "endpoint", "cloud", "ai"] as const;

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
const exposureId = z.enum(Object.keys(exposures) as [ExposureId, ...ExposureId[]]);

export const platformSchema = z.object({
  id,
  name: z.string(),
  vendor: z.string(),
  description: z.string(),
  modules: z.array(z.object({ id, name: z.string(), description: z.string(), optional: z.boolean() })).min(1),
  licenceTiers: z
    .array(z.object({ id, name: z.string(), features: z.array(id) }))
    .min(1),
  licenceFeatures: z.array(z.object({ id, name: z.string() })),
  domains: z.array(z.object({ id, name: z.string(), description: z.string() })).min(1),
});

export const assetTypeSchema = z.object({
  id,
  module: id,
  tier: z.enum(tiers),
  name: z.string(),
  description: z.string(),
  examples: z.array(z.string()).min(1),
  discoveryPrompts: z.array(z.string()).min(1),
  exposures: z.array(exposureId),
  threats: z.array(z.object({ technique: z.string().regex(/^T\d{4}(\.\d{3})?$/), name: z.string() })).min(1),
});

export const severities = { critical: 4, high: 3, medium: 2, low: 1 } as const;
export type Severity = keyof typeof severities;

export const e8Strategies = [
  "application-control",
  "patch-applications",
  "office-macros",
  "user-application-hardening",
  "restrict-admin-privileges",
  "patch-operating-systems",
  "mfa",
  "regular-backups",
] as const;
export type E8Strategy = (typeof e8Strategies)[number];

export const questionSchema = z.object({
  id: z.string().regex(/^[A-Z]{2,4}-[A-Z]{2,5}-\d{3}$/, "e.g. MS-ID-001"),
  module: id,
  domain: id,
  appliesTo: z.array(z.union([id, z.literal("*")])).min(1),
  severity: z.enum(Object.keys(severities) as [Severity, ...Severity[]]),
  question: z.string().min(10).refine((s) => s.trim().endsWith("?"), "question must end with ?"),
  why: z.string().min(20),
  yesLooksLike: z.string().min(10),
  remediation: z.string().min(20),
  effort: z.enum(["S", "M", "L"]),
  licence: z.array(id).default([]),
  sources: z.array(id).min(1),
  refs: z.array(z.object({ framework: id, ref: z.string().min(1) })).default([]),
  e8: z.array(z.object({ strategy: z.enum(e8Strategies), level: z.union([z.literal(1), z.literal(2), z.literal(3)]) })).default([]),
});

/** Maps an automated scanner's check ids to questions, so its results can pre-fill answers. */
export const importMappingSchema = z.object({
  id,
  name: z.string(),
  platform: id,
  url: z.url(),
  mappings: z
    .array(
      z.object({
        question: z.string(),
        checks: z.array(z.string().min(1)).min(1),
        rationale: z.string().min(5),
        /** "partial": the checks cover only part of the question, so a pass gives Partial, not Yes. */
        cap: z.literal("partial").optional(),
        /** The checks have known false fails, so a fail sends the question to review instead of No. */
        failIsInconclusive: z.boolean().optional(),
      }),
    )
    .min(1),
});
export type ImportMapping = z.infer<typeof importMappingSchema>;

export const questionFileSchema = z.array(questionSchema);
export const assetFileSchema = z.array(assetTypeSchema);
export const sourceFileSchema = z.array(sourceSchema);

export type Source = z.infer<typeof sourceSchema>;
export type Framework = z.infer<typeof frameworkSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type AssetType = z.infer<typeof assetTypeSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Tier = (typeof tiers)[number];

export interface PlatformBundle {
  platform: Platform;
  assetTypes: AssetType[];
  questions: Question[];
}

export interface Catalogue {
  sources: Map<string, Source>;
  frameworks: Map<string, Framework>;
  platforms: Map<string, PlatformBundle>;
  imports: Map<string, ImportMapping>;
}
