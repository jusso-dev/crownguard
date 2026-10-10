# Accessibility

crownguard targets [WCAG 2.2](https://www.w3.org/TR/WCAG22/) Level AA. Automated axe checks run in Playwright on every wizard step (Microsoft, Google and AWS), the start and resume cards, the AI register (including the standalone flow), the scan-import and Found apps panels including their error states, and the report step, including a 390px mobile viewport. See `e2e/a11y.spec.ts`. Report anything that falls short as a [GitHub issue](https://github.com/jusso-dev/crownguard/issues) (the `accessibility` label helps).

## How it is tested

- **Automated, every CI run.** `e2e/a11y.spec.ts` runs [axe-core](https://github.com/dequelabs/axe-core) (MIT, a devDependency — nothing is loaded at runtime) against the production build with the WCAG 2.0, 2.1 and 2.2 A and AA tags. Any violation fails the build except ones in the short, commented allowlist in the spec. Scans run with reduced motion honoured, so axe never samples a colour mid-transition.
- **Keyboard and focus.** `e2e/keyboard.spec.ts` covers what axe can't: the skip link, page titles, focus moving to each new step's heading and the step announcement, the step rail's announcements, visible focus rings, focus order, focus not obscured by the sticky header, the radio widgets from the keyboard, target size (SC 2.5.8, including its inline and spacing exceptions) and reflow at 320px (a 1280px window at 400% zoom).
- **Colour.** `src/theme/tokens.test.ts` checks every design-token pair in `src/index.css` at unit-test level: text at 4.5:1 (SC 1.4.3) and control boundaries at 3:1 (SC 1.4.11), so a colour can't drift below AA unnoticed.

## Design decisions worth knowing

- **Focus and the sticky header.** Focused elements scroll clear of the header (WCAG 2.2 SC 2.4.11) using a per-element `scroll-margin-top` set from the header's measured height. It is not `scroll-padding-top` on the scroller on purpose: scroll-padding applies to the header's own buttons as well, and since no scroll can move them out of the padding strip, browsers drag the whole page around trying — including the page you were halfway through saving from.
- **Locked steps are discoverable.** Steps you can't enter yet are `aria-disabled` and focusable rather than `disabled`, and say what unlocks them ("Complete Organisation first"), so screen-reader users know the step exists.
- **Completed steps announce as "Completed: Organisation"** rather than a bare "✓".
- **Step changes are announced** in a polite live region ("Step 3 of 9, Crown jewels") as focus moves to the new step's heading.

## Known limitations

- **The PDF report is not tagged.** Its structure isn't exposed to screen readers and it doesn't reflow. Use the on-screen Review step with assistive technology; PDF tagging is tracked separately.
- **Cover preview colours.** The branding cover preview draws the report's own colours, so if you choose brand colours with low contrast the preview text can be hard to read. The report itself darkens text to stay readable (see the note on the Branding step).
- **A screen-reader pass is a human job.** The VoiceOver and NVDA run-throughs below have not been run yet; everything marked "automated" above is verified on every CI run instead.
- This is a self-assessment tool, not a formal third-party audit.

## How to report a problem

- Security-sensitive issues: [SECURITY.md](../SECURITY.md)
- Everything else: [GitHub issues](https://github.com/jusso-dev/crownguard/issues) (label `accessibility` if you can). Say what you were doing, what you expected and what happened — a screenshot or the step name is enough.

## Manual checklist (WCAG 2.2 AA)

Items marked **automated** are verified on every CI run. Items marked **NOT RUN** need a human.

### Perceivable

| Check | Status | Notes |
| --- | --- | --- |
| Text alternatives for non-text content (1.1.1) | Automated (axe) | Decorative favicon/`aria-hidden` glyphs; meaningful controls labelled |
| Info and relationships (1.3.1) | Automated (axe) | Landmarks, headings, labelled form controls, `fieldset`/`legend` groups |
| Meaningful sequence (1.3.2) | Automated (axe) | |
| Sensory characteristics (1.3.3) | Automated (axe) | |
| Orientation (1.3.4) | Automated (axe / mobile) | 390px viewport in `e2e/a11y.spec.ts` and `e2e/mobile.spec.ts` |
| Identify input purpose (1.3.5) | Automated (axe) | |
| Use of colour (1.4.1) | Automated (axe) | |
| Contrast (minimum) (1.4.3) | Automated (axe) + unit test | Including placeholder text; token pairs unit tested at 4.5:1 |
| Resize text (1.4.4) | NOT RUN | Manual zoom check |
| Images of text (1.4.5) | Automated (axe) | |
| Reflow (1.4.10) | Automated | No horizontal overflow at 320px (400% zoom) or 390px |
| Non-text contrast (1.4.11) | Automated + unit test | `--color-field` boundaries ≥ 3:1 on paper, surface and sunken |
| Text spacing (1.4.12) | NOT RUN | Manual |
| Content on hover or focus (1.4.13) | Automated (axe) | |

### Operable

| Check | Status | Notes |
| --- | --- | --- |
| Keyboard (2.1.1) | Automated (Playwright) | Skip link, step nav, Next focus move, radio widgets |
| No keyboard trap (2.1.2) | Automated (axe) | |
| Character key shortcuts (2.1.4) | Automated (axe) | Ctrl/⌘ S only |
| Timing adjustable / pause (2.2.*) | N/A | No time limits |
| Three flashes (2.3.1) | Automated (axe) | |
| Bypass blocks (2.4.1) | Automated (Playwright) | "Skip to main content" first on Tab |
| Page titled (2.4.2) | Automated (Playwright) | `Step \| Org \| crownguard` |
| Focus order (2.4.3) | Automated (Playwright) | |
| Link purpose (2.4.4) | Automated (axe) | |
| Multiple ways (2.4.5) | N/A | Single-page wizard |
| Headings and labels (2.4.6) | Automated (axe) | |
| Focus visible (2.4.7) | Automated (Playwright) | 2px accent `:focus-visible` outline on every stop |
| Focus not obscured (minimum) (2.4.11) | Automated (Playwright) | Per-element scroll margin + bounding-box check when tabbing backwards |
| Focus not obscured (enhanced) (2.4.12) | N/A | AAA |
| Label in name (2.5.3) | Automated (axe) | |
| Target size (minimum) (2.5.8) | Automated (axe + Playwright) | 24×24 or SC 2.5.8's inline/spacing exceptions; see the allowlist note in `e2e/a11y.spec.ts` for the sticky-header overlay case |

### Understandable

| Check | Status | Notes |
| --- | --- | --- |
| Language of page (3.1.1) | Automated (axe) | `lang="en-AU"` |
| On focus / on input (3.2.1 / 3.2.2) | Automated (axe) | |
| Consistent navigation / identification (3.2.3 / 3.2.4) | Automated (axe) | |
| Error identification / labels / suggestion (3.3.*) | Automated (axe + Playwright) | ABN, N/A reason and colour hex: `aria-invalid`, `aria-describedby`, plain-language fix text |
| Redundant entry (3.3.7) | N/A | |
| Accessible authentication (3.3.8) | N/A | No auth |

### Robust

| Check | Status | Notes |
| --- | --- | --- |
| Parsing / name, role, value (4.1.1 / 4.1.2) | Automated (axe) | Checkbox state comes from the real control, not the "✓" glyph |
| Status messages (4.1.3) | Automated (Playwright) | Polite live region on step change; `role="status"`/`role="alert"` notices |

### Manual run-through: full Microsoft 365 journey and the AI register

Keyboard-only run-through of the full Microsoft 365 journey (organisation → environment → crown jewels → controls →
SOC maturity → AI register → review → branding → report) and of the standalone AI register.

| Check | Result |
| --- | --- |
| Complete both flows with the keyboard alone | Pass — automated (`e2e/keyboard.spec.ts`) |
| First Tab reaches "Skip to main content"; Enter puts focus in `main` | Pass — automated |
| Focus moves to the new step's heading after Next/Back, and the step is announced | Pass — automated |
| Step rail: completed and locked steps announced; locked steps don't navigate | Pass — automated (accessibility snapshot) |
| Focused elements aren't hidden under the sticky header when tabbing backwards | Pass — automated |
| Radio groups (controls answers, impact ratings, SOC and AI choices) work with arrows, Home and End | Pass — automated |
| VoiceOver (macOS) full Microsoft journey and AI register | **NOT RUN** — needs a human |
| NVDA (Windows) full Microsoft journey and AI register | **NOT RUN** — needs a human |

Do not mark the screen-reader rows done without a real pass on real hardware.
