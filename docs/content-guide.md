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
```

## Sources

Every question must cite at least one source. Sources are official vendor or government guidance pages.
Every source should be cited by a question, a framework or a platform's licence tiers; the source watch lists
any that aren't.

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

Set `closed: false` for frameworks where we cite section names rather than a fixed control list
(for example Zero Trust deployment guidance). CIS Benchmarks are licensed CC BY-NC-SA 4.0:
only record recommendation numbers and short titles, never recommendation body text.

## Platform

`platform.yaml` defines modules (core + optional add-ons like Azure or Google Cloud),
licence tiers (each a set of licence features), and question domains. Its `sources` list cites the vendor pages the
licence tiers are based on (edition comparisons, nonprofit offers), so the source watch tracks them too.

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
  A strategy reaches a level only when every question tagged at or below that level is answered Yes.
- Severity reflects how directly the gap enables compromise of a crown jewel, not how hard the fix is.

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
a question (review, info, unknown, not licensed) leave it for the assessor.

## Source watch

`.github/workflows/source-watch.yml` runs every night (and on demand from the Actions tab). It fetches every source,
reads the main text of the page, and compares it with the committed baseline in `watch/state.json`: a hash of the
text, section headings with their own hashes and word counts, the page title, lifecycle and licence terms it mentions,
and for Microsoft Learn the commit and document id. When something needs a maintainer it opens or updates a single
pull request from the `bot/source-watch` branch, labelled `source-watch`. When nothing does, it closes that PR.

| In the PR | What happened | What to do |
|---|---|---|
| Broken | 404/410, or the page failed two nights running | Find the replacement guidance, update or remove the source, and check the questions that cite it |
| Moved | Redirects to the same document at a new URL (Learn `document_id` or a matching title) | Nothing: the PR already updates `url` and `retrieved` |
| Redirected elsewhere | Lands on a hub, a landing page, the site's home page or an unrelated page | Pick the replacement page by hand |
| Retirement or deprecation | The page is archived, its title says "(retired)" or "(classic)", or it newly says something is deprecated or retiring | Check whether the cited guidance still stands; cite the current page |
| Changed substantially | Sections added or removed, at least 8% of the words changed, or new deprecation or licensing language | Re-read the page against the questions listed under "cited by" |
| Newer version | The product named in the source title (for example a CIS Benchmark) has a newer version | Update the source title, then review the mapped recommendation numbers |
| New guidance to consider | A new page in the same Learn section as a cited page, or a matching Workspace Updates post or Cloud release note | Decide whether it deserves a question or a citation |
| Not cited anywhere | No question, framework or platform cites the source | Cite it or remove it |
| Duplicate sources | Two sources point at the same page | Merge them |

Small edits are listed under "For information" and don't open a PR on their own. Pages that couldn't be checked (bot
protection, a one-off network error, a page served in another language) are listed too and never count as broken
until they fail on consecutive nights.

**Handling the PR.** Merging it accepts the new baseline (and any URL updates), so the next run compares against it.
Make content fixes in a separate PR: the bot branch is rebuilt on every run. Closing the PR without merging doesn't
silence it: the next run reports the same items again until the source is fixed or the baseline is merged. A PR opened
by the workflow's own token needs a maintainer to approve its CI runs, so the workflow validates the content and runs
the tests itself before opening it.

**Copyright.** Microsoft Learn, Google Workspace Help and Google Cloud docs are CC BY 4.0, so the report can quote a
short diff excerpt with attribution. Other pages (Google Help Center, CIS, vendor marketing pages) are summarised by
section names and word counts only. Page text is never committed; the text used for diffs is kept in the Actions cache.

**Optional Claude triage.** Add an `ANTHROPIC_API_KEY` repository secret and the workflow asks Claude
(`claude-opus-5-5`, at most 8 pages a night) whether each substantial change affects the questions that cite the page.
The answer appears in the PR as a review hint. Requests use server-side fallbacks, so a declined request is retried on
Anthropic's recommended fallback model.

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
