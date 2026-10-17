# Terminal app

`tui/` is crownguard as a terminal app, written in Rust with [Ratatui](https://ratatui.rs). It builds to one binary
with the whole question catalogue inside it, so it runs with no browser, no Node and no network. It reads and writes
the same `.crownguard.json` files as the web app, so you can start an assessment in one and finish it in the other.

## Build and run

You need a Rust toolchain (1.85 or later, from [rustup](https://rustup.rs)).

```sh
cargo build --release --manifest-path tui/Cargo.toml
./tui/target/release/crownguard riverbend.crownguard.json
```

Or, from a checkout with `pnpm` set up, `pnpm tui riverbend.crownguard.json`.

The binary at `tui/target/release/crownguard` has everything it needs: copy it to another machine of the same OS and
architecture and run it there. The catalogue is the `content/` YAML at the time you built it, so rebuild after pulling
content changes.

If the file doesn't exist yet, you start a new assessment and **Ctrl+S** creates it. With no file argument it uses
`assessment.crownguard.json` in the current directory.

## Steps

1. **Organisation**: name, ABN, sector, size, jurisdiction, obligations, and who the report is prepared for and by.
2. **Environment**: platforms (Microsoft 365, Google Workspace, AWS), optional modules such as Azure or Google
   Cloud, and the licence tier for each.
3. **Crown jewels**: add, edit and remove crown jewels with the same fields as the web app. The details panel shows
   each asset type's discovery prompts and examples, and the jewel's current risk.
4. **Controls**: every question in scope, with why it matters, what yes looks like, how to fix it, licence gaps, the
   crown jewels it protects and any scan evidence. N/A asks for a reason; without one it counts as unanswered.
5. **Review**: control posture and answer confidence, the 5×5 heatmap, crown-jewel risks with their top gaps, domain
   posture, indicative Essential Eight maturity and the 30/60/90-day roadmap.

Press **?** for keys. The ones you'll use most: **Tab** / **1**–**5** to move between steps, **↑ ↓** to move,
**Enter** to edit, **Space** to tick, **← →** to change a choice, **y p n u a** to answer, **Ctrl+S** to save and
**q** to quit (it asks first if there are unsaved changes).

## What stays in the web app

The terminal app covers the crown-jewel assessment. These are kept in the file untouched, and you work on them in the
web app:

- **The PDF report**, logo and colours. Open the file in the web app (**Open file**) or run
  `pnpm cg render <file> report.pdf`.
- **Scan import.** Use the web app or `pnpm cg import`. Evidence already in the file is shown on each question.
- **SOC maturity** and the **AI use-case register**, including AI-register-only files, which it won't open.
- **Encrypted files.** Open them in the web app and save an unencrypted copy.

A file from a newer crownguard opens read-only, as it does in the web app.

## Scripts

`crownguard score <file>` prints the crown-jewel part of `pnpm cg score`'s JSON (posture, counts, risks, domains,
Essential Eight, roadmap) with the same keys; `--format text` prints the short summary. Exit codes follow
[the Node CLI](cli.md#exit-codes).

## Keeping it in step with the web app

The scoring in `tui/src/engine.rs` is a port of `src/engine/`. The TypeScript engine is the reference, and
`pnpm tui:parity` scores the e2e fixtures and 300 random assessments with both and fails on any difference. CI runs it
along with `cargo fmt`, `clippy` and `cargo test`. If you change the scoring rules, change both.

The file format follows `src/wizard/assessmentSchema.ts`: a test checks that what the terminal app saves passes the
published JSON Schema in `public/schema/`.
