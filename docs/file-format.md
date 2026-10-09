# The `.crownguard.json` file format

A saved assessment is one JSON object. It is written by **Save file** (or Ctrl/⌘ S) and read by **Open file**. Nothing
is sent anywhere: the file is the whole of your data, and you choose where it lives.

- Published JSON Schema: [`public/schema/crownguard-assessment.v3.json`](../public/schema/crownguard-assessment.v3.json),
  generated from the same [Zod schema](../src/wizard/assessmentSchema.ts) the app validates with.
- Every saved file carries a `$schema` key pointing at it, so editors and other tools can pick it up automatically.
- Migrations live in [`src/wizard/migrations.ts`](../src/wizard/migrations.ts); one step per version, in order.

## Reading a file safely

`parseAssessment` (`src/wizard/parseAssessment.ts`) is the only place that turns untrusted JSON into an assessment. The
**Open file** flow, the progress saved in the browser and the headless CLI all go through it, so a file behaves the same
however it arrives.

| What the file says | What happens |
| --- | --- |
| `schemaVersion` is this build's, or lower | Migrated forward, then validated. |
| `schemaVersion` is higher than this build's | "Saved by a newer version of crownguard" warning, with **Open read-only**. Nothing is written back: not to the file, not to this browser's progress. Reload to update crownguard first. |
| No `schemaVersion` and no `version: 1` | Refused: not a crownguard assessment. |
| Fails validation | Refused, with up to five problems listed by path (`org.name: Invalid input: expected string, received number`). |

Two rules keep data safe when an older build reads a newer file:

- **Unknown fields are kept, never stripped.** The top level and the `soc` block are loose objects. Opening a file with
  fields this build has never heard of and re-saving it leaves those fields exactly as they were, and says so.
- **Answers to questions that are gone are kept, never deleted.** If an answer names a question this build no longer
  asks, it moves to `orphans` with its note and is reported, so it survives into the next save.

The same checks run against the progress kept in the browser, which is just as untrusted. When it can't be read it is
moved aside rather than deleted, and the app offers a copy to download.

## Fields

| Field | Type | Notes |
| --- | --- | --- |
| `$schema` | string | Written on save. Points at the published JSON Schema for this format. |
| `schemaVersion` | integer | File format version. **3** is current. |
| `savedBy` | object | `{ app, appVersion, contentHash?, savedAt }`. Who wrote the file, and the digest of the questions they saved against. For support and debugging. |
| `org` | object | Organisation profile: `name`, `abn?`, `sector`, `size`, `jurisdiction`, `regulations`. |
| `platforms` | string[] | Platform ids in scope, e.g. `["microsoft"]`. |
| `modules` | object | Enabled optional module ids per platform. |
| `licence` | object | Licence tier id per platform. |
| `jewels` | object[] | Crown jewels: id, name, platform, asset type, description, classification, `dsl?`, confidentiality/integrity/availability (1–5), regulations, exposures, business processes. |
| `answers` | object | Question id to `yes` / `partial` / `no` / `unknown` / `na`. |
| `notes` | object | Question id to note. At most 4000 characters each. |
| `orphans` | object | Answers and notes whose question is no longer asked. `{ answer?, note? }` per question id. |
| `branding` | object | `logoDataUrl?`, `logoBackdrop?`, `primary`, `accent`, `marking`, `preparedBy`, `preparedFor`. |
| `evidence` | object | Scan evidence per question id, from an optional automated import. Carries the scanner (`tool`, `toolVersion`), the `account` it covered, and per check a `count` ("3 of 41 resources failing") and up to ten `examples`. |
| `imports` | object[] | One row per scan import: source, `toolVersion?`, tenant, scanned at, imported at, answers applied. |
| `soc` | object | Optional SOC maturity self-assessment: `answers`, `notes?`, `outOfScope`, `targets?`, `provider?`. |
| `progress` | object | Where you were: `step`, `section?`, `socSection?`, `layout?`. |
| `createdAt`, `updatedAt` | string | ISO 8601 timestamps. |

Anything else in the file is allowed and is carried through unchanged.

## Changelog

### 3 — current

- Scan provenance: `tool`, `toolVersion` and `account` on each piece of evidence, `count` and `examples` on each check,
  and `toolVersion` on each import. All optional. The version moved rather than the fields simply appearing, because an
  older build reading a file that had them would strip them on save; the newer-file guard stops that.

### 2

- `schemaVersion` replaces the bare `version: 1` marker. A file with `version: 1` is treated as format 1 and migrated
  up on open; the old key is dropped on the next save.
- `savedBy` records who wrote the file and when.
- `$schema` links to the published JSON Schema.
- `orphans` holds answers for questions that have since been retired.
- Unknown fields are preserved rather than stripped.

### 1 — superseded

The launch format. Every saved file claimed `version: 1`, unknown keys were stripped on save, and there was no way to
tell a file saved yesterday from one saved a year earlier.

## For other tools

If you write `.crownguard.json` files yourself (the Hermes `crown-jewel-risk-assessor` profile does):

1. Set `schemaVersion: 3` and fill in `savedBy`.
2. Validate against the published JSON Schema before writing.
3. Don't drop fields you don't recognise. crownguard keeps them, so keep them too.
