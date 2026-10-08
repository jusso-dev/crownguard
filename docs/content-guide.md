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
licence tiers (each a set of licence features), and question domains.

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
