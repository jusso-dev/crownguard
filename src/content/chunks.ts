/**
 * The JSON the Vite content plugin (`scripts/vite-content.ts`) builds from the YAML and the browser catalogue reads:
 * one shared chunk, one per platform, and the full frameworks the report needs.
 */
import type { Catalogue, Framework, ImportMapping, PlatformBundle, Source } from "./schema";

export interface SharedContentJson {
  hash: string;
  sources: Record<string, Source>;
  frameworks: Record<string, Framework>;
  platforms: Record<string, { platform: PlatformBundle["platform"] }>;
  imports: Record<string, ImportMapping>;
  soc?: Catalogue["soc"];
  aiRegister?: Catalogue["aiRegister"];
  questionIds: string[];
  platformIds: string[];
}

export interface PlatformContentJson {
  id: string;
  assetTypes: PlatformBundle["assetTypes"];
  questions: PlatformBundle["questions"];
}

export interface ReportContentJson {
  frameworks: Record<string, Framework>;
}

export const SHARED_ID = "virtual:crownguard-content/shared";
export const REPORT_ID = "virtual:crownguard-content/report";
/** A module mapping each platform id to a lazy import of its chunk. */
export const PLATFORM_LOADERS_ID = "virtual:crownguard-content/platforms";
export const platformVirtualId = (id: string) => `virtual:crownguard-content/platform/${id}`;
