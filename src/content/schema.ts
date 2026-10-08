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
  /** Supporting pages, such as the guide for each pillar or section the controls come from. */
  sources: z.array(id).default([]),
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
  /** Vendor pages that back the licence tiers and features (edition comparisons, nonprofit offers). */
  sources: z.array(id).default([]),
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

/**
 * Optional SOC maturity module. Its structure (domains, aspects, level names, default targets) follows the SOC-CMM®
 * model; the content files carry their own CC BY-SA 4.0 licence (content/soc/NOTICE.md).
 */
const socLevel = z.object({ level: z.number().int().min(0).max(5), name: z.string().min(3), description: z.string().min(10) });

export const socModelSchema = z
  .object({
    id,
    name: z.string(),
    shortName: z.string(),
    /** Source id of the model this module is aligned to. */
    source: id,
    licence: z.literal("CC BY-SA 4.0"),
    /** Source id of the licence text. */
    licenceSource: id,
    /** Further pages describing the model. */
    sources: z.array(id).default([]),
    /** Version of the SOC-CMM tool the structure was taken from. */
    basisVersion: z.string().regex(/^\d+\.\d+(\.\d+)?$/),
    attribution: z.string().min(40),
    scales: z.object({ maturity: z.array(socLevel).length(6), capability: z.array(socLevel).length(4) }),
    /** Default targets: maturity for every domain, capability for the capability domains. */
    targets: z.object({ maturity: z.number().min(1).max(5), capability: z.number().min(1).max(3) }),
    domains: z
      .array(
        z.object({
          id,
          name: z.string(),
          description: z.string().min(10),
          /** Technology and service aspects can be left out of scoring when the SOC genuinely doesn't need them. */
          scopable: z.boolean().default(false),
          /** Aspects in this domain are also rated for capability (0-3). */
          capability: z.boolean().default(false),
          aspects: z.array(z.object({ id, name: z.string() })).min(1),
        }),
      )
      .length(5),
  })
  .refine((m) => [m.scales.maturity, m.scales.capability].every((scale) => scale.every((l, i) => l.level === i)), "levels must be listed in order from 0");

export const socQuestionSchema = z
  .object({
    id: z.string().regex(/^SOC-(BUS|PPL|PRC|TEC|SVC)-\d{3}$/, "e.g. SOC-BUS-001"),
    aspect: id,
    /** Maturity questions are rated 0-5, capability questions 0-3. */
    kind: z.enum(["maturity", "capability"]).default("maturity"),
    question: z.string().min(10).refine((s) => s.trim().endsWith("?"), "question must end with ?"),
    why: z.string().min(20),
    /** What each level looks like for this question, from level 0 up. */
    levels: z.array(z.string().min(8).max(260)),
    refs: z.array(z.object({ framework: id, ref: z.string().min(1) })).default([]),
  })
  .refine((q) => q.levels.length === (q.kind === "maturity" ? 6 : 4), {
    path: ["levels"],
    message: "maturity questions need 6 levels (0-5), capability questions 4 (0-3)",
  });

export type SocModel = z.infer<typeof socModelSchema>;
export type SocQuestion = z.infer<typeof socQuestionSchema>;

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
  /** The optional SOC maturity module, when its content is present. */
  soc?: { model: SocModel; questions: SocQuestion[] };
}
