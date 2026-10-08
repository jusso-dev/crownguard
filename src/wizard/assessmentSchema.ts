import { z } from "zod";
import { exposures, type ExposureId } from "../content/schema";
import { socProviders, type SocProvider } from "../engine/soc";
import { classifications, dsls, regulations, type Assessment, type Classification, type Dsl, type Regulation } from "../engine/types";

const keys = <K extends string>(o: Record<K, unknown>) => Object.keys(o) as [K, ...K[]];
/** Notes are capped at NOTE_MAX when typed; longer ones in older files are shortened rather than refused. */
export const NOTE_MAX = 4000;
const note = z
  .string()
  .max(100_000)
  .transform((t) => t.slice(0, NOTE_MAX));
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const regulation = z.enum(keys<Regulation>(regulations));

/** Validates imported `.crownguard.json` files before they touch app state. */
export const assessmentSchema = z.object({
  version: z.literal(1),
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
        classification: z.enum(keys<Classification>(classifications)),
        dsl: z.enum(keys<Dsl>(dsls)).optional(),
        confidentiality: rating,
        integrity: rating,
        availability: rating,
        regulations: z.array(regulation),
        exposures: z.array(z.enum(keys<ExposureId>(exposures))),
        businessProcesses: z.string().max(2000),
      }),
    )
    .max(200),
  answers: z.record(z.string(), z.enum(["yes", "partial", "no", "unknown", "na"])),
  notes: z.record(z.string(), note),
  branding: z.object({
    logoDataUrl: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .max(3_000_000)
      .optional(),
    logoBackdrop: z.enum(["none", "white"]).optional(),
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
        tenant: z.string().max(300),
        scannedAt: z.string().max(60),
        suggested: z.enum(["yes", "partial", "no", "unknown", "na"]).optional(),
        checks: z
          .array(
            z.object({
              id: z.string().max(80),
              status: z.enum(["pass", "fail", "warning", "review", "info", "unknown", "notlicensed"]),
              setting: z.string().max(500),
              current: z.string().max(2000),
              expected: z.string().max(2000),
            }),
          )
          .max(50),
      }),
    )
    .optional(),
  imports: z
    .array(z.object({ source: z.string().max(80), tenant: z.string().max(300), scannedAt: z.string().max(60), importedAt: z.string().max(60), applied: z.number().int().min(0) }))
    .max(50)
    .optional(),
  soc: z
    .object({
      answers: z.record(z.string().max(20), z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal("unknown")])),
      notes: z.record(z.string().max(20), note).optional(),
      outOfScope: z.array(z.string().max(60)).max(60),
      targets: z
        .record(
          z.string().max(40),
          z.object({ maturity: z.number().min(1).max(5).multipleOf(0.5).optional(), capability: z.number().min(1).max(3).multipleOf(0.5).optional() }),
        )
        .optional(),
      provider: z.enum(keys<SocProvider>(socProviders)).optional(),
    })
    .optional(),
  progress: z
    .object({
      step: z.number().int().min(0).max(20),
      section: z.string().max(120).optional(),
      socSection: z.string().max(60).optional(),
      layout: z.number().int().min(1).max(20).optional(),
    })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Assessment>;
