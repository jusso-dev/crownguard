import { z } from "zod";
import { version } from "../../package.json";
import { essentialsChapters, exposures, isoDate } from "../content/schema";
import {
  aiAccess,
  aiAutonomy,
  aiCriteria,
  aiData,
  aiDomains,
  aiLifecycles,
  aiRiskRatings,
  aiStandardUse,
  aiTechnologies,
  aiUsagePatterns,
} from "../content/aiOptions";
import {
  answers,
  classifications,
  dsls,
  impactRatings,
  ismBaselines,
  logoBackdrops,
  modes,
  regulations,
  scanStatuses,
  socProviders,
  socRatings,
} from "./vocab";

const keys = <K extends string>(o: Record<K, unknown>) => Object.keys(o) as [K, ...K[]];
/** Notes are capped at NOTE_MAX when typed; longer ones in older files are shortened rather than refused. */
export const NOTE_MAX = 4000;
const note = z
  .string()
  .max(100_000)
  .transform((t) => t.slice(0, NOTE_MAX))
  // The pipe keeps the published JSON Schema honest: a saved note is at most NOTE_MAX, even though a longer one in
  // an older file is shortened on open rather than refused.
  .pipe(z.string().max(NOTE_MAX));
const rating = z.union(impactRatings.map((n) => z.literal(n)));
const regulation = z.enum(keys(regulations));
const answer = z.enum(answers);

/**
 * File format version written into every saved assessment. Files that predate this carry `version: 1` instead and
 * are migrated up on open (see `migrations.ts`). A file with a higher number than this build knows is opened read-only.
 */
export const SCHEMA_VERSION = 5;

/** Version of the app that wrote the file. */
export const APP_VERSION = version;

/** Answers and notes kept for questions this build no longer asks. */
const orphans = z.record(z.string().max(80), z.looseObject({ answer: answer.optional(), note: note.optional() }));

/**
 * Validates imported `.crownguard.json` files before they touch app state.
 *
 * The top level and the `soc` and `aiRegister` blocks are loose objects: a file carrying fields this build has never
 * heard of keeps them (and says so) instead of dropping them on the next save. Every nested record is strict.
 */
export const assessmentSchema = z.looseObject({
  $schema: z.string().max(300).optional(),
  // Legacy marker only. `schemaVersion` replaced it; the migration drops it.
  version: z.literal(1).optional(),
  schemaVersion: z.number().int().min(1).max(100_000).default(SCHEMA_VERSION),
  // "ai-register" for the standalone AI use-case register flow. Absent, and meaning "full", in every older file.
  mode: z.enum(modes).optional(),
  savedBy: z
    .looseObject({
      app: z.string().max(40),
      appVersion: z.string().max(40),
      contentHash: z.string().max(64).optional(),
      savedAt: z.string().max(40),
    })
    .optional(),
  org: z.object({
    name: z.string().max(200),
    abn: z.string().regex(/^\d{0,11}$/).optional(),
    sector: z.string().max(200),
    size: z.string().max(100),
    jurisdiction: z.string().max(100),
    regulations: z.array(regulation),
  }),
  platforms: z.array(z.string().max(50)).max(5),
  modules: z.record(z.string(), z.array(z.string().max(50))),
  licence: z.record(z.string(), z.string().max(50)),
  jewels: z
    .array(
      z.object({
        id: z.string().max(50),
        name: z.string().max(200),
        platform: z.string().max(50),
        assetType: z.string().max(80),
        description: z.string().max(2000),
        classification: z.enum(keys(classifications)),
        dsl: z.enum(keys(dsls)).optional(),
        confidentiality: rating,
        integrity: rating,
        availability: rating,
        regulations: z.array(regulation),
        exposures: z.array(z.enum(keys(exposures))),
        businessProcesses: z.string().max(2000),
      }),
    )
    .max(200),
  answers: z.record(z.string(), answer),
  notes: z.record(z.string(), note),
  orphans: orphans.optional(),
  // Optional ISM baseline shown in the report. Annotates findings and adds a summary count; never changes a score.
  ismBaseline: z.enum(keys(ismBaselines)).optional(),
  // Optional ASD Essentials section in the report. Indicative; sits beside the Essential Eight and changes no score.
  essentials: z.object({ chapter: z.enum(essentialsChapters) }).optional(),
  branding: z.object({
    logoDataUrl: z
      .string()
      // PNG or JPEG only: the PDF renderer can't draw anything else, and the logo field re-encodes uploads as PNG.
      .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/)
      .max(3_000_000)
      .optional(),
    logoBackdrop: z.enum(logoBackdrops).optional(),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    marking: z.string().max(80),
    preparedBy: z.string().max(200),
    preparedFor: z.string().max(200),
  }),
  evidence: z
    .record(
      z.string(),
      z.object({
        source: z.string().max(80),
        tool: z.string().max(80).optional(),
        toolVersion: z.string().max(40).optional(),
        account: z.string().max(300).optional(),
        tenant: z.string().max(300),
        scannedAt: z.string().max(60),
        suggested: answer.optional(),
        checks: z
          .array(
            z.object({
              id: z.string().max(80),
              status: z.enum(scanStatuses),
              setting: z.string().max(500),
              current: z.string().max(2000),
              expected: z.string().max(2000),
              count: z.string().max(200).optional(),
              examples: z.array(z.string().max(300)).max(10).optional(),
            }),
          )
          .max(50),
      }),
    )
    .optional(),
  imports: z
    .array(z.object({ source: z.string().max(80), toolVersion: z.string().max(40).optional(), tenant: z.string().max(300), scannedAt: z.string().max(60), importedAt: z.string().max(60), applied: z.number().int().min(0) }))
    .max(50)
    .optional(),
  soc: z
    .looseObject({
      answers: z.record(z.string().max(20), z.union([...socRatings.map((n) => z.literal(n)), z.literal("unknown")])),
      notes: z.record(z.string().max(20), note).optional(),
      outOfScope: z.array(z.string().max(60)).max(60),
      targets: z
        .record(
          z.string().max(40),
          z.object({ maturity: z.number().min(1).max(5).multipleOf(0.5).optional(), capability: z.number().min(1).max(3).multipleOf(0.5).optional() }),
        )
        .optional(),
      provider: z.enum(keys(socProviders)).optional(),
    })
    .optional(),
  aiRegister: z
    .looseObject({
      createdAt: z.string().max(40).optional(),
      lastSharedWithDta: z.string().max(40).optional(),
      dateConfirmation: z.looseObject({ by: z.string().max(200), on: z.string().max(40) }).optional(),
      entries: z
        .array(
          // Loose like the register itself: register fields follow the DTA's Standard and grow, and an entry must
          // carry them through a re-save in a build that has never heard of them.
          z.looseObject({
            id: z.string().max(60),
            example: z.boolean().optional(),
            foundBy: z.string().max(200).optional(),
            groupOf: z.string().max(200).optional(),
            kind: z.string().max(60),
            name: z.string().max(200),
            reference: z.string().max(100),
            description: z.string().max(4000),
            product: z.string().max(200),
            technology: z.array(z.enum(keys(aiTechnologies))),
            lifecycle: z.enum(keys(aiLifecycles)).optional(),
            technicalStandard: z.enum(keys(aiStandardUse)).optional(),
            domains: z.array(z.enum(keys(aiDomains))),
            usagePatterns: z.array(z.enum(keys(aiUsagePatterns))),
            ownerName: z.string().max(200),
            ownerEmail: z.string().max(254),
            criteria: z.array(z.enum(keys(aiCriteria))),
            inherentRisk: z.enum(keys(aiRiskRatings)).optional(),
            residualRisk: z.enum(keys(aiRiskRatings)).optional(),
            impactAssessmentDate: isoDate.optional(),
            lastReview: isoDate.optional(),
            nextReview: isoDate.optional(),
            autonomy: z.enum(keys(aiAutonomy)).optional(),
            access: z.enum(keys(aiAccess)).optional(),
            data: z.array(z.enum(keys(aiData))),
            jewels: z.array(z.string().max(50)).max(200),
            answers: z.record(z.string().max(20), answer),
            notes: z.record(z.string().max(20), note),
          }),
        )
        .max(200),
    })
    .optional(),
  progress: z
    .object({
      step: z.number().int().min(0).max(20),
      section: z.string().max(120).optional(),
      socSection: z.string().max(60).optional(),
      aiSection: z.string().max(60).optional(),
      layout: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** Every key the schema declares, so unknown ones can be reported rather than ignored. */
export const knownKeys = new Set(Object.keys(assessmentSchema.shape));

/** `path: message`, one per line, for the notices shown when a file won't open. */
export const formatIssues = (issues: { path: PropertyKey[]; message: string }[], max = 5) =>
  issues.slice(0, max).map((i) => `${i.path.length ? i.path.join(".") : "file"}: ${i.message}`);


/** Drops the index signature a loose object adds, so a typo'd field name is a type error rather than an unknown. */
type Declared<T> = T extends readonly (infer U)[]
  ? Declared<U>[]
  : T extends object
    ? keyof { [K in keyof T as string extends K ? never : K]: 1 } extends never
      ? { [K in keyof T]: Declared<T[K]> }
      : { [K in keyof T as string extends K ? never : K]: Declared<T[K]> }
    : T;

/** One assessment, as the app holds it and as a `.crownguard.json` file stores it. */
export type Assessment = Declared<z.output<typeof assessmentSchema>>;
export type OrgProfile = Assessment["org"];
export type CrownJewel = Assessment["jewels"][number];
export type Branding = Assessment["branding"];
/** Automated-scan results attached to a question when an import pre-filled (or tried to pre-fill) it. */
export type Evidence = NonNullable<Assessment["evidence"]>[string];
/** An answer whose question is no longer in the catalogue. Kept, never deleted. */
export type OrphanAnswer = NonNullable<Assessment["orphans"]>[string];
export type AiUseCase = NonNullable<Assessment["aiRegister"]>["entries"][number];
/** Per-domain overrides of the SOC model's default targets. */
export type SocTargets = NonNullable<NonNullable<Assessment["soc"]>["targets"]>;
