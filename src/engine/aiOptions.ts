/**
 * Option lists for the optional AI use-case register. The register fields (technology, lifecycle, technical standard,
 * domain, usage pattern, Appendix C criteria, risk ratings) use the DTA's own wording; autonomy, access and data handled
 * are crownguard's additions, drawn from the agentic AI addendum and ASD guidance. `aiFieldSources` cites each.
 */

/** "AI technology type", Standard for accountability. */
export const aiTechnologies = {
  "generative-ai": "Generative AI",
  "machine-learning": "Machine Learning",
  "natural-language-processing": "Natural Language Processing",
  "computer-vision": "Computer Vision",
} as const;
export type AiTechnology = keyof typeof aiTechnologies;

/** "Lifecycle stage", Standard for accountability (the AI technical standard's lifecycle). */
export const aiLifecycles = { discover: "Discover", operate: "Operate", retire: "Retire" } as const;
export type AiLifecycle = keyof typeof aiLifecycles;

/** "Use of Technical standard for government's use of artificial intelligence", Standard for accountability. */
export const aiStandardUse = { "not-applied": "Not applied", "partially-applied": "Partially applied", "fully-applied": "Fully applied" } as const;
export type AiStandardUse = keyof typeof aiStandardUse;

/** Domains, Classification system for AI use v2.0. */
export const aiDomains = {
  "service-delivery": "Service delivery",
  "compliance-fraud": "Compliance and fraud detection",
  "law-enforcement": "Law enforcement, intelligence and security",
  "policy-legal": "Policy and legal",
  scientific: "Scientific",
  corporate: "Corporate and enabling",
} as const;
export type AiDomain = keyof typeof aiDomains;

/** Usage patterns, Classification system for AI use v2.0. */
export const aiUsagePatterns = {
  "decision-making": "Decision making and administrative action",
  analytics: "Analytics for insights",
  "workplace-productivity": "Workplace productivity",
  "image-processing": "Image processing",
} as const;
export type AiUsagePattern = keyof typeof aiUsagePatterns;

/** Appendix C of the policy: a use case is in scope if any of these apply. "none" records that none do. */
export const aiCriteria = {
  c1: "Criterion 1: it could cause more than insignificant harm to individuals, communities, organisations, the environment or the collective rights of cultural groups, including First Nations peoples",
  c2: "Criterion 2: it materially influences administrative decisions that affect them",
  c3: "Criterion 3: the public may directly interact with it, or be significantly affected by it or its outputs, without human review",
  c4: "Criterion 4: it's designed to use personal or sensitive data (Privacy Act) or security classified information (PSPF)",
  c5: "Criterion 5: the DTA has directed that it's elevated risk",
  none: "None of these: not in scope of the policy",
} as const;
export type AiCriterion = keyof typeof aiCriteria;

/** Inherent and residual risk ratings, from the AI impact assessment tool. */
export const aiRiskRatings = { low: "Low", medium: "Medium", high: "High" } as const;
export type AiRiskRating = keyof typeof aiRiskRatings;

/** Oversight model, using the addendum's key terms. */
export const aiAutonomy = {
  assists: { label: "Gives output only", detail: "It drafts, summarises, answers or recommends. A person decides what to do with the output, and it takes no actions itself." },
  hitl: { label: "Acts with approval (human in the loop)", detail: "It can take actions, but a person reviews and approves each one before it happens." },
  hotl: { label: "Acts under supervision (human on the loop)", detail: "It takes actions on its own while a person monitors it and can pause or override it." },
  hootl: { label: "Acts unsupervised (human out of the loop)", detail: "It takes actions on its own, checked only by periodic audits." },
  unknown: { label: "Not sure", detail: "Treated as an agent until you find out, so the agent questions are shown." },
} as const;
export type AiAutonomy = keyof typeof aiAutonomy;

export const aiAccess = {
  none: { label: "No access to your systems", detail: "It only sees what people type, paste or upload into it." },
  delegated: { label: "Acts as the signed-in user", detail: "Delegated access: it can reach whatever the person using it can." },
  scoped: { label: "Its own access, limited", detail: "Its own identity or app registration, limited to specific sites, mailboxes, folders or APIs." },
  "org-wide": { label: "Its own access, organisation-wide", detail: "Its own identity with tenant-wide or domain-wide permissions, such as reading all mail or files." },
  privileged: { label: "Administrative access", detail: "It can change configuration, permissions or other identities." },
  unknown: { label: "Not sure", detail: "Counts as a gap in the register until someone checks." },
} as const;
export type AiAccess = keyof typeof aiAccess;

export const aiData = {
  public: "Public information",
  official: "Internal or OFFICIAL information",
  personal: "Personal information (Privacy Act)",
  sensitive: "Sensitive information, such as health information (Privacy Act)",
  classified: "Security classified information (PSPF)",
  indigenous: "Indigenous data",
  unknown: "Not sure",
} as const;
export type AiDataKind = keyof typeof aiData;

/** When a readiness question is asked. "agentic" covers anything that can take actions, or might. */
export const aiConditions = {
  all: "Every use case",
  agentic: "AI that can take actions (agents)",
  "personal-data": "Use cases handling personal or sensitive information",
  "indigenous-data": "Use cases handling Indigenous data",
  "in-scope": "Use cases in scope of the policy",
  "high-risk": "Use cases with a high inherent risk rating",
  "public-tool": "Public generative AI tools",
} as const;
export type AiCondition = keyof typeof aiConditions;

/** Where a readiness question's expectation comes from, and how firm it is. */
export const aiBases = {
  "policy-must": "Policy: must",
  "standard-must": "AI technical standard: must",
  "addendum-must": "Agentic AI addendum: must",
  "addendum-should": "Agentic AI addendum: should",
  guidance: "DTA or ASD guidance",
} as const;
export type AiBasis = keyof typeof aiBases;
