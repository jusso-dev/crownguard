import { SCHEMA_VERSION } from "./assessmentSchema";

export interface Migration {
  from: number;
  to: number;
  up: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * One step per schema version, in order. Each `up` takes the raw parsed JSON and returns it shaped for `to`.
 * They run on whatever the file literally contained, before the Zod schema sees it, so a migration can rename or
 * split a field without the schema having to accept both shapes forever.
 */
export const migrations: Migration[] = [
  {
    from: 1,
    to: 2,
    // Schema 2 added `schemaVersion` and `savedBy`, and kept loose objects so unknown fields survive a re-save.
    // The bare `version: 1` marker is replaced by `schemaVersion`, and is dropped rather than carried forward.
    up: (raw) => {
      const rest = { ...raw };
      delete rest.version;
      return { ...rest, schemaVersion: 2 };
    },
  },
  {
    from: 2,
    to: 3,
    // Schema 3 recorded scan provenance: `tool`, `toolVersion` and `account` on each piece of evidence, `count` and
    // `examples` on each check, and `toolVersion` on each import. All optional, so nothing to fill in here; the
    // version moves so a build that predates them opens the file read-only instead of stripping them on save.
    up: (raw) => ({ ...raw, schemaVersion: 3 }),
  },
  {
    from: 3,
    to: 4,
    // Schema 4 records when the AI register was created and last shared with the DTA, who confirmed the worked-out
    // dates, and which entries are parts of one general-purpose AI. All optional, and the register block is now loose
    // as well as its entries, so later register fields travel through a re-save untouched and don't need another
    // version bump: the version moves when a field changes meaning or becomes required, not when one is added.
    up: (raw) => ({ ...raw, schemaVersion: 4 }),
  },
];

/**
 * The schema version a raw file claims. Files written before schema 2 only carry `version: 1`; anything with neither
 * marker isn't a crownguard assessment. Returns undefined when it can't tell.
 */
export function detectSchemaVersion(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.schemaVersion === "number" && Number.isInteger(r.schemaVersion) && r.schemaVersion >= 1) return r.schemaVersion;
  if (r.version === 1) return 1;
  return undefined;
}

export interface MigrationResult {
  raw: Record<string, unknown>;
  /** Version the file was written at, before any migration ran. */
  from: number;
  /** False when the file is newer than this build: no migration is attempted. */
  migrated: boolean;
}

/**
 * Bring a raw file up to the current schema version, or report that it is ahead of this build. A file this build
 * can't fully understand is never rewritten by a migration: `migrated` is false and the caller opens it read-only.
 */
export function migrate(raw: Record<string, unknown>, from: number): MigrationResult {
  if (from > SCHEMA_VERSION) return { raw, from, migrated: false };
  let current = raw;
  let version = from;
  for (const m of migrations) {
    if (m.from !== version) continue;
    current = m.up(current);
    version = m.to;
  }
  return { raw: current, from, migrated: version === SCHEMA_VERSION };
}
