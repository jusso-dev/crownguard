# Design — crownguard

The locked design system for the crownguard web app. Every UI change reads this file first.
Extend or amend it when the system needs to grow; don't restyle individual views ad hoc.
The PDF report is separate: it takes the user's own logo and colours (see `src/report/`).

## Genre
modern-minimal

## Macrostructure family
- App views (all seven wizard steps): **Workbench**. A flush header bar, a step rail on the left
  (horizontal scroller on mobile), and one working column. Views vary only in their content blocks.
- No marketing pages. No enrichment, illustration or decorative background anywhere.

## Theme — Cobalt (instrument panel)
Tokens live in `src/index.css` (`@theme`) and generate the Tailwind utilities (`bg-paper`, `text-ink`, `border-rule`, …).

| Token | Value | Use |
|---|---|---|
| `--color-paper` | oklch(98.5% 0.004 250) | Page ground |
| `--color-surface` | oklch(99.6% 0.002 250) | Cards, inputs |
| `--color-sunken` | oklch(96.4% 0.006 252) | Hover fills, reference chips |
| `--color-ink` | oklch(24% 0.02 258) | Headings, selected states |
| `--color-ink-2` | oklch(34% 0.018 257) | Body text |
| `--color-muted` | oklch(49% 0.016 257) | Secondary text (6.0:1 on paper) |
| `--color-rule` / `--color-rule-2` | oklch(91.5% …) / oklch(84% …) | Hairlines |
| `--color-field` | oklch(66% 0.012 256) | Form-control boundaries (3:1, WCAG 1.4.11) |
| `--color-graphite` | oklch(22% 0.016 260) | The one dark beat (Review headline numbers) |
| `--color-accent` | oklch(53% 0.2 257) | Cobalt signal (white text 5.2:1) |
| `--color-focus` | = accent | Focus ring |
| `ok / warn / danger` | see `src/index.css` | Status text and notices |
| `sev-*`, `band-*` | see `src/index.css` | Severity badges, risk bands, heatmap |

Accent discipline: cobalt only on the primary button, the current step, the active section tab,
progress bars, links and focus rings. Under 5 % of any viewport. Selected options use **ink fill**, not cobalt.

## Typography
- Display: Space Grotesk Variable 600, tracking −0.02em, always roman.
- Body: Inter Variable 400/500, 15 px base, line-height 1.55.
- Mono (outlier): JetBrains Mono 400/500 — question ids, step numbers, counts, UPPERCASE labels (`mono-label`, 0.06em).
- All self-hosted via `@fontsource` (strict CSP: no external fonts).
- Prose max width 68–72ch.

## Spacing and shape
- Tailwind's 4 px scale. Controls min-height 36 px.
- Radii: `--radius-control` 6 px (buttons, inputs, chips), `--radius-card` 10 px. No pills.
- Hairline borders define surfaces. No drop shadows, no glass, no gradients.

## Motion
- Colour transitions only, 150 ms, `--ease-out`. Progress width eases 300 ms.
- No reveals, no scroll animation. `prefers-reduced-motion` zeroes all transitions.

## Microinteractions stance
- Silent success: autosave shows in the header status line, never a toast.
- Destructive actions (Clear data, Start new) confirm; everything else is immediate.
- Focus ring: 2 px cobalt, 2 px offset, appears instantly.
- Hover styles only under `@media (hover: hover)`.

## Component voice
- Primary button: solid cobalt, 6 px radius, white label. One per view.
- Secondary: surface fill + hairline; ghost: text only; danger: red text + hairline.
- Answer choices and impact ratings: joined segmented controls, selected = ink fill.
- Toggle chips: square check mark + label, selected = ink fill.
- Every interactive element has default, hover, focus, active, disabled; the PDF button also has loading.

## What views MUST share
The header bar, step rail, step eyebrow (`STEP 0N / 07`, stacked above the H1), button voice, card
treatment and token set.

## Exports

### tokens.css
See `src/index.css` — the `@theme` block is the canonical token file (Tailwind v4 `@theme` format).
