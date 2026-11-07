/**
 * The published JSON Schema for the `.crownguard.json` file format.
 *
 * Written to `public/schema/` before every build, so the copy the app links to as `$schema` is always generated from
 * the same Zod schema that validates files on open. Run it on its own with `pnpm gen:schema`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { assessmentSchema, SCHEMA_VERSION } from "../src/format/schema";
import { SCHEMA_URL } from "../src/format/saveFile";
import { isMain } from "./lib/cli";
import { repoPath } from "./lib/repo";

/** Where the build copies it from, relative to the repo root. */
export const SCHEMA_PATH = join("public", "schema", `crownguard-assessment.v${SCHEMA_VERSION}.json`);

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

if (isMain(import.meta.url)) {
  mkdirSync(dirname(repoPath(SCHEMA_PATH)), { recursive: true });
  writeFileSync(repoPath(SCHEMA_PATH), schemaText());
  console.log(`wrote ${SCHEMA_PATH}`);
}
