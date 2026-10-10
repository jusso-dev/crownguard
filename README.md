# crownguard

[![CI](https://github.com/jusso-dev/crownguard/actions/workflows/ci.yml/badge.svg)](https://github.com/jusso-dev/crownguard/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/jusso-dev/crownguard/badge)](https://scorecard.dev/viewer/?uri=github.com/jusso-dev/crownguard)

**Find your crown jewels in Microsoft 365, Google Workspace or AWS, see how exposed they are, and hand leadership a branded PDF that explains the risk.**

crownguard is a guided self-assessment that runs entirely in your browser. You pick your environment, name the
systems and information that would hurt most if compromised (your Entra ID tenant, Global Administrators, the HR
SharePoint site, the finance shared drive, Gemini or Copilot's reach into your data), answer plain-language control
questions drawn from Microsoft, Google and AWS security guidance, and download a report themed with your organisation's
logo and colours.

Nothing you enter leaves your device. There is no backend, no account and no analytics.

**Try it: https://jusso-dev.github.io/crownguard/**

<p align="center">
  <img src="docs/screenshots/09-review.png" alt="The Review step: control posture 65%, answer confidence 91%, four high risks, a 5×5 risk heatmap and the crown jewels ranked by risk" width="100%">
</p>

## What you get

- **Crown-jewel discovery.** Guided prompts per category: identity plane, privileged access, business data,
  collaboration and email, endpoints, cloud infrastructure and AI assistants.
- **Vendor-grounded questions.** Each question cites the Microsoft, Google or AWS guidance it comes from and maps to
  CIS Benchmark recommendations, the ASD Essential Eight, NIST CSF 2.0 and the Department of Home Affairs Industry
  Data Classification Framework (IDCF).
- **Cloud posture for Azure, Google Cloud and AWS.** Optional Azure and Google Cloud modules and an AWS platform ask
  about the misconfigurations a cloud security posture management (CSPM) tool flags first: privileged access to the
  management plane, public storage, databases and snapshots, secrets in configuration, logging and threat detection,
  organisation guardrails and backups an attacker can't delete. They map to the CIS Foundations Benchmarks for each
  cloud, the Microsoft cloud security benchmark and AWS Foundational Security Best Practices.
- **Risk per crown jewel.** Impact × likelihood on a 5×5 matrix, driven by your answers, the exposures you record
  and how sensitive or regulated the data is.
- **A report people will read.** It opens by stating the scope, the standards it's assessed against and that it is a
  point-in-time assessment, then an executive summary, heatmap, crown-jewel register, risk register, findings with
  fixes and licence notes, controls marked N/A with the reason given, a 30/60/90-day roadmap, indicative Essential
  Eight maturity, IDCF Data Security Levels, NIST CSF coverage and references. Your logo, ABN, colours and protective marking, with the
  generation time and the time answers were last changed stamped on every report.
- **Save and come back.** Progress saves automatically in your browser as you go. Return later and you pick up
  on the same step and section. **Save file** (or Ctrl/⌘ S) writes a `.crownguard.json` copy without moving you off
  the question you're on; in Chrome and Edge later saves update the same file. **Open file** carries on from a saved
  copy, including older ones: open it, add a logo or ABN, and regenerate the report.
- **Optional scan import.** Already run a scanner? Import its results on the Controls step to pre-fill answers where its
  checks are decisive (all pass = Yes, all fail = No, mixed = Partial). Today that covers [M365-Secure](https://github.com/jusso-dev/M365-Secure)
  for Microsoft 365 (`_Assessment-Results_<domain>.json`, 59 questions) and [Prowler](https://github.com/prowler-cloud/prowler)
  for AWS (52 questions) and Azure (33 questions), as CSV or JSON-OCSF straight from `prowler aws -M csv json-ocsf`.
  Prowler reports one finding per resource, so a check fails when any resource fails it and a suppressed finding is
  never a pass; the evidence carries the counts ("3 of 41 resources failing") and example resources.
  [ScubaGoggles](https://github.com/cisagov/ScubaGoggles) for Google Workspace (`ScubaResults*.json`, 33 questions) is
  read the same way from its policy results only: the report's `Raw` section, which holds super admin and break-glass
  accounts and audit log events, is never touched. Every pre-filled
  answer shows its scan evidence, you can change any of them, and the report names the scanner, its version and the
  account it covered. The file is read in your browser only.
- **N/A must be justified.** Marking a control N/A asks why. Until a reason is given it counts as unanswered.
- **IDCF Data Security Levels.** Optionally record the IDCF Data Security Level (DSL-0 to DSL-5+) your data owner
  chose for each crown jewel. The report shows, for each platform and for DSL-2 to DSL-4, whether your answers found
  gaps in the physical, cyber and authorised-person protections the IDCF describes (the cyber part comes from
  indicative Essential Eight maturity, as the IDCF does), and checks each tagged crown jewel against its level. It
  never assigns levels for you or claims a level is met.
- **Optional SOC maturity assessment.** If you have a security operations centre, in house or through a managed
  provider, rate it on 37 plain-language questions structured on the five domains and 27 aspects of the
  [SOC-CMM®](https://www.soc-cmm.com/products/soc-cmm) v2.4 model. Each question describes what levels 0 to 5 look
  like (0 to 3 for technology and service capability), so a rating means the same thing every time. The report adds a
  radar against targets, an aspect profile, and what the next level up looks like for the eight largest maturity gaps
  and every capability gap. It is indicative, reported separately and never changes crown-jewel risk.
- **Optional AI use-case register.** Record each AI use case or agent (Microsoft 365 Copilot, Copilot Studio agents,
  Gemini, ChatGPT and other public tools, third-party AI connectors and OAuth apps, and your own agents) with the
  minimum register fields in the Digital Transformation Agency's
  [Standard for accountability](https://www.digital.gov.au/ai/ai-in-government-policy/accountability), mostly by clicking options.
  Each use case gets up to 22 readiness questions on accountability, human oversight, access, data, monitoring,
  switch-off, transparency and assurance, drawn from the
  [Policy for the responsible use of AI in government](https://www.digital.gov.au/policy/ai/policy) v2.0, its impact
  assessment guidance, the [agentic AI addendum](https://www.digital.gov.au/policy/ai/agentic-ai-addendum) and ASD's
  guidance on agentic AI. Link a use case to the crown jewels it can reach to see their risk, the related Controls
  answers and the exposures it usually adds. Export the register as CSV or XLSX, with the DTA's fields first, and the
  report gets a register section. Example entries are available, and they're labelled as examples everywhere. The
  register also runs on its own as a five-step [AI register only](#ai-register-only) flow with its own PDF.

## A tour

The screenshots below follow one assessment for a fictional health provider, Riverbend Health, on Microsoft 365. They
are regenerated from the app itself (`SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts`).

### 1. Organisation and environment

Start with the organisation: name, ABN (checked against the ATO check digit), sector, size and the obligations that
apply to it, such as the Privacy Act and its Notifiable Data Breaches scheme. A logo is optional and sets the report's
colours. Then choose the platforms in scope (Microsoft 365 and Entra ID, Google Workspace, Amazon Web Services, or any mix),
with their licence tiers and optional Azure or Google Cloud modules.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/01-organisation.png" alt="Organisation step with the organisation name, ABN, sector, regulations and logo upload"></td>
    <td width="50%"><img src="docs/screenshots/02-environment.png" alt="Environment step with Microsoft 365 selected, its licence tier and optional modules"></td>
  </tr>
</table>

### 2. Crown jewels

Guided prompts per category (identity plane, privileged access, business data, collaboration and email, endpoints,
cloud and AI assistants) help you name what would hurt most. Each crown jewel gets a classification, confidentiality,
integrity and availability ratings, the exposures that apply today (standing admin rights, guest access, unmanaged
devices, AI grounding), its obligations, and optionally the IDCF Data Security Level your data owner chose.
crownguard can suggest a level, but never fills it in for you.

<p align="center"><img src="docs/screenshots/03-crown-jewels.png" alt="Crown jewel form for hybrid identity servers: impact ratings, exposures, obligations and an IDCF Data Security Level of DSL-3 with a suggestion of DSL-4" width="100%"></p>

### 3. Controls

Only the questions relevant to your crown jewels and licences are asked, grouped by domain. Each one explains why it
matters, what "yes" looks like and how to fix it, names any licence the fix needs, and lists the Microsoft, Google or AWS
pages it comes from plus its CIS, Essential Eight, NIST CSF 2.0 and IDCF mappings. Unknown counts as a gap; N/A needs a
reason. Answers can be pre-filled from a scan you have already run: M365-Secure for Microsoft 365, Prowler for AWS
and Azure, or ScubaGoggles for Google Workspace.

<p align="center"><img src="docs/screenshots/04-controls.png" alt="Controls step showing a Conditional Access question with its explanation, recommendation, licence note and references" width="100%"></p>

### 4. SOC maturity (optional)

If you have a security operations centre, in house or through a managed provider, rate it across the five domains and
27 aspects of the SOC-CMM® v2.4 model. Every question describes what each level looks like, so you pick the
description that matches today rather than a vague "partially". Technology and service aspects also get a capability
rating, aspects you genuinely don't need can be left out of scoring, and the targets default to SOC-CMM's (maturity 3,
capability 2).

<p align="center"><img src="docs/screenshots/05-soc-maturity.png" alt="SOC maturity step: who runs security operations, targets, progress, and the five domain tabs" width="100%"></p>

### 5. AI register (optional)

Add each AI use case from a preset, which fills in the usual technology type, usage pattern and access. Then record
the register fields the DTA's Standard for accountability lists: name, reference, description, technology type,
lifecycle stage, use of the AI technical standard, domain, usage pattern, accountable owner, the Appendix C criteria
that put it in scope, the risk ratings from its AI impact assessment and, for high-risk use cases, its review dates.
crownguard records the risk ratings but never works them out. The oversight model (output only, human in the loop,
human on the loop, human out of the loop), access level and data handled decide which readiness questions apply, so
agent questions are only asked of AI that can take actions. The screens below use the example entries.

<p align="center"><img src="docs/screenshots/06-ai-register.png" alt="AI register step with the example data notice, summary tiles, key dates and a tab for each use case" width="100%"></p>

Link a use case to the crown jewels it can reach and you'll see each one's current risk, your Controls answers on the
same tool, and the exposures it usually adds (AI grounding, third-party app access). Ticking a suggested exposure
updates the crown jewel and its risk; nothing changes unless you tick it. The readiness panel shows each theme's
status and every open gap, most severe first.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/07-ai-reach.png" alt="What it can do and reach: oversight model, access level, data handled, linked crown jewel with its high risk, and the related Controls answer"></td>
    <td width="50%"><img src="docs/screenshots/08-ai-readiness.png" alt="Readiness for one use case: status of each theme and the open gaps, most severe first"></td>
  </tr>
</table>

**Download CSV** and **Download XLSX** export the register with the Standard's 16 fields first, in its order (the
owner's name and email are split into two columns), then crownguard's columns: example flag, type, product, oversight,
access, data, linked crown jewels and readiness. The XLSX adds an About sheet with the key dates, caveats and sources.
Both are built in the browser.

### 6. Review

Risk for each crown jewel is impact × likelihood on a 5×5 matrix, recalculated as you answer. The Review step shows
control posture, answer confidence, the heatmap, crown jewels ranked by risk, posture by domain, indicative Essential
Eight maturity and the biggest gaps, plus the SOC maturity result and the AI register when you included them.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/10-review-soc.png" alt="SOC maturity card on the Review step: maturity of each domain against its target"></td>
    <td width="50%"><img src="docs/screenshots/11-review-ai.png" alt="AI register card on the Review step: readiness and open gaps for each use case, with example entries labelled"></td>
  </tr>
</table>

### 7. Branding and the report

Set who the report is prepared for and by, the protective marking, and the colours (taken from the logo, or typed as
hex codes, with a contrast check). Then generate the PDF in the browser.

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/12-branding.png" alt="Branding step with colours from the logo, protective marking and preparer"></td>
    <td width="50%"><img src="docs/screenshots/13-report.png" alt="Report step with the Generate PDF report button and a save reminder"></td>
  </tr>
</table>

## The PDF

A report leadership will actually read: it opens with scope, the standards it was assessed against and a
point-in-time statement, then an executive summary, the crown-jewel register, a risk register, findings with fixes, a
30/60/90-day roadmap, framework alignment (Essential Eight, IDCF, NIST CSF 2.0, CIS) and, when included, the SOC
maturity and AI use-case register sections. Every page carries your marking and the time it was generated.

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/14-pdf-cover.png" alt="PDF cover with the organisation logo, name, ABN, platforms and marking"></td>
    <td width="33%"><img src="docs/screenshots/15-pdf-about.png" alt="About this report: scope, a point-in-time statement and the standards assessed against"></td>
    <td width="33%"><img src="docs/screenshots/16-pdf-summary.png" alt="Executive summary with what's working, the risk heatmap and the highest risks"></td>
  </tr>
  <tr>
    <td>Cover, branded from the logo</td>
    <td>Scope and the standards used</td>
    <td>Executive summary</td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/17-pdf-risk-register.png" alt="Risk register with each crown jewel's band, score and the gaps behind it"></td>
    <td width="33%"><img src="docs/screenshots/18-pdf-roadmap.png" alt="Remediation roadmap in 0-30, 31-60 and 61-90 day phases"></td>
    <td width="33%"><img src="docs/screenshots/19-pdf-frameworks.png" alt="Framework alignment: indicative Essential Eight maturity and the start of the IDCF section"></td>
  </tr>
  <tr>
    <td>Risk register</td>
    <td>30/60/90-day roadmap</td>
    <td>Essential Eight and IDCF</td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/20-pdf-idcf.png" alt="IDCF Data Security Level rows and each labelled crown jewel checked against IDCF Rule 2"></td>
    <td width="33%"><img src="docs/screenshots/21-pdf-soc.png" alt="SOC maturity section: radar against target, headline figures, domain table and aspect profile"></td>
    <td width="33%"><img src="docs/screenshots/22-pdf-soc-priorities.png" alt="SOC aspect profile against target, then priorities to reach target with what the next level looks like, and capability gaps"></td>
  </tr>
  <tr>
    <td>IDCF Rule 2 check per crown jewel</td>
    <td>SOC maturity against target</td>
    <td>SOC priorities and next steps</td>
  </tr>
  <tr>
    <td width="33%"><img src="docs/screenshots/23-pdf-ai-register.png" alt="AI use-case register section: who the policy applies to, the example data notice, headline figures and the register table"></td>
    <td width="33%"><img src="docs/screenshots/24-pdf-ai-use-case.png" alt="An AI use case's readiness card: oversight, access, data, Appendix C criteria, theme status, linked crown jewel risk and open gaps with fixes"></td>
    <td width="33%"><img src="docs/screenshots/25-pdf-ai-dates.png" alt="AI register key dates, where the sources are unclear, and the attribution"></td>
  </tr>
  <tr>
    <td>AI use-case register</td>
    <td>Readiness for each use case</td>
    <td>Key dates and caveats</td>
  </tr>
</table>

It works on a phone too: every step fits a 390px screen.

<p align="center"><img src="docs/screenshots/26-mobile.png" alt="The Controls step on a phone" width="320"></p>

## AI register only

If you only need the AI use-case register — the one the
[Policy for the responsible use of AI in government](https://www.digital.gov.au/policy/ai/policy) asks non-corporate
Commonwealth entities to create and share with the DTA every six months — you don't need to invent a platform or a
crown jewel to get it. Choose **AI use-case register only** on the start screen, or open the deep link:

**https://jusso-dev.github.io/crownguard/#/ai-register**

The flow is five steps — organisation, AI register, review, branding, report — and the only thing it needs before the
register is an organisation name. Crown-jewel links are left out; switching to the full assessment later adds them
without losing anything.

<p align="center"><img src="docs/screenshots/28-ai-standalone-register.png" alt="The standalone AI register step: example entries labelled, summary tiles and key dates, with no crown jewels to link" width="100%"></p>

You get the same register exports as always — CSV and XLSX with the Standard's minimum fields first — plus a
standalone **AI use-case register** PDF: a branded cover, an "About this register" page with who the policy applies to
and a point-in-time statement, the register with readiness for each use case, the key dates, where the sources are
unclear, and the sources themselves. It carries no risk register, roadmap or framework pages: it's a document your
agency can file or share.

<p align="center"><img src="docs/screenshots/31-pdf-ai-register-cover.png" alt="The standalone AI use-case register PDF cover: logo, organisation name, ABN and marking" width="60%"></p>

When you're ready for the full assessment, the Report step has **Turn this into a full crown-jewel assessment**. It
keeps every entry, answer and note, and takes you to the Environment step to name your platforms and crown jewels.

## Use it

Hosted: **https://jusso-dev.github.io/crownguard/** (GitHub Pages, built from `main`)

Or run it yourself:

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static site in dist/, host anywhere
```

The build is a static site with no server code. Serve `dist/` from any static host; set `BASE_PATH` when it lives
under a sub-path (the Pages workflow uses `/crownguard/`). The Content Security Policy ships as a `<meta>` tag
because GitHub Pages can't send custom headers; on a host that can, also send the headers defined in
`vite.config.ts` (including `frame-ancestors 'none'`, which only works as a header).

Browser storage is per origin. On GitHub Pages that origin is shared by every Pages site under the same account,
so for sensitive assessments prefer **Save file**, a private window, or self-hosting on your own domain.

## The saved file

**Save file** writes one JSON object with the whole assessment. Nothing is sent anywhere: the file is your data, and you
choose where it lives. The format is versioned, documented and published as a JSON Schema, so other tools can write and
validate it — see [docs/file-format.md](docs/file-format.md).

A file saved by an older crownguard opens unchanged and is re-saved in the current format. A file saved by a *newer*
crownguard is offered read-only rather than quietly rewritten. Fields this version doesn't understand are carried
through a re-save untouched, and answers to questions that have since been retired are kept under `orphans` instead of
being dropped.

## How risk is scored

| | |
|---|---|
| Answers | Yes = 1, Partial = 0.5, No = 0. **Unknown and unanswered also score 0**: uncertainty is never treated as protection. N/A is excluded. |
| Weights | Critical 4, High 3, Medium 2, Low 1 |
| Impact (1–5) | Highest of the confidentiality, integrity and availability ratings, +1 for regulated or highly confidential data, max 5 |
| Likelihood (1–5) | 1 + 4 × weighted gap ratio of the questions relevant to the crown jewel, +0.5 per recorded exposure, rounded. At least 3 while any critical control is missing |
| Bands | 1–4 Low · 5–9 Medium · 10–19 High · 20–25 Extreme |
| Essential Eight | A maturity level counts only when every question at that level and below is Yes. Indicative only: cloud-platform controls, not a full ASD assessment |
| Roadmap | Gaps ranked by risk reduced across your crown jewels ÷ effort. Critical gaps with small or medium effort go into the first 30 days |
| IDCF | Cyber part of DSL-2, 3, 4 read from indicative Essential Eight Maturity Level 1, 2, 3; physical and authorised-person parts from the questions mapped to each level. A level shows gaps when any mapped question at or below it isn't Yes |
| SOC maturity | Each question rated 0–5 (capability 0–3) against its level descriptions; Unknown scores 0. An aspect's maturity is the mean of its maturity ratings and, for technology and services, its capability the mean of its capability ratings (never combined); a domain is the unweighted mean of its in-scope aspects. Default targets maturity 3, capability 2. Kept apart from the risk scores |
| AI readiness | Scored like the controls (Yes 1, Partial 0.5, No, Unknown and unanswered 0, N/A with a reason left out, severity-weighted) over the questions that apply to each use case. Agent questions are asked unless it only gives output. Indicative, not a DTA rating, and kept apart from the risk scores |

The code is in [`src/engine`](src/engine) with tests alongside.

## Content

All questions, crown-jewel categories, framework mappings and citations are YAML in [`content/`](content), so you
can improve them without touching code. See [docs/content-guide.md](docs/content-guide.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

The optional SOC maturity questions live in [`content/soc/`](content/soc), which is licensed CC BY-SA 4.0 because
it builds on the SOC-CMM® model's structure (see [its NOTICE](content/soc/NOTICE.md)).

The AI register lives in [`content/ai-register/`](content/ai-register): `model.yaml` holds who it applies to, the key
dates, presets, themes and the points the sources leave unclear, and `questions.yaml` the readiness questions. Each
question records whether its source says "must" or "should" and cites the DTA or ASD pages it comes from
([`content/sources/dta.yaml`](content/sources/dta.yaml)). The agentic AI addendum's criteria and the AI technical
standard's criteria it maps to are in [`content/frameworks/`](content/frameworks).

#### Where the AI sources are unclear

crownguard says so in the app, the exports and the report rather than guessing:

- The agentic AI addendum describes itself as best practice to apply with the AI technical standard, and the policy
  strongly recommends that standard rather than requiring it. Its "must" and "should" are shown as written.
- The addendum asks for minimum technical requirements for kill switches but doesn't define them.
- The register's AI technology types have no agentic type, so agents are recorded under the technology they use.
- The policy gives the register deadline as "within 12 months" of 15 December 2025. The 15 December 2026 date shown is
  that arithmetic and is marked as worked out.
- Appendix B allows general-purpose AI such as Copilot to be one use case or several.
- The Standard lists the owner as one "name and email address" field; crownguard keeps them as two.
- The policy applies to non-corporate Commonwealth entities. Anyone else can use the register as a benchmark, but the
  dates and requirements aren't theirs.

Sources include Microsoft Learn (Zero Trust deployment guidance, Entra ID security operations, privileged access,
Conditional Access, Microsoft 365 Copilot oversharing guidance, Purview, Defender), Google Workspace Admin Help
(security checklists, administrator and super admin best practices, Drive, Gmail, Gemini) and Google Cloud
(enterprise foundations, organisation policies, Security Command Center), Azure documentation (Azure RBAC and PIM,
Defender for Cloud, Storage, Key Vault, networking, Azure Backup), AWS documentation (IAM and IAM Identity Center,
Organizations, S3, CloudTrail, GuardDuty, Security Hub CSPM, AWS Backup), plus the ASD Essential Eight Maturity Model,
NIST CSF 2.0, the Home Affairs Industry Data Classification Framework, the SOC-CMM® model, the Digital Transformation
Agency's AI policy, standards, impact assessment guidance and agentic AI addendum, and ASD's guidance on agentic AI.

### Keeping the sources current

Vendor guidance moves, changes and retires. A nightly workflow ([`source-watch.yml`](.github/workflows/source-watch.yml))
re-reads every cited page and compares it with the fingerprints in [`watch/state.json`](watch/state.json). It opens a
pull request when a source:

- **breaks**: the page is gone, or fails on consecutive nights;
- **moves**: the same document now lives at a new address, so the PR updates the URL for you;
- **redirects elsewhere or retires**: it lands on a hub page, is archived, or is marked retired or "classic";
- **changes substantially**: sections added or removed, a large share of the text rewritten, or new deprecation or
  licensing language (with a diff excerpt where the page's licence allows quoting);
- **has a newer version**: for example a new CIS Benchmark release;
- **passes a deadline**: a date the page gives for a retirement or switch-off has arrived;
- **changes with the rest of its site**: when many pages on one site change on the same night (usually new page
  furniture), they are listed once as a likely template change rather than one finding per page;

and when **new guidance** appears: new pages next to a cited page in Microsoft Learn's tables of contents, security and
admin posts on Google Workspace Updates, deprecations or security notes in Google Cloud release notes, and ASD, CIS
and NIST announcements. Merging the PR accepts what it reports; anything still unfixed is listed under "Still
unresolved" in later PRs without reopening one on its own. Page text is never committed: fingerprints are hashes,
section names and word counts, and the text needed for diffs stays in the Actions cache. `pnpm validate:content`
separately rejects sources that nothing cites. See [Source watch](docs/content-guide.md#source-watch).

CIS Benchmarks are referenced by recommendation number and title only, under CIS's CC BY-NC-SA 4.0 terms. Get the
benchmarks from [CIS](https://www.cisecurity.org/cis-benchmarks) for full audit and remediation steps.

## Limitations

This is a self-assessment, not an audit. It doesn't connect to your tenant or verify answers, and it covers your
Microsoft, Google or AWS cloud platform, not your whole environment (on-premises networks, line-of-business apps,
suppliers, physical security). Use it to start the right conversation and to prioritise, then verify.

The AI register's readiness check is a self-check against the DTA's published policy and guidance, not a compliance
finding or a DTA assessment, and it doesn't replace your AI impact assessment.

## Stack

Vite, React, TypeScript, Tailwind CSS, Zustand, Zod, `@react-pdf/renderer`, Vitest, Playwright. Fonts (all SIL
Open Font License, self-hosted): Space Grotesk, Inter and JetBrains Mono in the app via `@fontsource`; Inter in the
PDF (`src/report/fonts/OFL.txt`). The UI design system is documented in [design.md](design.md).

## Licence

The code is MIT ([LICENSE](LICENSE)). The SOC maturity content in [`content/soc/`](content/soc) is
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) because it adapts the structure of the SOC-CMM® model
by Rob van Os ([NOTICE](content/soc/NOTICE.md)). The IDCF content paraphrases the Industry Data Classification
Framework, © Commonwealth of Australia 2026 and © Commonwealth Scientific and Industrial Research Organisation (CSIRO)
2026, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (the Coat of Arms excepted), and "IDCF: A
guide to system security" by the Australian Government Department of Home Affairs, used under the department's website
terms (CC BY 3.0 AU). The AI register paraphrases Digital Transformation Agency policy, standards and guidance,
© Commonwealth of Australia, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and draws on ASD
guidance. CIS Benchmarks are referenced by recommendation number and title only, under CC BY-NC-SA 4.0.

crownguard is independent and not affiliated with or endorsed by Microsoft, Google, Amazon Web Services, CIS, ASD, NIST, the Department of
Home Affairs, CSIRO, the Digital Transformation Agency or SOC-CMM. SOC-CMM® is a registered trademark of its owner.
Product names are trademarks of their respective owners.
