/**
 * Every upstream whose releases crownguard pins, described once. The guidance updaters regenerate from these, the
 * generators name them in file headers, and the source watch follows their releases and reports the pinned version.
 */
import { checkedAgainst, headerTag } from "./pins";

/** An OSCAL release that a generator turns into a framework file and a pinned id list. */
export interface OscalUpstream {
  repo: string;
  /** Framework id the questions cite (`ism`). */
  framework: string;
  /** The generated framework file. Its header names the release: `at release tag <tag>`. */
  frameworkFile: string;
  /** The generated id list `pnpm test` checks the framework file against, carrying the same tag. */
  idsFile: string;
  /** The content/sources entry that links the release page (`.../releases/tag/<tag>`), when one does. */
  source?: { file: string; id: string };
}

/** A scanner whose check ids crownguard's import mappings use, pinned in id lists. */
export interface ScannerUpstream<List extends { file: string; mapping: string } = { file: string; mapping: string }> {
  repo: string;
  /** Each pinned list and the import mapping (content/imports/<mapping>.yaml) it backs. */
  lists: List[];
}

export const mappingFile = (mappingId: string): string => `content/imports/${mappingId}.yaml`;

export const ISM: OscalUpstream = {
  repo: "AustralianCyberSecurityCentre/ism-oscal",
  framework: "ism",
  frameworkFile: "content/frameworks/ism.yaml",
  idsFile: "scripts/ism/fixtures/ism-controls.txt",
  source: { file: "content/sources/standards.yaml", id: "asd-ism-oscal" },
};

export const ESSENTIALS_IT: OscalUpstream = {
  repo: "AustralianCyberSecurityCentre/e4eit-oscal",
  framework: "asd-essentials-enterprise-it",
  frameworkFile: "content/frameworks/asd-essentials-enterprise-it.yaml",
  idsFile: "scripts/essentials/fixtures/e4eit-actions.txt",
  // No `source`: asd-essentials-oscal cites ASD's releases page, not one tag, so it never needs moving.
};

export const PROWLER: ScannerUpstream<{ provider: "aws" | "azure"; file: string; mapping: string }> = {
  repo: "prowler-cloud/prowler",
  lists: [
    { provider: "aws", file: "e2e/fixtures/prowler-checks-aws.txt", mapping: "prowler-aws" },
    { provider: "azure", file: "e2e/fixtures/prowler-checks-azure.txt", mapping: "prowler-azure" },
  ],
};

export const SCUBAGOGGLES: ScannerUpstream = {
  repo: "cisagov/ScubaGoggles",
  lists: [{ file: "e2e/fixtures/scubagoggles-controls.txt", mapping: "scubagoggles" }],
};

/**
 * M365-Secure tags no releases, so nothing pins it: the source watch reads its check list from `main` each run.
 */
export const M365_SECURE = { repo: "jusso-dev/M365-Secure", ref: "main", checksPath: "docs/CHECKS.md", mapping: "m365-secure" };

/** The release the repo is on for an upstream, and the file that records it. */
export function pinnedRelease(u: OscalUpstream | ScannerUpstream, read: (path: string) => string): { file: string; tag: string } {
  if ("frameworkFile" in u) return { file: u.frameworkFile, tag: headerTag(read(u.frameworkFile)) };
  const file = mappingFile(u.lists[0].mapping);
  return { file, tag: checkedAgainst(read(file)) };
}
