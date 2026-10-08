import { z } from "zod";
import { exposures, type ExposureId } from "../content/schema";
import { classifications, regulations, type Assessment, type Classification, type Regulation } from "../engine/types";

const keys = <K extends string>(o: Record<K, unknown>) => Object.keys(o) as [K, ...K[]];
const rating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const regulation = z.enum(keys<Regulation>(regulations));

/** Validates imported `.crownguard.json` files before they touch app state. */
export const assessmentSchema = z.object({
  version: z.literal(1),
  org: z.object({
    name: z.string().max(200),
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
  notes: z.record(z.string(), z.string().max(4000)),
  branding: z.object({
    logoDataUrl: z
      .string()
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
      .max(3_000_000)
      .optional(),
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    marking: z.string().max(80),
    preparedBy: z.string().max(200),
    preparedFor: z.string().max(200),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Assessment>;
