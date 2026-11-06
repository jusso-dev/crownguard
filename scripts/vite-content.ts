/**
 * Build-time content: YAML → validated JSON virtual modules.
 * Browser never sees the yaml package or raw YAML.
 */
import type { Plugin } from "vite";
import { contentDigest, loadCatalogue } from "../src/content/loader";
import {
  PLATFORM_LOADERS_ID,
  platformVirtualId,
  REPORT_ID,
  SHARED_ID,
  type PlatformContentJson,
  type ReportContentJson,
  type SharedContentJson,
} from "../src/content/chunks";
import { answerableQuestionIds, type Catalogue, type Framework } from "../src/content/schema";
import { repoPath } from "./lib/repo";
import { readContentFiles } from "../src/content/disk";

const RESOLVED = "\0";

/** Frameworks the wizard needs fully before the report (E8 titles on Controls/Review). */
const WIZARD_FULL_FRAMEWORKS = new Set(["essential-eight"]);

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
  const questionIds = answerableQuestionIds(catalogue).sort();

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
      const dir = repoPath("content");
      server.watcher.add(dir);
      server.watcher.on("all", (_event, file) => {
        if (!file || !file.replace(/\\/g, "/").includes("/content/") || !file.endsWith(".yaml")) return;
        cached = undefined;
        for (const id of [SHARED_ID, REPORT_ID, PLATFORM_LOADERS_ID, ...get().shared.platformIds.map(platformVirtualId)]) {
          const mod = server.moduleGraph.getModuleById(RESOLVED + id);
          if (mod) void server.reloadModule(mod);
        }
      });
    },
    resolveId(id) {
      if (id === SHARED_ID || id === REPORT_ID || id === PLATFORM_LOADERS_ID || id.startsWith(platformVirtualId(""))) {
        return RESOLVED + id;
      }
    },
    load(id) {
      if (id === RESOLVED + SHARED_ID) return asModule(get().shared);
      if (id === RESOLVED + REPORT_ID) return asModule(get().report);
      if (id === RESOLVED + PLATFORM_LOADERS_ID) {
        const entries = get().shared.platformIds.map((pid) => `${JSON.stringify(pid)}: () => import(${JSON.stringify(platformVirtualId(pid))})`);
        return `export default {${entries.join(", ")}};`;
      }
      if (id.startsWith(RESOLVED + platformVirtualId(""))) {
        const pid = id.slice((RESOLVED + platformVirtualId("")).length);
        const chunk = get().platforms[pid];
        if (!chunk) throw new Error(`Unknown platform content module: ${pid}`);
        return asModule(chunk);
      }
    },
  };
}
