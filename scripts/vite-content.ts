/**
 * Build-time content: YAML → validated JSON virtual modules.
 * Browser never sees the yaml package or raw YAML.
 */
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { contentDigest, loadCatalogue } from "../src/content/loader";
import type { Catalogue, Framework, ImportMapping, PlatformBundle, Source } from "../src/content/schema";
import { readContentFiles } from "./read-content";

export const SHARED_ID = "virtual:crownguard-content/shared";
export const REPORT_ID = "virtual:crownguard-content/report";
export const platformVirtualId = (id: string) => `virtual:crownguard-content/platform/${id}`;

const RESOLVED = "\0";

/** Frameworks the wizard needs fully before the report (E8 titles on Controls/Review). */
const WIZARD_FULL_FRAMEWORKS = new Set(["essential-eight"]);

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

function stubFramework(f: Framework): Framework {
  if (WIZARD_FULL_FRAMEWORKS.has(f.id)) return f;
  return { ...f, controls: [] };
}

export function buildContentModules(catalogue: Catalogue): {
  shared: SharedContentJson;
  platforms: Record<string, PlatformContentJson>;
  report: ReportContentJson;
} {
  const sources = Object.fromEntries(catalogue.sources);
  const frameworksFull = Object.fromEntries(catalogue.frameworks);
  const frameworksStub = Object.fromEntries([...catalogue.frameworks].map(([id, f]) => [id, stubFramework(f)]));
  const platformsMeta = Object.fromEntries(
    [...catalogue.platforms].map(([id, b]) => [id, { platform: b.platform }]),
  );
  const imports = Object.fromEntries(catalogue.imports);
  const platformIds = [...catalogue.platforms.keys()].sort();
  const questionIds = [
    ...platformIds.flatMap((id) => catalogue.platforms.get(id)!.questions.map((q) => q.id)),
    ...(catalogue.soc?.questions.map((q) => q.id) ?? []),
  ].sort();

  const platforms: Record<string, PlatformContentJson> = {};
  for (const id of platformIds) {
    const b = catalogue.platforms.get(id)!;
    platforms[id] = { id, assetTypes: b.assetTypes, questions: b.questions };
  }

  return {
    shared: {
      hash: contentDigest(catalogue),
      sources,
      frameworks: frameworksStub,
      platforms: platformsMeta,
      imports,
      soc: catalogue.soc,
      aiRegister: catalogue.aiRegister,
      questionIds,
      platformIds,
    },
    platforms,
    report: { frameworks: frameworksFull },
  };
}

function loadOrThrow(): ReturnType<typeof buildContentModules> {
  const { catalogue, errors } = loadCatalogue(readContentFiles());
  if (errors.length) throw new Error(`Invalid content:\n${errors.join("\n")}`);
  return buildContentModules(catalogue);
}

function asModule(data: unknown): string {
  return `export default ${JSON.stringify(data)};`;
}

export function crownguardContent(): Plugin {
  const root = resolve(import.meta.dirname, "..");
  let cached: ReturnType<typeof buildContentModules> | undefined;

  const get = () => {
    cached ??= loadOrThrow();
    return cached;
  };

  return {
    name: "crownguard-content",
    buildStart() {
      cached = undefined;
      get();
    },
    configureServer(server) {
      const dir = resolve(root, "content");
      server.watcher.add(dir);
      server.watcher.on("all", (_event, file) => {
        if (!file || !file.replace(/\\/g, "/").includes("/content/") || !file.endsWith(".yaml")) return;
        cached = undefined;
        for (const id of [SHARED_ID, REPORT_ID, ...get().shared.platformIds.map(platformVirtualId)]) {
          const mod = server.moduleGraph.getModuleById(RESOLVED + id);
          if (mod) void server.reloadModule(mod);
        }
      });
    },
    resolveId(id) {
      if (id === SHARED_ID || id === REPORT_ID || id.startsWith("virtual:crownguard-content/platform/")) {
        return RESOLVED + id;
      }
    },
    load(id) {
      if (id === RESOLVED + SHARED_ID) return asModule(get().shared);
      if (id === RESOLVED + REPORT_ID) return asModule(get().report);
      if (id.startsWith(RESOLVED + "virtual:crownguard-content/platform/")) {
        const pid = id.slice((RESOLVED + "virtual:crownguard-content/platform/").length);
        const chunk = get().platforms[pid];
        if (!chunk) throw new Error(`Unknown platform content module: ${pid}`);
        return asModule(chunk);
      }
    },
  };
}
