# crownguard

**Find your crown jewels in Microsoft 365 or Google Workspace, see how exposed they are, and hand leadership a branded PDF that explains the risk.**

crownguard is a guided self-assessment that runs entirely in your browser. You pick your environment, name the
systems and information that would hurt most if compromised (your Entra ID tenant, Global Administrators, the HR
SharePoint site, the finance shared drive, Gemini or Copilot's reach into your data), answer plain-language control
questions drawn from Microsoft and Google security guidance, and download a report themed with your organisation's
logo and colours.

Nothing you enter leaves your device. There is no backend, no account and no analytics.

## What you get

- **Crown-jewel discovery.** Guided prompts per category: identity plane, privileged access, business data,
  collaboration and email, endpoints, cloud infrastructure and AI assistants.
- **Vendor-grounded questions.** Each question cites the Microsoft or Google guidance it comes from and maps to
  CIS Benchmark recommendations, the ASD Essential Eight and NIST CSF 2.0.
- **Risk per crown jewel.** Impact × likelihood on a 5×5 matrix, driven by your answers, the exposures you record
  and how sensitive or regulated the data is.
- **A report people will read.** It opens by stating the scope, the standards it's assessed against and that it is a
  point-in-time assessment, then an executive summary, heatmap, crown-jewel register, risk register, findings with
  fixes and licence notes, controls marked N/A with the reason given, a 30/60/90-day roadmap, indicative Essential
  Eight maturity, NIST CSF coverage and references. Your logo, ABN, colours and protective marking, with the
  generation time and the time answers were last changed stamped on every report.
- **Save and come back.** Progress saves automatically in your browser as you go. Return later and you pick up
  on the same step and section. **Save file** (or Ctrl/⌘ S) writes a `.crownguard.json` copy without moving you off
  the question you're on; in Chrome and Edge later saves update the same file. **Open file** carries on from a saved
  copy, including older ones: open it, add a logo or ABN, and regenerate the report.
- **Optional scan import (Microsoft).** Already run [M365-Secure](https://github.com/jusso-dev/M365-Secure) against
  your tenant? Import its `_Assessment-Results_<domain>.json` on the Controls step to pre-fill answers (51 of the 63
  Microsoft questions have mapped checks) where its checks are decisive (all pass = Yes, all fail = No, mixed = Partial). Every pre-filled answer shows the scan
  evidence, you can change any of them, and the report says which answers came from the scan. The file is read in
  your browser only.
- **N/A must be justified.** Marking a control N/A asks why. Until a reason is given it counts as unanswered.

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

The code is in [`src/engine`](src/engine) with tests alongside.

## Content

All questions, crown-jewel categories, framework mappings and citations are YAML in [`content/`](content), so you
can improve them without touching code. See [docs/content-guide.md](docs/content-guide.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

Sources include Microsoft Learn (Zero Trust deployment guidance, Entra ID security operations, privileged access,
Conditional Access, Microsoft 365 Copilot oversharing guidance, Purview, Defender), Google Workspace Admin Help
(security checklists, administrator and super admin best practices, Drive, Gmail, Gemini) and Google Cloud
(enterprise foundations, organisation policies, Security Command Center), plus the ASD Essential Eight Maturity Model
and NIST CSF 2.0.

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

and when **new guidance** appears: new pages next to a cited page in Microsoft Learn's tables of contents, security and
admin posts on Google Workspace Updates, and deprecations or security notes in Google Cloud release notes. It also
lists sources nothing cites. Page text is never committed: fingerprints are hashes, section names and word counts,
and the text needed for diffs stays in the Actions cache. See [Source watch](docs/content-guide.md#source-watch).

CIS Benchmarks are referenced by recommendation number and title only, under CIS's CC BY-NC-SA 4.0 terms. Get the
benchmarks from [CIS](https://www.cisecurity.org/cis-benchmarks) for full audit and remediation steps.

## Limitations

This is a self-assessment, not an audit. It doesn't connect to your tenant or verify answers, and it covers your
Microsoft or Google cloud platform, not your whole environment (on-premises networks, line-of-business apps,
suppliers, physical security). Use it to start the right conversation and to prioritise, then verify.

## Stack

Vite, React, TypeScript, Tailwind CSS, Zustand, Zod, `@react-pdf/renderer`, Vitest, Playwright. Fonts (all SIL
Open Font License, self-hosted): Space Grotesk, Inter and JetBrains Mono in the app via `@fontsource`; Inter in the
PDF (`src/report/fonts/OFL.txt`). The UI design system is documented in [design.md](design.md).

## Licence

MIT. crownguard is independent and not affiliated with or endorsed by Microsoft, Google, CIS, ASD or NIST.
Product names are trademarks of their respective owners.
