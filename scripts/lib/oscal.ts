/** What ASD's OSCAL releases (the ISM catalog, Essentials for enterprise IT) share. */
import { z } from "zod";

export interface OscalProp {
  name: string;
  /** Namespace URI, e.g. `https://cyber.gov.au/ns/ism/oscal/3.0` for the ISM's own props. */
  ns?: string;
  class?: string;
  value: string;
}

export const oscalPropSchema: z.ZodType<OscalProp> = z.strictObject({
  name: z.string().min(1),
  ns: z.string().optional(),
  class: z.string().optional(),
  value: z.string().min(1),
});

/** All values of a named prop, in the order ASD lists them. */
export const propValues = (props: OscalProp[] | undefined, name: string): string[] => (props ?? []).filter((p) => p.name === name).map((p) => p.value);

/**
 * Parse one release file against the generator's strict schema. A shape change throws with the first few issues, so
 * the generator stops and a human reviews the release instead of it being silently misread.
 */
export function parseOscal<T>(name: string, text: string, schema: z.ZodType<T>): T {
  const r = schema.safeParse(JSON.parse(text));
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 10).map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`${name} does not match the expected OSCAL shape (${r.error.issues.length} issue(s)):\n${issues.join("\n")}`);
}
