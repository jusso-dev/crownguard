import type { Assessment } from "../engine/types";
import { APP_VERSION, SCHEMA_VERSION } from "./assessmentSchema";
import { encrypt } from "./crypto";

/** Published JSON Schema for this file format. Written into every saved file as `$schema`. */
export const SCHEMA_URL = `https://jusso-dev.github.io/crownguard/schema/crownguard-assessment.v${SCHEMA_VERSION}.json`;

/**
 * The contents of a `.crownguard.json` file: the assessment as it stands, with the schema version, a link to the
 * published JSON Schema and a note of who wrote it. Nothing here is sent anywhere; it is the file itself.
 */
export function toSaveFile(a: Assessment, opts: { contentHash?: string; now?: Date } = {}): string {
  const content = { ...a };
  delete content.version; // superseded by schemaVersion
  return JSON.stringify(
    {
      $schema: SCHEMA_URL,
      ...content,
      schemaVersion: SCHEMA_VERSION,
      savedBy: {
        app: "crownguard",
        appVersion: APP_VERSION,
        contentHash: opts.contentHash ?? a.savedBy?.contentHash,
        savedAt: (opts.now ?? new Date()).toISOString(),
      },
    },
    null,
    2,
  );
}

/** Encrypt a plain saved-file JSON string into the crownguard envelope (pretty-printed). */
export async function toEncryptedSaveFile(plainJson: string, passphrase: string): Promise<string> {
  return JSON.stringify(await encrypt(plainJson, passphrase), null, 2);
}
