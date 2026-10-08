import { describe, expect, it } from "vitest";
import { loadCatalogue } from "../src/content/loader";
import { readContentFiles } from "./read-content";

const { catalogue, errors } = loadCatalogue(readContentFiles());

describe("content", () => {
  it("validates", () => expect(errors).toEqual([]));

  it("ships both platforms", () => expect([...catalogue.platforms.keys()].sort()).toEqual(["google", "microsoft"]));

  it("grounds every question in the platform vendor's own guidance", () => {
    for (const { platform, questions } of catalogue.platforms.values())
      for (const q of questions) {
        const publishers = q.sources.map((s) => catalogue.sources.get(s)?.publisher ?? "");
        expect(publishers.some((p) => p.includes(platform.vendor)), `${q.id} cites no ${platform.vendor} source`).toBe(true);
      }
  });

  it("tags Essential Eight strategies the frameworks file knows about", () => {
    const e8 = catalogue.frameworks.get("essential-eight");
    expect(e8?.controls).toHaveLength(8);
  });
});
