/**
 * The subset of NIST OSCAL that ASD's ISM catalog uses: catalog metadata, nested groups, controls, props and parts.
 *
 * The objects we read are strict: a shape change in ASD's `ISM_catalog.json` (a new key on a group, control, prop or
 * part) fails the parse, so `scripts/ism/build.ts` stops and a human reviews the release rather than silently
 * dropping or misreading something. Metadata siblings we only quote (parties, links) and `back-matter` stay loose.
 */
import { z } from "zod";

export interface OscalProp {
  name: string;
  /** Namespace URI, e.g. `https://cyber.gov.au/ns/ism/oscal/3.0` for the ISM's own props. */
  ns?: string;
  class?: string;
  value: string;
}

export interface OscalPart {
  id?: string;
  name: string;
  prose?: string;
  parts?: OscalPart[];
}

export interface OscalControl {
  id: string;
  class?: string;
  /** OSCAL titles controls "Control: ism-1504"; the text lives in the statement part. */
  title?: string;
  props?: OscalProp[];
  parts?: OscalPart[];
  /** OSCAL allows controls to nest; the ISM has never used it, but a release could. */
  controls?: OscalControl[];
}

export interface OscalGroup {
  title: string;
  props?: OscalProp[];
  parts?: OscalPart[];
  controls?: OscalControl[];
  groups?: OscalGroup[];
}

export interface OscalCatalogFile {
  catalog: {
    uuid: string;
    metadata: {
      title: string;
      published: string;
      "last-modified": string;
      version: string;
      "oscal-version": string;
    };
    groups: OscalGroup[];
    "back-matter"?: unknown;
  };
}

export const oscalPropSchema: z.ZodType<OscalProp> = z.strictObject({
  name: z.string().min(1),
  ns: z.string().optional(),
  class: z.string().optional(),
  value: z.string().min(1),
});

export const oscalPartSchema: z.ZodType<OscalPart> = z.lazy(() =>
  z.strictObject({
    id: z.string().optional(),
    name: z.string().min(1),
    prose: z.string().optional(),
    parts: z.array(oscalPartSchema).optional(),
  }),
);

export const oscalControlSchema: z.ZodType<OscalControl> = z.lazy(() =>
  z.strictObject({
    id: z.string().min(1),
    class: z.string().optional(),
    title: z.string().optional(),
    props: z.array(oscalPropSchema).optional(),
    parts: z.array(oscalPartSchema).optional(),
    controls: z.array(oscalControlSchema).optional(),
  }),
);

export const oscalGroupSchema: z.ZodType<OscalGroup> = z.lazy(() =>
  z.strictObject({
    title: z.string().min(1),
    props: z.array(oscalPropSchema).optional(),
    parts: z.array(oscalPartSchema).optional(),
    controls: z.array(oscalControlSchema).optional(),
    groups: z.array(oscalGroupSchema).optional(),
  }),
);

export const oscalCatalogFileSchema: z.ZodType<OscalCatalogFile> = z.strictObject({
  catalog: z.strictObject({
    uuid: z.string().min(1),
    metadata: z.looseObject({
      title: z.string().min(1),
      published: z.string().min(1),
      "last-modified": z.string().min(1),
      version: z.string().min(1),
      "oscal-version": z.string().min(1),
    }),
    groups: z.array(oscalGroupSchema).min(1),
    "back-matter": z.unknown().optional(),
  }),
});

/** Values of the ISM's own `applicability` prop, least to most protected. */
export const ISM_APPLICABILITY = ["NC", "OS", "P", "S", "TS"] as const;
/** Values of the ISM's own `essential-eight-applicability` prop. */
export const ISM_E8_LEVELS = ["ML1", "ML2", "ML3"] as const;
/** The ISM's namespace for its own props. */
export const ISM_NS = "https://cyber.gov.au/ns/ism/oscal/3.0";

/** All values of a named prop, in the order ASD lists them. */
export const propValues = (control: OscalControl, name: string): string[] =>
  (control.props ?? []).filter((p) => p.name === name).map((p) => p.value);

/**
 * True when ASD has withdrawn the control. The current release marks these with a `status: withdrawn` prop (or its
 * own `withdrawn` prop); a control simply deleted from the catalog can only be spotted by diffing releases.
 */
export const isWithdrawn = (c: OscalControl): boolean =>
  (c.props ?? []).some((p) => p.name === "status" && p.value === "withdrawn") ||
  (c.props ?? []).some((p) => p.name === "withdrawn") ||
  (c.class ?? "").includes("withdrawn");

/** The statement prose of a control, from its `statement` part. */
export const statementOf = (c: OscalControl): string | undefined => {
  const walk = (parts: OscalPart[] | undefined): string | undefined => {
    for (const p of parts ?? []) {
      if (p.name === "statement" && p.prose) return p.prose;
      const nested = walk(p.parts);
      if (nested) return nested;
    }
    return undefined;
  };
  return walk(c.parts);
};
