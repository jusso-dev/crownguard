import { describe, expect, it } from "vitest";
import { loadCatalogue } from "../src/content/loader";
import { buildContentModules } from "./vite-content";
import { readContentFiles } from "./read-content";

describe("vite content modules", () => {
  const { catalogue, errors } = loadCatalogue(readContentFiles());
  const modules = buildContentModules(catalogue);

  it("validates the source catalogue", () => {
    expect(errors).toEqual([]);
  });

  it("matches loadCatalogue question ids per platform", () => {
    for (const [id, bundle] of catalogue.platforms) {
      const chunk = modules.platforms[id];
      expect(chunk, id).toBeDefined();
      expect(chunk.questions.map((q) => q.id).sort()).toEqual(bundle.questions.map((q) => q.id).sort());
      expect(chunk.assetTypes.map((a) => a.id).sort()).toEqual(bundle.assetTypes.map((a) => a.id).sort());
    }
    expect(modules.shared.platformIds.sort()).toEqual([...catalogue.platforms.keys()].sort());
  });

  it("keeps essential-eight controls in shared and full frameworks in report", () => {
    expect(modules.shared.frameworks["essential-eight"]?.controls.length).toBeGreaterThan(0);
    expect(modules.shared.frameworks.ism?.controls ?? []).toEqual([]);
    expect(modules.report.frameworks.ism.controls.length).toBeGreaterThan(0);
    expect(modules.shared.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
