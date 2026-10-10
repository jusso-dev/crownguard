# Content authoring guide

All questions, crown-jewel asset types, frameworks and citations live in `content/` as YAML.
The app and the PDF are generated from these files; no code change is needed to add or edit a question.
`pnpm validate:content` checks everything below and runs in CI.

```
content/
  sources/<publisher>.yaml          # citation registry
  frameworks/<id>.yaml              # one framework per file
  platforms/<platform>/platform.yaml
  platforms/<platform>/assets.yaml  # crown-jewel asset types
  platforms/<platform>/questions/<domain>.yaml
  soc/model.yaml                    # optional SOC maturity module (CC BY-SA 4.0)
  soc/questions/<domain>.yaml
  ai-register/model.yaml            # optional AI use-case register: dates, presets, themes, caveats
  ai-register/questions.yaml        # its readiness questions
```

## Sources

Every question must cite at least one source. Sources are official vendor or government guidance pages.
Every source must be cited by a question, a framework (its `source` or supporting `sources`), a platform's licence
tiers, the SOC module (`source`, `licenceSource` or `sources` in `content/soc/model.yaml`) or the AI register (its
model's `sources`, dates, caveats and presets, or a readiness question), and no two sources may
point at the same page; `pnpm validate:content` rejects both.

```yaml
- id: ms-zt-identity
  title: Secure identity with Zero Trust
  publisher: Microsoft
  url: https://learn.microsoft.com/en-us/security/zero-trust/deploy/identity
  retrieved: 2026-10-08
```

## Frameworks

```yaml
id: nist-csf-2
name: NIST Cybersecurity Framework 2.0
shortName: NIST CSF 2.0
publisher: NIST
source: nist-csf-2
closed: true            # question refs must match a control id below
controls:
  - id: PR.AA-03
    group: Protect
    title: Users, services, and hardware are authenticated
```

The Home Affairs Industry Data Classification Framework (`idcf.yaml`) is licensed CC BY 4.0: control titles and notes
may paraphrase or quote it with attribution and a note of changes. Its companion resources on homeaffairs.gov.au fall
under the website's CC BY 3.0 AU terms; never reproduce the Coat of Arms or logos. A question references the DSL row at
which the IDCF first lists what it asks (both rows when it bundles two levels). Never reference a "DSL-n Cyber" row:
the report reads those from the Essential Eight tags (Maturity Level 1, 2, 3 for DSL-2, 3, 4). Avoid the words
"compliant" and "meets DSL-n": the IDCF code of conduct attaches obligations to organisations that claim systems are
consistent with it.

Set `closed: false` for frameworks where we cite section names rather than a fixed control list
(for example Zero Trust deployment guidance). CIS Benchmarks are licensed CC BY-NC-SA 4.0:
only record recommendation numbers and short titles, never recommendation body text.

## Platform

`platform.yaml` defines modules (core + optional add-ons like Azure or Google Cloud),
licence tiers (each a set of licence features), and question domains. Its `sources` list cites the vendor pages the
licence tiers are based on (edition comparisons, nonprofit offers), so the source watch tracks them too.

A platform needs at least one licence tier. AWS has no editions: its single pay-as-you-go tier includes every licence
feature, and the features (GuardDuty, Security Hub CSPM, Macie and so on) mark fixes that add a running cost rather
than something the customer might not own. The wizard hides the tier picker for a platform with one tier.

## Asset types (crown-jewel categories)

```yaml
- id: ms-sharepoint-sites
  module: core
  tier: data              # identity | privileged | data | collaboration | endpoint | cloud | ai
  name: SharePoint Online sites & OneDrive
  description: Document libraries holding sensitive business records.
  examples: [HR site, Board papers library, Finance OneDrive folders]
  discoveryPrompts:
    - Which SharePoint sites hold HR, legal, finance or board information?
  exposures: [external-sharing, guest-access, unmanaged-devices, ai-grounding]
  threats:
    - { technique: T1530, name: Data from Cloud Storage }
```

`exposures` lists which exposure flags the user is asked about for a crown jewel of this type.
Allowed values: `external-sharing`, `guest-access`, `internet-facing`, `standing-admin`,
`third-party-apps`, `unmanaged-devices`, `ai-grounding`. Threats use MITRE ATT&CK technique ids.

## Questions

```yaml
- id: MS-ID-001             # <PLATFORM>-<DOMAIN>-<NNN>
  module: core
  domain: identity
  appliesTo: [ms-entra-tenant, ms-privileged-roles]   # or ["*"] for all asset types
  severity: critical        # critical | high | medium | low
  question: Is phishing-resistant MFA required for every administrator role?
  why: Administrator accounts are the keys to the tenant. Push and SMS MFA can be phished or fatigued.
  yesLooksLike: A Conditional Access policy requires the phishing-resistant authentication strength for all directory roles.
  remediation: Create a Conditional Access policy targeting all administrator roles with the built-in phishing-resistant MFA authentication strength; register FIDO2 keys or Windows Hello for Business first.
  effort: M                 # S | M | L
  licence: [entra-p1]       # licence features the fix needs (annotation only; question is always asked)
  sources: [ms-ca-admin-phish-resistant]
  refs:
    - { framework: cis-m365, ref: "5.2.2.5" }
    - { framework: nist-csf-2, ref: PR.AA-03 }
  e8:
    - { strategy: mfa, level: 2 }
```

Writing rules:
- Ask one thing per question, answerable Yes / Partial / No / Unknown / N/A by an IT lead without running scripts.
- `why` explains the business risk in plain language; `remediation` names the actual feature or setting.
- Every Yes must be a defensible security outcome; don't ask questions where Yes is the risky answer.
- `e8` levels follow the ASD Essential Eight Maturity Model: tag the lowest maturity level the requirement first appears at.
  A strategy reaches a level only when every question tagged at or below that level is answered Yes. A level with no
  questions stops the strategy there (the report shows it as not verified, which also leaves the matching IDCF level
  not verified), except a level ASD defines with no new requirements (patching operating systems at Maturity Level 2;
  see `NO_NEW_REQUIREMENTS` in `src/engine/maturity.ts`). The questions tagged at a level must together cover
  everything that level adds over the one below. Questions are only asked when a crown jewel of one of their
  `appliesTo` types is recorded, so give the questions tagged at the same strategy and level the same `appliesTo`
  (account-wide controls use `["*"]`); otherwise a scope can reach a level with part of it never asked.
- Severity reflects how directly the gap enables compromise of a crown jewel, not how hard the fix is.

## SOC maturity module

`content/soc/` holds the optional SOC maturity self-assessment. **Everything in this folder is licensed CC BY-SA 4.0,
not MIT**, because its structure comes from the SOC-CMM® model (see `content/soc/NOTICE.md`). By contributing to these
files you license your contribution under CC BY-SA 4.0. Start new files with
`# SPDX-License-Identifier: CC-BY-SA-4.0 (see ../NOTICE.md)`.

`model.yaml` sets the domains and aspects (SOC-CMM v2.4's five domains and 27 aspects), the level names, the default
targets and the attribution shown in the app and the PDF. Questions go in `questions/<domain>.yaml`:

```yaml
- id: SOC-SVC-009          # SOC-<BUS|PPL|PRC|TEC|SVC>-<NNN>, matching the aspect's domain
  aspect: threat-hunting
  kind: maturity           # maturity (levels 0-5) or capability (levels 0-3, technology and services only)
  question: Does the SOC proactively hunt for threats that alerts miss, using a defined method?
  why: Hunting finds quiet attackers, such as a persistent OAuth app grant, and turns findings into new detections.
  levels:                  # what each level looks like for this question, from 0 up: 6 for maturity, 4 for capability
    - No threat hunting.
    - Occasional hunts happen when someone has spare time or after news of a big attack.
    - Hunts are scheduled or assigned, but the method and records of results are inconsistent.
    - A documented method is followed on a schedule, and every hunt and its findings are recorded.
    - "Hunting output is measured: hunts completed, findings, and detections created."
    - Hunting priorities shift continuously with intelligence and results, and findings routinely become detections.
  refs:
    - { framework: nist-csf-2, ref: DE.AE-02 }
```

Writing rules:
- One aspect per question. Every aspect needs a maturity question, and every technology and service aspect a
  capability question too.
- Maturity levels follow the ladder: 0 not in place, 1 ad hoc, 2 partly structured, 3 documented and followed
  consistently, 4 measured against targets, 5 continuously improved. Capability levels: 0 missing, 1 basic and uneven,
  2 a standard set-up that covers what matters (including the crown jewels), 3 measured, tracked and tuned.
- Each level description must be something an IT lead can recognise in their own SOC or provider contract.
- **Never copy or paraphrase SOC-CMM question or guidance text**, its e-book, certification material or website prose.
  Write original questions; only the domain and aspect names, level names and default targets come from SOC-CMM.
- Never call results SOC-CMM scores or levels, or use "certified", "compliant" or "official". The module is
  "aligned to the SOC-CMM® v2.4 model", not a SOC-CMM assessment.
- Question ids are permanent keys in saved files: never reuse one for a different question.
- Australian English, as everywhere else.

## AI use-case register

`content/ai-register/` holds the optional AI use-case register. Its wording comes from the Digital Transformation
Agency's AI policy and standards (CC BY 4.0) and ASD guidance; the register fields themselves (technology types,
lifecycle stages, domains, usage patterns, Appendix C criteria, risk ratings) are fixed lists in
`src/engine/aiOptions.ts`, in the DTA's wording, because saved files store their keys.

`model.yaml` sets:

- `appliesTo`: who the policy applies to, shown before anything else.
- `dates`: dated or ongoing requirements, each with a `source`. Set `derived: true` on a date worked out from the
  source's wording rather than printed in it, and say so in the `text`.
- `caveats`: points the sources leave unclear. They're shown in the app, the XLSX About sheet and the report. Add one
  rather than guessing.
- `themes`: the readiness themes. Every theme needs at least one question.
- `kinds`: the presets offered when adding a use case, with default register values, the crown-jewel `exposures` this
  kind of AI usually adds (offered on linked crown jewels, never ticked for the user) and `relatedQuestions`, platform
  question ids shown with their Controls answers.

```yaml
- id: AIR-OFF-001          # AIR-<THEME>-<NNN>; ids are permanent keys in saved files
  theme: switch-off
  when: agentic            # all | agentic | personal-data | indigenous-data | in-scope | high-risk | public-tool
  basis: addendum-must     # policy-must | standard-must | addendum-must | addendum-should | guidance
  severity: critical
  question: Can you stop the agent quickly with a kill switch you've tested, and roll back what it did?
  why: ...
  yesLooksLike: ...
  remediation: ...
  sources: [dta-agentic-design]
  refs: [{ framework: dta-agentic-ai, ref: AGT.3.4 }]
```

- `basis` must match the source: "must" only where the source says must. The agentic AI addendum is best practice
  guidance applied with the AI technical standard, which the policy strongly recommends; keep that distinction.
- Don't invent requirements, field names or dates. If a source is ambiguous, write the question so it asks whether
  the agency has decided, and add a caveat.
- `when` conditions only ever drop questions when the answers say they don't apply. "Not sure" keeps them in.
- Readiness is never called compliance, and crownguard never works out risk ratings: they come from the agency's AI
  impact assessment.

## Scan imports

`content/imports/<tool>.yaml` maps an automated scanner's check ids to questions so its results can pre-fill answers.

```yaml
id: m365-secure
name: M365-Secure
platform: microsoft
url: https://github.com/jusso-dev/M365-Secure
mappings:
  - question: MS-ID-001
    checks: [ENTRA-CA-001, ENTRA-CA-004]
    rationale: These checks confirm a Conditional Access policy requires MFA for all users.
```

Only map a check when its pass or fail genuinely answers the question. When several checks map to one question,
all pass gives Yes, all fail gives No, and anything mixed (or a warning) gives Partial. Statuses that can't settle
a question (review, info, unknown, not licensed) leave it for the assessor. `cap: partial` turns an all-pass into
Partial when the checks cover only part of the question; `failIsInconclusive: true` sends a fail to review instead of
No when a check also fails for reasons the question doesn't ask about.

Each mapping goes with an importer in `src/imports/`: `m365-secure`, `prowler-aws`, `prowler-azure` and `scubagoggles`. Adding a
scanner is a new importer plus a mapping file, not a new panel: the Controls step lists whatever has both.

### Importing a Prowler scan

[prowler-aws.yaml](../content/imports/prowler-aws.yaml) and [prowler-azure.yaml](../content/imports/prowler-azure.yaml)
map [Prowler](https://github.com/prowler-cloud/prowler) check ids to the AWS and Azure questions under the same rules.
Prowler reports one finding per resource per region, so the importer collapses them per check: a check **fails** when
any resource fails it, **passes** only when every resource passes, and a suppressed (muted) finding is review, never a
pass. The panel shows the counts ("3 of 41 resources failing") and a few example resources behind them.

Run Prowler read-only and import either output — they give the same answers:

```console
prowler aws -M csv json-ocsf
prowler azure -M csv json-ocsf
```

The files land in `output/` as `prowler-output-<account>-<date>.csv` and `.json`. A file covering several accounts is
combined, and the panel lists the accounts it found.

`checkedAgainst` records the Prowler release the check ids were checked against; an import from another major version
is flagged, because Prowler renames checks between versions. `e2e/fixtures/prowler-checks-<provider>.txt` pins the ids
of that release, so a mapping that drifts away from Prowler fails `pnpm test`. Regenerate both together when
`checkedAgainst` moves.

### Importing a ScubaGoggles scan

[scubagoggles.yaml](../content/imports/scubagoggles.yaml) maps CISA's [ScubaGoggles](https://github.com/cisagov/ScubaGoggles)
policy ids (`GWS.GMAIL.7.3v1` and friends) to the Google questions. Import the `ScubaResults*.json` file from a run of
ScubaGoggles against the Google Workspace tenant. The importer reads only `MetaData` and
`Results.<product>[].Controls[]` — the `Raw` section of a ScubaGoggles report holds super admin and break-glass
accounts, organisational unit names and audit log events, and none of it is read. A `Pass` passes and a `Fail` fails; a
`Warning` (a failed SHOULD) is a failure that can only ever cap a question at Partial; `N/A`, `Omitted`,
`Incorrect Result`, `Error` and `No events found` are left for the assessor. The HTML ScubaGoggles writes into `Details`
is stripped before the text becomes evidence. A ScubaGear (Microsoft 365) report is refused with a message saying so.

Policy ids carry a version suffix, so the importer matches on the id without it and flags a report whose suffix differs
from the one crownguard checked against. `checkedAgainst` records the ScubaGoggles release the ids came from, and
`e2e/fixtures/scubagoggles-controls.txt` pins the policy ids of that release, so a mapping that drifts away from the
SCuBA baselines fails `pnpm test`. Regenerate both together when `checkedAgainst` moves.

## Source watch

`.github/workflows/source-watch.yml` runs every night (and on demand from the Actions tab). It fetches every source,
reads the main text of the page, and compares it with the committed baseline in `watch/state.json`: a hash of the
text, section headings with their own hashes and word counts, the page title, lifecycle and licence terms it mentions,
and for Microsoft Learn the commit and document id. When something new needs a maintainer it opens or updates a single
pull request from the `bot/source-watch` branch, labelled `source-watch`. When nothing does, it closes that PR.

The PR's `watch/state.json` is the baseline plus only what the PR reports, so merging it acknowledges exactly those
items. Small edits don't change the baseline, so they add up until they become a substantial change.

| In the PR | What happened | What to do |
|---|---|---|
| Broken | 404/410, or the page failed two nights running | Find the replacement guidance, update or remove the source, and check the questions that cite it |
| Moved | Redirects to the same document at a new URL (Learn `document_id` or a matching title). Never applied to a source whose redirect was already accepted | Nothing: the PR already updates `url` and `retrieved` |
| Redirected elsewhere | Lands on a hub, a landing page, the site's home page or an unrelated page | Pick the replacement page by hand |
| Dates passed | A date the page gives for a retirement, deprecation or switch-off has now passed | Check the guidance and the questions citing it still hold |
| Retired or deprecated | The page is archived, its title says "(retired)", "(classic)" or "(deprecated)", a notice at the top says so, or a change adds deprecation or retirement wording | Check whether the cited guidance still stands; cite the current page |
| Changed substantially | Sections of 40 or more words added or removed (a reworded heading over the same text doesn't count), at least 8% of the words (or 250 words) changed, a substantial retitle, deprecation wording removed, or licence names appearing or disappearing | Re-read the page against the questions listed under "cited by" |
| Site template changes | At least 30% of a site's pages (ten or more) changed on the same night with no new Learn commit behind them: usually page furniture, not guidance. The pages are held, not reported one by one, until merged or changed again | Open one or two pages; merging re-baselines the listed pages. If the watch now picks up navigation or boilerplate, fix the selectors in `scripts/watch/hosts.ts` instead |
| Newer version | The product named in the source title (for example a CIS Benchmark) has a newer version | Update the source title, then review the mapped recommendation numbers |
| New guidance to consider | A new page in the same Learn section as a cited page, or a matching Workspace Updates post, Cloud release note, ASD, CIS or NIST announcement, or SOC-CMM community post about a release | Decide whether it deserves a question or a citation |
| Not being monitored | The page couldn't be checked for seven nights running (bot protection, wrong language, changed layout) | Check it by hand; adjust its profile in `scripts/watch/hosts.ts` |
| Recovered | A source recorded as broken, unmonitored, redirected or retired is fine again | Nothing: merging records it |
| Baseline updates | A source, feed or Learn section started or stopped being tracked | Nothing: merging records it |

Small edits are listed under "For information" and don't open a PR on their own. Pages that couldn't be checked (bot
protection, a one-off network error, a page served in another language) are listed too and never count as broken.
Other failures count as broken only after two nights in a row, and never when at least 80% of a site's sources
(three or more) fail at once. www.soc-cmm.com refuses automated requests, so the SOC-CMM sources show as not being
monitored until SOC-CMM allows the watch's user agent (the watch never pretends to be a browser); the SOC-CMM user
community feed covers new model and tool releases in the meantime.

**Handling the PR.** Merging it accepts what it reports (and any URL updates), so the next run compares against it.
Issues accepted but not yet fixed (a broken page, a retired page, an outdated version) appear in later PRs under
"Still unresolved"; they don't open a PR by themselves. Make content fixes in a separate PR: the bot branch is rebuilt
on every run. Closing the PR without merging doesn't silence it: the next run reports the same items again. A PR
opened by the workflow's own token needs a maintainer to approve its CI runs, so the workflow validates the content
and runs the tests itself before opening it. A simulated run (`simulate` on a manual run) uses its own branch,
`bot/source-watch-simulated`, so it never touches the real PR.

**Copyright.** The report quotes short diff excerpts only from openly licensed pages, with attribution: Google
Workspace Help and Google Cloud docs (CC BY 4.0), cyber.gov.au (CC BY 4.0), NIST publications (public domain), and the
Microsoft Learn pages whose public GitHub mirror is openly licensed (entra-docs under MIT, azure-docs and
power-platform under CC BY 4.0). Learn's own terms don't permit republishing the rest, so those pages, the Google Help
Center, AWS documentation and pricing pages, CIS and Microsoft marketing pages are summarised by section names and
word counts only. Page text is never committed; the text used for diffs is kept in the Actions cache.

**Optional Claude triage.** Add an `ANTHROPIC_API_KEY` repository secret and the workflow asks Claude
(`claude-opus-5-5`, at most 8 pages a night) whether each substantial change affects the questions that cite the page.
The answer appears in the PR as a review hint. Requests use server-side fallbacks, so a declined request is retried on
Anthropic's recommended fallback model.

**One-time setup** (already done for jusso-dev/crownguard; needed in a fork that runs the workflow):

- Settings → Actions → General → Workflow permissions: tick "Allow GitHub Actions to create and approve pull
  requests" (`echo '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":true}' | gh api -X PUT repos/OWNER/REPO/actions/permissions/workflow --input -`).
- Create the label the PR carries: `gh label create source-watch`.

**Running it locally.**

```sh
pnpm watch:sources --dry-run            # check everything, write watch-report.md, change nothing
pnpm watch:sources --dry-run --only ms-ca-plan,gws-checklist-large --verbose
GITHUB_TOKEN=$(gh auth token) pnpm watch:sources   # also update watch/state.json and moved URLs
```

Adding a site the watch doesn't know yet: give it a profile in `scripts/watch/hosts.ts` (main-content selector, chrome
to strip, licence) so the fingerprint ignores navigation and widgets. Unknown hosts fall back to generic selectors.

GitHub disables scheduled workflows after 60 days without repository activity. If the nightly runs stop, re-enable the
workflow from the Actions tab.
