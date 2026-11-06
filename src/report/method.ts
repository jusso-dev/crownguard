import { severities } from "../content/schema";
import { ratingLabels, ratingWeights } from "../engine/essentials";
import { answerValue, bandFloors, bands, likelihoodRule, RISK_SCALE } from "../engine/risk";
import { answerLabels, type Answer } from "../format/vocab";
import type { ReportModel } from "./model";
import { andList } from "../format/vocab";

const credit = (a: Answer) => `${answerLabels[a]} = ${answerValue(a)}`;
const weights = Object.entries(severities)
  .map(([s, w]) => `${s} ${w}`)
  .join(", ");
const bandRanges = bands
  .map((b, i) => `${bandFloors[b]}–${i + 1 < bands.length ? bandFloors[bands[i + 1]] - 1 : RISK_SCALE * RISK_SCALE} ${b}`)
  .join(", ");
const essentialsWeights = andList(
  (Object.entries(ratingWeights) as [keyof typeof ratingWeights, number][]).map(([r, w]) => `${ratingLabels[r].toLowerCase()} as ${w}`),
);

/**
 * The method and limitations, one paragraph each. The scoring numbers are read from the engine, so the published
 * method can't drift from the code that applies it.
 */
export function methodParagraphs(model: ReportModel): string[] {
  return [
    "This is a self-assessment. Answers were provided by the organisation and have not been independently verified. Treat it as a structured starting point for a security conversation, not as an audit or certification.",
    "Questions are drawn from current Microsoft, Google and AWS security guidance and mapped to CIS Benchmarks, the ASD Essential Eight Maturity Model, NIST CSF 2.0 and the Department of Home Affairs Industry Data Classification Framework. Each question cites its sources in the references section.",
    `Answers score ${credit("yes")}, ${credit("partial")}, ${credit("no")}. Unknown and unanswered questions also score 0, so uncertainty is never counted as protection. N/A questions are excluded. Questions are weighted by severity: ${weights}.`,
    `Likelihood (1–${RISK_SCALE}) is 1 + ${likelihoodRule.gapWeight} × the weighted gap ratio of the questions that apply to a crown jewel on its own platform (its asset type and platform-wide controls; another platform in the same assessment never counts), plus ${likelihoodRule.perExposure} for each recorded exposure, rounded. If any critical control is not in place, likelihood is at least ${likelihoodRule.criticalFloor}. Impact (1–${RISK_SCALE}) is the highest confidentiality, integrity or availability rating, plus one for regulated or highly confidential data, capped at ${RISK_SCALE}.`,
    `Risk bands: ${bandRanges}.`,
    "Where an automated scan was imported, its results pre-filled answers only when its checks were decisive (all pass = Yes, all fail = No, mixed = Partial; a pass alongside a check the scan couldn't settle, such as one needing review, is Partial). A check reported once per resource passes only when every resource passes it, and a suppressed (muted) finding is never treated as a pass. The assessor reviewed and could change every answer; scan evidence is shown against each finding, naming the scanner, its version and the account or tenant it covered.",
    ...(model.imports.length
      ? [`Scan evidence in this report came from ${andList([...new Set(model.imports.map((i) => `${i.source}${i.toolVersion ? ` ${i.toolVersion}` : ""}`))])}.`]
      : []),
    ...(model.scanEvidence.length
      ? ["Mapped scan checks are listed in full in Appendix A: Scan evidence. Unmapped failing checks from an import stay in the app and are not repeated here."]
      : []),
    "Essential Eight levels are indicative. A level is reached only when every question at that level and below is answered Yes or N/A with a reason. A level that ASD's model defines with no new requirements (patching operating systems at Maturity Level 2) is reached with the level below. Strategies outside the scope of a cloud platform, or levels not asked, are reported as not assessed.",
    "IDCF alignment is indicative. The IDCF is voluntary, has no compliance, certification or assurance process, and leaves the choice of controls to the organisation. The cyber part of each Data Security Level is read from the indicative Essential Eight results: Maturity Level 1 for DSL-2, 2 for DSL-3 and 3 for DSL-4. The authorised-person and device parts are read from the questions mapped to each level, and whole-system and data-movement questions count at every level. A level shows gaps when any mapped question at or below it is not answered Yes or N/A with a reason, and is shown as not verified when no question maps to that level's own requirements. Each crown jewel's check uses only the questions that apply to it, with the tenant-wide Essential Eight result for the cyber part. Premises security, personnel vetting, training and data residency are not assessed. The organisation chose the Data Security Levels recorded for its crown jewels; crownguard does not assign them.",
    ...(model.ism.length
      ? [
          "The ISM mapping is generated from ASD's official ISM OSCAL catalogue and pinned to the release named alongside the ISM in this report. It shows which ISM controls each question relates to, not that the organisation meets them: this is not an IRAP assessment or a statement of applicability. Where an ISM baseline is chosen, findings that touch controls the baseline includes are annotated and counted; choosing a baseline never changes a score. The Essential Eight Maturity Model remains the source of truth for maturity results.",
        ]
      : []),
    ...(model.essentials
      ? [
          `ASD Essentials results are indicative and use ASD's ${model.essentials.framework.name} (${model.essentials.framework.provisional ? `transcribed ${model.essentials.framework.release}` : `OSCAL release ${model.essentials.framework.release}`}). Each action is rated per domain from the questions tagged with it: any No gives not effective; fully effective needs every tagged question Yes or N/A and at least one Yes that covers the whole action; Partial, or Unknown alongside other answers, gives partially effective; Unknown or unanswered alone, or no tagged question, gives not assessed. Principles take the weakest rating of their actions. A domain's percentage counts ${essentialsWeights}, divided by the principles assessed; not assessed principles are counted and shown but left out of the percentage.`,
          "Priority phases are ASD's order for doing the work. They are not a rating. Essential Eight maturity levels are not converted into Essentials ratings: ASD says previous ratings do not automatically translate, and nothing in the Essentials section is calculated from them. crownguard asks about settings, not the Indicators of Good Practice an assessor checks, so this is not a formal Essentials assessment. The gap analysis classes are ASD's transition classes, which ASD describes as gap analysis findings, not ratings.",
          ...(model.essentials.framework.provisional
            ? ["ASD has not published action ids for the cloud chapter, so the CL ids in this report are provisional and will change when ASD publishes its own."]
            : []),
        ]
      : []),
    ...(model.soc
      ? [
          `The SOC maturity section is an indicative self-assessment structured on the SOC-CMM® v${model.soc.version} model (${model.soc.model.domains.length} domains, ${model.soc.aspects} aspects). Each aspect has one maturity question rated 0–5 against crownguard's own level descriptions, and each technology and service aspect also has a capability question rated 0–3. Unknown and unanswered questions score 0. An aspect's maturity is the mean of its maturity ratings and, for technology and services, its capability the mean of its capability ratings; the two are never combined. A domain scores the unweighted mean of its in-scope aspects, and the indicative overall is the mean of the assessed domains (SOC-CMM itself reports no single score). Level names use the whole-number part of the score, so 2.7 is level 2 and 3.0 is level 3. Targets default to SOC-CMM's: maturity ${model.soc.model.targets.maturity} and capability ${model.soc.model.targets.capability}.`,
          "SOC results are self-ratings from far fewer questions than SOC-CMM's own tool. They are not SOC-CMM maturity or capability scores, are not comparable with SOC-CMM benchmarks or certification, and don't affect the crown-jewel risk ratings.",
        ]
      : []),
    ...(model.aiRegister
      ? [
          `The AI use-case register uses the minimum fields in the DTA's Standard for accountability, in its order, with the owner's name and email split into two fields. Readiness questions are drawn from the Policy for the responsible use of AI in government, its standards and impact assessment guidance, the agentic AI addendum and ASD guidance; each states whether its source says must or should. Readiness is scored like the control questions: ${credit("yes")}, ${credit("partial")}, No, Unknown and unanswered = ${answerValue("no")}, N/A excluded, weighted by severity. Agent questions are asked unless the use case only gives output.`,
          "Readiness is an indicative self-check, not a policy compliance finding or a DTA assessment. Risk ratings come from the agency's own AI impact assessment; crownguard records them and doesn't work them out. The register doesn't change the crown-jewel risk ratings: any exposure it suggests must be ticked on the crown jewel itself.",
        ]
      : []),
    "This PDF is not tagged for accessibility; until react-pdf can emit a structure tree, use the crownguard app and the CSV/XLSX risk register as the accessible alternatives.",
    `crownguard is independent open-source software and is not affiliated with or endorsed by Microsoft, Google, Amazon Web Services, CIS, ASD, NIST, the Department of Home Affairs, CSIRO${model.aiRegister ? ", the Digital Transformation Agency" : ""}${model.soc ? " or SOC-CMM" : ""}. Product names are trademarks of their owners.`,
    ...(model.sourcesLastChecked ? [`Sources last checked: ${model.sourcesLastChecked}.`] : []),
  ];
}
