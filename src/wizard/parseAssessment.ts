import type { Assessment, OrphanAnswer } from "../engine/types";
import { assessmentSchema, formatIssues, knownKeys, SCHEMA_VERSION } from "./assessmentSchema";
import { detectSchemaVersion, migrate } from "./migrations";

export interface ParseNotice {
  kind: "info" | "warn";
  text: string;
}

export type ParseResult =
  /** The file is current and valid. */
  | { kind: "ok"; assessment: Assessment; notices: ParseNotice[] }
  /** The file was written by a newer crownguard. `assessment` is only set when this build could still make sense of it. */
  | { kind: "newer"; schemaVersion: number; assessment?: Assessment; issues: string[]; notices: ParseNotice[] }
  /** The file isn't a crownguard assessment, or isn't one this build can read. */
  | { kind: "error"; message: string; issues: string[] };

export interface ParseOptions {
  /**
   * Ids of every question in this build's catalogue. Answers that name a question outside this set are moved to
   * `orphans` and reported, so they survive into the next save instead of being quietly ignored. Omit to skip.
   */
  questionIds?: ReadonlySet<string>;
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * Read a parsed `.crownguard.json`: migrate it forward, validate it, and report anything the user should know.
 *
 * This is the one place that turns untrusted JSON into an `Assessment`. The "Open file" flow, the localStorage
 * rehydrate and the headless CLI all go through it, so a file behaves the same however it arrives.
 */
export function parseAssessment(raw: unknown, opts: ParseOptions = {}): ParseResult {
  const record = asRecord(raw);
  if (!record) return { kind: "error", message: "not a crownguard assessment", issues: [] };

  const from = detectSchemaVersion(record);
  if (from === undefined)
    return { kind: "error", message: "unrecognised format", issues: ["file: no schemaVersion (or version: 1)"] };

  const notices: ParseNotice[] = [];

  // A file from a newer crownguard is never rewritten or migrated: show what this build understands, read-only.
  if (from > SCHEMA_VERSION) {
    const ahead = assessmentSchema.safeParse(record);
    const issues = ahead.success ? [] : formatIssues(ahead.error.issues);
    return {
      kind: "newer",
      schemaVersion: from,
      assessment: ahead.success ? finish(ahead.data, record, opts.questionIds, notices) : undefined,
      issues,
      notices,
    };
  }

  const { raw: migrated, from: writtenAt } = migrate(record, from);
  const parsed = assessmentSchema.safeParse(migrated);
  if (!parsed.success) {
    const issues = formatIssues(parsed.error.issues);
    return {
      kind: "error",
      message: issues[0] ?? "unrecognised format",
      issues,
    };
  }
  if (writtenAt < SCHEMA_VERSION)
    notices.push({ kind: "info", text: `Opened a file saved in the older ${writtenAt} format and brought it up to schema ${SCHEMA_VERSION}.` });

  return { kind: "ok", assessment: finish(parsed.data, migrated, opts.questionIds, notices), notices };
}

/** Report unknown fields and move answers for questions this build no longer asks into `orphans`. */
function finish(
  assessment: Assessment,
  source: Record<string, unknown>,
  questionIds: ReadonlySet<string> | undefined,
  notices: ParseNotice[],
): Assessment {
  const unknown = Object.keys(source).filter((k) => !knownKeys.has(k));
  if (unknown.length)
    notices.push({
      kind: "warn",
      text: `Kept ${unknown.length} field${unknown.length === 1 ? "" : "s"} this version doesn't understand: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? "…" : ""}. Save the file only if you mean to keep them.`,
    });

  if (!questionIds) return assessment;
  const orphans: Record<string, OrphanAnswer> = { ...assessment.orphans };
  const answers = { ...assessment.answers };
  const notes = { ...assessment.notes };
  for (const id of Object.keys(answers)) {
    if (questionIds.has(id)) continue;
    orphans[id] = { ...orphans[id], answer: answers[id] };
    delete answers[id];
    if (notes[id] !== undefined) {
      orphans[id] = { ...orphans[id], note: notes[id] };
      delete notes[id];
    }
  }
  for (const id of Object.keys(notes)) {
    if (questionIds.has(id)) continue;
    orphans[id] = { ...orphans[id], note: notes[id] };
    delete notes[id];
  }
  const moved = Object.keys(orphans).filter((id) => !(id in (assessment.orphans ?? {})));
  if (moved.length)
    notices.push({
      kind: "warn",
      text: `${moved.length} saved answer${moved.length === 1 ? "" : "s"} refer${moved.length === 1 ? "s" : ""} to questions this version no longer asks (${moved.slice(0, 5).join(", ")}${moved.length > 5 ? "…" : ""}). They are kept in the file as orphans.`,
    });
  return Object.keys(orphans).length ? { ...assessment, answers, notes, orphans } : { ...assessment, answers, notes };
}

export type { Assessment, OrphanAnswer };
