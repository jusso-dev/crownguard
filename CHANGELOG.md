# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-21

### Added

- **Guided crown-jewel risk assessment wizard**: browser-first self-assessment covering Microsoft 365 and Entra ID (including nonprofit licence tiers), Google Workspace, and Amazon Web Services, plus optional Azure and Google Cloud security posture modules.
- **Crown-jewel discovery and risk scoring**: guided prompts across identity plane, privileged access, business data, collaboration and email, endpoints, cloud infrastructure, and AI assistants, with confidentiality, integrity, and availability impact ratings, exposures, regulatory obligations, 5x5 impact x likelihood scoring, control posture and confidence metrics, and an effort-weighted 30/60/90-day remediation roadmap.
- **Vendor-grounded control catalogue**: YAML-driven control questions citing Microsoft Learn, Google Workspace Admin Help, Google Cloud, Azure, and AWS guidance, with plain-language rationale, remediation steps, licence notes, and mandatory justifications for controls marked N/A.
- **Framework and standards alignment**:
  - Indicative ASD Essential Eight maturity assessment.
  - Optional ASD Essentials assessment (Enterprise IT and Cloud chapters) rated per domain and principle alongside the Essential Eight.
  - Australian Government Information Security Manual (ISM, September 2026 OSCAL catalogue) control mappings with an optional baseline picker (`NON_CLASSIFIED`, `OFFICIAL: Sensitive`, `PROTECTED`).
  - Department of Home Affairs Industry Data Classification Framework (IDCF) Data Security Levels (DSL-0 to DSL-5+) and Rule 2 checks per tagged crown jewel.
  - CIS Foundations Benchmarks, NIST CSF 2.0, Microsoft Cloud Security Benchmark, and AWS Foundational Security Best Practices mappings.
- **Optional SOC maturity assessment**: 37 plain-language questions aligned to the five domains and 27 aspects of the SOC-CMM v2.4 model, with explicit maturity (0-5) and technology/service capability (0-3) level descriptions, customisable targets, out-of-scope exclusions, radar visualisations, and prioritised gap guidance.
- **Optional AI use-case register and standalone mode**:
  - Register covering the Digital Transformation Agency (DTA) Standard for accountability fields, Policy for the responsible use of AI in government v2.1 (including the three v2.1 usage patterns), impact assessment guidance, agentic AI addendum, and ASD agentic AI guidance.
  - Up to 22 context-aware readiness questions tailored by oversight model, access level, and data handled, with crown-jewel linking and suggested exposure updates.
  - Standalone five-step AI register only flow (`#/ai-register`) with its own branded PDF report and a lossless upgrade path to a full assessment.
  - In-browser CSV and XLSX exports placing the DTA's minimum register fields first, plus an About sheet with key dates, caveats, and sources.
  - Shadow AI and OAuth app consent discovery via Microsoft Graph and Google Workspace OAuth grant imports.
- **Automated scan importers**: shared importer framework pre-filling decisive control answers with per-check evidence, resource counts, examples, and scanner provenance for M365-Secure (Microsoft 365, 59 questions), Prowler CSV and JSON-OCSF (AWS, 56 questions; Azure, 33 questions), and ScubaGoggles (Google Workspace, 33 questions, reading policy results only).
- **Branded PDF report generation**: in-browser (Web Worker) and Node PDF rendering with organisation logo, ABN check-digit validation, custom hex colours with contrast checks, protective markings, point-in-time and last-edited timestamps, executive summary, 5x5 risk heatmap, crown-jewel and risk registers, findings, N/A justifications, 30/60/90-day roadmap, framework alignment, and optional SOC maturity and AI register sections.
- **Versioned save format (schema v6)**: self-contained `.crownguard.json` format with published JSON Schema (`public/schema/crownguard-assessment.v6.json`), automatic migrations from v1-v5 files, read-only handling for files saved by newer builds, preservation of unknown fields, and `orphans` tracking for retired questions.
- **Offline Tauri v2 desktop app**: cross-platform desktop application for macOS, Windows, and Linux (`src-tauri/`) with local SQLite persistence, native file dialogs, `.crownguard.json` file associations, optional update checks, and a signed desktop release workflow (`desktop-release.yml`) producing installers, `SHA256SUMS`, detached Linux GPG signatures, and build provenance attestations.
- **Headless CLI**: offline Node CLI (`pnpm cg`) supporting `catalogue`, `new`, `import`, `score`, `render`, `ai-register export`, `migrate`, and `validate` for consulting workflows, CI, and automation.
- **Accessibility and responsive design**: WCAG 2.2 Level AA conformance across wizard steps and mobile viewports (390px), verified with automated axe, keyboard navigation, focus, target size, reflow, and contrast tests.
- **Automated guidance maintenance**: nightly source watch (`source-watch.yml`) tracking cited guidance pages for moves, retirements, broken links, and new content, plus nightly guidance updates (`guidance-update.yml`) refreshing ISM controls and Prowler/ScubaGoggles check mappings from upstream releases.

### Security

- **Zero-backend privacy model**: all assessment data stays on the user's device with no backend, accounts, analytics, remote fonts, CDNs, or outbound network calls during web, desktop, or CLI operation.
- **Browser data protection**: optional WebCrypto passphrase encryption (PBKDF2-SHA-256 and AES-GCM) for autosave and saved files, in-memory no-persistence mode, one-click browser storage wipe, coalesced protected autosaves, and protected recovery backups.
- **Input hardening**: bounded byte and record limits for scan and OAuth consent imports in both browser and CLI, plus automatic redaction of account email addresses in imported scanner evidence.
- **Hardened build and desktop runtime**: strict Content Security Policy with Trusted Types, minimal Tauri capability policy guarded by `pnpm check:desktop`, enforced source layer boundaries, SHA-pinned GitHub Actions with minimal permissions, build provenance attestations for GitHub Pages deployments, CodeQL, dependency review, and OpenSSF Scorecard.

[Unreleased]: https://github.com/jusso-dev/crownguard/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/jusso-dev/crownguard/releases/tag/v1.0.0
