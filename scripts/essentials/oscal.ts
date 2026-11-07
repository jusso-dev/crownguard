/**
 * The subset of NIST OSCAL that ASD's Essentials for enterprise IT (E4EIT) release uses: the catalog of principles
 * and actions, the mapping collection of potential evidence sources, and one profile per domain.
 *
 * As with the ISM (`scripts/ism/oscal.ts`), the objects we read are strict: a new key on a group, control, prop or
 * part fails the parse, so `scripts/essentials/build.ts` stops and a human reviews the release instead of silently
 * misreading it. Metadata siblings we only quote and `back-matter` stay loose.
 */
import { z } from "zod";
import { oscalPropSchema as prop, type OscalProp as Prop } from "../lib/oscal";

export interface Part {
  id?: string;
  name: string;
  class?: string;
  title?: string;
  props?: Prop[];
  prose?: string;
  parts?: Part[];
}
interface Control {
  id: string;
  title?: string;
  props?: Prop[];
  links?: { href: string; rel?: string; text?: string }[];
  parts?: Part[];
}
interface Group {
  id?: string;
  class?: string;
  title: string;
  props?: Prop[];
  parts?: Part[];
  controls?: Control[];
  groups?: Group[];
}

const part: z.ZodType<Part> = z.lazy(() =>
  z.strictObject({
    id: z.string().optional(),
    name: z.string().min(1),
    class: z.string().optional(),
    title: z.string().optional(),
    props: z.array(prop).optional(),
    prose: z.string().optional(),
    parts: z.array(part).optional(),
  }),
);
const control: z.ZodType<Control> = z.strictObject({
  id: z.string().min(1),
  title: z.string().optional(),
  props: z.array(prop).optional(),
  links: z.array(z.strictObject({ href: z.string(), rel: z.string().optional(), text: z.string().optional() })).optional(),
  parts: z.array(part).optional(),
});
const group: z.ZodType<Group> = z.lazy(() =>
  z.strictObject({
    id: z.string().optional(),
    class: z.string().optional(),
    title: z.string().min(1),
    props: z.array(prop).optional(),
    parts: z.array(part).optional(),
    controls: z.array(control).optional(),
    groups: z.array(group).optional(),
  }),
);

const metadata = z.looseObject({
  title: z.string().min(1),
  published: z.string().min(1),
  version: z.string().min(1),
  "oscal-version": z.string().min(1),
});

const resource = z.looseObject({ uuid: z.string(), title: z.string().optional() });

export const catalogFileSchema = z.strictObject({
  catalog: z.strictObject({
    uuid: z.string().min(1),
    metadata,
    groups: z.array(group).min(1),
    "back-matter": z.unknown().optional(),
  }),
});
export type CatalogFile = z.infer<typeof catalogFileSchema>;

export const mappingFileSchema = z.strictObject({
  "mapping-collection": z.looseObject({
    metadata,
    mappings: z.array(
      z.looseObject({
        "target-resource": z.looseObject({ href: z.string() }),
        maps: z.array(
          z.looseObject({
            relationship: z.string(),
            sources: z.array(z.looseObject({ "id-ref": z.string() })).min(1),
            targets: z.array(z.looseObject({ "id-ref": z.string() })).min(1),
          }),
        ),
      }),
    ),
    "back-matter": z.looseObject({ resources: z.array(resource) }),
  }),
});
export type MappingFile = z.infer<typeof mappingFileSchema>;

export const profileFileSchema = z.strictObject({
  profile: z.looseObject({
    metadata: metadata.extend({ props: z.array(prop).min(1) }),
  }),
});
export type ProfileFile = z.infer<typeof profileFileSchema>;

/** Domain slugs as ASD's OSCAL writes them, in the order the chapter lists the domains, with their short keys. */
export const DOMAIN_SLUGS = {
  "governance-and-culture": "GC",
  "visibility-and-response": "VR",
  "boundary-services": "BS",
  "identity-services": "IS",
  "critical-processes-and-services": "CPS",
  "privileged-environments": "PE",
  "business-systems": "BUS",
  "user-devices": "UD",
} as const;
export type DomainSlug = keyof typeof DOMAIN_SLUGS;
