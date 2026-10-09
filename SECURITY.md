# Security policy

crownguard is a client-side security assessment tool. It asks people to describe what would hurt most if it were
compromised, so its own security matters.

## Reporting a vulnerability

Please report vulnerabilities privately with [GitHub's private vulnerability reporting](https://github.com/jusso-dev/crownguard/security/advisories/new)
(Security tab → "Report a vulnerability"). Please don't open a public issue for one.

Please include:

- what is affected (the app, a content file, a workflow, or the build),
- how to reproduce it, with a browser and version where that matters,
- what you think the impact is,
- whether you have told anyone else.

You'll get an acknowledgement within three business days, and a plan within ten. If a fix needs a coordinated release,
we'll agree a date with you. Fixes are credited unless you'd rather not be named.

## Scope

**In scope**

- The application in `src/`, including the assessment engine, the saved-file handling and the PDF report.
- The build and deployment workflows in `.github/workflows/`, and the dependency and provenance controls around them.
- The content pipeline in `scripts/`, where a flaw would let bad content through validation and mislead an assessor.

**Out of scope**

- The accuracy of the questions, mappings or citations in `content/`. A mistake there is a content bug: open a normal
  issue or a pull request (see [CONTRIBUTING.md](CONTRIBUTING.md)).
- The vendor guidance pages crownguard cites. Report those to the vendor.
- Findings that need the user's own browser or machine to be compromised already.
- Denial of service against GitHub Pages or GitHub itself.

## What counts as a vulnerability here

Anything that could put an assessor's answers at risk. The clearest example: crownguard must never send assessment
data anywhere. There is no backend, no analytics and no network call that leaves the app's own origin. **A change that
makes assessment data leave the device is a vulnerability**, even if it is well intentioned — please report it.
`e2e/privacy.spec.ts` exists to stop that happening by accident.

Other things worth reporting: script injection through a saved file, a logo or content; a way to read another origin's
localStorage through the shared GitHub Pages origin; a dependency or workflow change that would ship untrusted code to
users' browsers; or a flaw that makes the saved `.crownguard.json` lose or corrupt data.

## Safe harbour

We won't pursue legal action against a good-faith reporter who tests against their own data, stays within scope, and
doesn't access anyone else's assessment.

## Supported versions

There is one version: whatever `main` deploys to <https://jusso-dev.github.io/crownguard/>. Security fixes land there
as soon as they're ready.
