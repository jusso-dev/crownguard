/**
 * The published JSON Schema for the `.crownguard.json` file format.
 *
 * Written to `public/schema/` before every build, so the copy the app links to as `$schema` is always generated from
 * the same Zod schema that validates files on open. Run it on its own with `pnpm gen:schema`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { assessmentSchema, SCHEMA_VERSION } from "../src/wizard/assessmentSchema";
import { SCHEMA_URL } from "../src/wizard/saveFile";

export const SCHEMA_FILENAME = `crownguard-assessment.v${SCHEMA_VERSION}.json`;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the build copies it from, relative to the repo root. */
export const SCHEMA_PATH = join("public", "schema", SCHEMA_FILENAME);

export function schemaDocument(): Record<string, unknown> {
  return {
    // `io: "output"` describes what the app writes: the saved file, not what it will accept from an older one.
    ...z.toJSONSchema(assessmentSchema, { io: "output", unrepresentable: "any", target: "draft-2020-12" }),
    $id: SCHEMA_URL,
    title: "crownguard assessment",
    description:
      "A .crownguard.json file: one crown-jewel risk assessment saved from https://jusso-dev.github.io/crownguard/. " +
      "Fields the app does not know about are allowed and are carried through a re-save unchanged.",
  };
}

/** Pretty-printed, with a trailing newline, so the committed copy diffs cleanly. */
export const schemaText = () => `${JSON.stringify(schemaDocument(), null, 2)}\n`;

export function writeSchema(): string {
  const text = schemaText();
  mkdirSync(join(root, "public", "schema"), { recursive: true });
  writeFileSync(join(root, SCHEMA_PATH), text);
  return text;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeSchema();
  console.log(`wrote ${SCHEMA_PATH}`);
}
