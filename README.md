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
- **A report people will read.** Executive summary, heatmap, crown-jewel register, risk register, findings with
  fixes and licence notes, a 30/60/90-day roadmap, indicative Essential Eight maturity, NIST CSF coverage and
  references. Your logo, your colours, your protective marking on every page.
- **Portable.** Autosaves in your browser. Export to a `.crownguard.json` file and import it later to update.

## Use it

Run it yourself:

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static site in dist/, host anywhere
```

The build is a static site with no server code. Serve `dist/` from any static host. The generated `dist/_headers`
file sets a strict Content Security Policy on hosts that read it; elsewhere, copy the headers defined in
`vite.config.ts` into your host's config.

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
and NIST CSF 2.0. A weekly workflow checks every cited link still resolves.

CIS Benchmarks are referenced by recommendation number and title only, under CIS's CC BY-NC-SA 4.0 terms. Get the
benchmarks from [CIS](https://www.cisecurity.org/cis-benchmarks) for full audit and remediation steps.

## Limitations

This is a self-assessment, not an audit. It doesn't connect to your tenant or verify answers, and it covers your
Microsoft or Google cloud platform, not your whole environment (on-premises networks, line-of-business apps,
suppliers, physical security). Use it to start the right conversation and to prioritise, then verify.

## Stack

Vite, React, TypeScript, Tailwind CSS, Zustand, Zod, `@react-pdf/renderer`, Vitest, Playwright. Report font:
[Inter](https://rsms.me/inter/) (SIL Open Font License, see `src/report/fonts/OFL.txt`).

## Licence

MIT. crownguard is independent and not affiliated with or endorsed by Microsoft, Google, CIS, ASD or NIST.
Product names are trademarks of their respective owners.
