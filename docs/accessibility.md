# Accessibility

crownguard targets [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA. Automated axe checks run in Playwright on every wizard step (Microsoft, Google and AWS), the start and resume cards, the AI register, scan import and the report step, including a 390px mobile viewport. See `e2e/a11y.spec.ts`.

## Known limitations

- The PDF report is **not tagged**. Screen reader and reflow support for the PDF is out of scope until that work lands. Prefer the on-screen Review step for assistive technology.
- This is a self-assessment tool, not a formal third-party audit.

## How to report a problem

- Security-sensitive issues: [SECURITY.md](../SECURITY.md)
- Everything else: [GitHub issues](https://github.com/jusso-dev/crownguard/issues) (label `accessibility` if you can)

## Manual checklist (WCAG 2.2 AA)

Mark Playwright-verified items as done. VoiceOver / NVDA human passes stay **NOT RUN** until someone does them.

### Perceivable

| Check | Status | Notes |
| --- | --- | --- |
| Text alternatives for non-text content (1.1.1) | Done (axe) | Decorative favicon/`aria-hidden` glyphs; meaningful controls labelled |
| Info and relationships (1.3.1) | Done (axe) | Landmarks, headings, labelled form controls |
| Meaningful sequence (1.3.2) | Done (axe) | |
| Sensory characteristics (1.3.3) | Done (axe) | |
| Orientation (1.3.4) | Done (axe / mobile) | 390px viewport in `e2e/a11y.spec.ts` and `e2e/mobile.spec.ts` |
| Identify input purpose (1.3.5) | Done (axe) | |
| Use of colour (1.4.1) | Done (axe) | |
| Contrast (minimum) (1.4.3) | Done (axe) | |
| Resize text (1.4.4) | NOT RUN | Manual zoom check |
| Images of text (1.4.5) | Done (axe) | |
| Reflow (1.4.10) | Done (mobile e2e) | No horizontal overflow at 390px |
| Non-text contrast (1.4.11) | Done (axe) | Form-control `--color-field` ≥ 3:1 |
| Text spacing (1.4.12) | NOT RUN | Manual |
| Content on hover or focus (1.4.13) | Done (axe) | |

### Operable

| Check | Status | Notes |
| --- | --- | --- |
| Keyboard (2.1.1) | Done (Playwright) | Skip link, step nav, Next focus move |
| No keyboard trap (2.1.2) | Done (axe) | |
| Character key shortcuts (2.1.4) | Done (axe) | Ctrl/⌘ S only |
| Timing adjustable / pause (2.2.*) | N/A | No time limits |
| Three flashes (2.3.1) | Done (axe) | |
| Bypass blocks (2.4.1) | Done (Playwright) | "Skip to main content" |
| Page titled (2.4.2) | Done (Playwright) | `Step \| Org \| crownguard` |
| Focus order (2.4.3) | Done (Playwright) | |
| Link purpose (2.4.4) | Done (axe) | |
| Multiple ways (2.4.5) | N/A | Single-page wizard |
| Headings and labels (2.4.6) | Done (axe) | |
| Focus visible (2.4.7) | Done (axe) | `:focus-visible` outline |
| Focus not obscured (minimum) (2.4.11) | Done (Playwright) | `scroll-padding-top` + bounding-box check |
| Focus not obscured (enhanced) (2.4.12) | N/A | AAA |
| Label in name (2.5.3) | Done (axe) | |
| Target size (minimum) (2.5.8) | Done (audit) | Controls ≥ 24×24 CSS px; LogoField / CheckboxPill adjusted |

### Understandable

| Check | Status | Notes |
| --- | --- | --- |
| Language of page (3.1.1) | Done (axe) | `lang="en-AU"` |
| On focus / on input (3.2.1 / 3.2.2) | Done (axe) | |
| Consistent navigation / identification (3.2.3 / 3.2.4) | Done (axe) | |
| Error identification / labels / suggestion (3.3.*) | Done (axe) | |
| Redundant entry (3.3.7) | N/A | |
| Accessible authentication (3.3.8) | N/A | No auth |

### Robust

| Check | Status | Notes |
| --- | --- | --- |
| Parsing / name, role, value (4.1.1 / 4.1.2) | Done (axe) | |
| Status messages (4.1.3) | Done (Playwright) | Polite live region on step change; existing status/alert roles |

### Screen reader passes

| Pass | Status |
| --- | --- |
| VoiceOver (macOS / Safari or Chrome) full Microsoft journey + AI register | NOT RUN |
| NVDA (Windows / Firefox or Chrome) full Microsoft journey + AI register | NOT RUN |

Do not mark these Done without a human pass.
