# Headless CLI

`pnpm cg` runs crownguard from Node with no browser and **no network**. It only reads local content YAML and the files you pass. Branding for PDFs comes from the assessment file.

```sh
pnpm install
pnpm cg --help
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Invalid input (bad args, unreadable or invalid assessment/scan) |
| 2 | Content error (catalogue YAML failed to load) |
| 3 | Unexpected failure |

Machine-readable JSON goes to **stdout**. Human messages go to **stderr**.

## Commands

### Catalogue

```sh
pnpm cg catalogue --platform microsoft --out catalogue.json
pnpm cg catalogue   # JSON on stdout
```

### New assessment

```sh
pnpm cg new --org "Riverbend Health" --platforms microsoft,aws --out riverbend.crownguard.json
```

### Import a scan

Uses the importer registry (M365-Secure, Prowler AWS/Azure, ScubaGoggles). Writes the assessment back in place.

```sh
pnpm cg import riverbend.crownguard.json ./scan.json --tool auto --licence
pnpm cg import riverbend.crownguard.json ./prowler.csv --tool prowler --overwrite
```

### Score

```sh
pnpm cg score riverbend.crownguard.json                 # JSON (default)
pnpm cg score riverbend.crownguard.json --format text
```

JSON includes posture, risks, domains, Essential Eight blockers, roadmap, and SOC / IDCF / AI register summaries when present.

### Render PDF

```sh
pnpm cg render riverbend.crownguard.json report.pdf
pnpm cg render riverbend.crownguard.json ai-register.pdf --kind ai-register
```

### AI register export

```sh
pnpm cg ai-register export riverbend.crownguard.json --format csv --out register.csv
pnpm cg ai-register export riverbend.crownguard.json --format xlsx --out register.xlsx
```

### Migrate

Writes migrated JSON to stdout unless `--out` is set. Never overwrites the input without `--out`.

```sh
pnpm cg migrate old.crownguard.json --out current.crownguard.json
pnpm cg migrate old.crownguard.json > current.crownguard.json
```

### Validate

Lists every Zod issue and path; exits 1 on failure.

```sh
pnpm cg validate riverbend.crownguard.json
```

## Library surface

Stable Node imports live in `src/lib/index.ts` (`loadCatalogueFromDisk`, `parseAssessment`, `applyScan`, `buildReport`, `renderReportToFile`, `registerTable`, …). Prefer that entry over reaching into other `src/` modules.

## Replacing the Hermes helper

The out-of-tree `cg-bot.tsx` copied into a pinned crownguard checkout can be retired. Point the Hermes `crown-jewel-risk-assessor` profile at a release tag and call `pnpm cg` instead of copying a helper script:

```sh
git clone https://github.com/jusso-dev/crownguard.git
cd crownguard && git checkout <release-tag>   # e.g. v1.1.0 when tagged
pnpm install
pnpm cg score assessment.crownguard.json
pnpm cg render assessment.crownguard.json report.pdf
```

Do not copy `cg-bot.tsx` into the tree. A follow-up PR in `jusso-dev/hermes-agent-profiles` should switch the skill to this flow once a release tag exists.
