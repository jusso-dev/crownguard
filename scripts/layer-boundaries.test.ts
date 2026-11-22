import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import ts from "typescript";
import { loadConfigFromFile } from "vite";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });
const ruleId = "local/layer-boundaries";

async function probe(filePath: string, code: string, forbidden?: string, otherRules = false) {
  const [result] = await eslint.lintText(code, { filePath });
  expect(result.fatalErrorCount, JSON.stringify(result.messages)).toBe(0);
  const boundary = result.messages.filter((message) => message.ruleId === ruleId);
  if (forbidden !== undefined) {
    expect(boundary, JSON.stringify(result.messages)).toHaveLength(1);
    expect(boundary[0].severity).toBe(2);
    expect(boundary[0].message).toContain(forbidden);
    expect(boundary[0].message).toContain(filePath.split("/")[1]);
    expect(boundary[0].message).toContain("Allowed");
  } else {
    expect(boundary).toEqual([]);
    if (!otherRules) expect(result.messages).toEqual([]);
  }
}

// Independent expectations: rows/columns are format, lib, theme, content, engine,
// imports, platform, report, wizard, cli. Do not derive these from the rule table.
const layers = ["format", "lib", "theme", "content", "engine", "imports", "platform", "report", "wizard", "cli"];
const permitted = [
  "1000000000", "0100000000", "0010000000", "1001000000", "1001100000",
  "1001110000", "1000001000", "1011100100", "1111111110", "1101110101",
];
describe("source dependency policy through repository ESLint config", () => {
  for (const suffix of ["ts", "test.ts"]) {
    for (const [row, source] of layers.entries()) {
      it.each(layers.map((target, column) => ({ target, allowed: permitted[row][column] === "1" })))(`${source}/nested/probe.${suffix} to $target`, async ({ target, allowed }) => {
        const targetPath = `../../${target}/nested/module`;
        await probe(`src/${source}/nested/probe.${suffix}`, `import "${targetPath}";`, allowed ? undefined : targetPath);
      });
    }
  }

  it.each([
    ["src/engine/engine.test.ts", "../report/model"],
    ["src/engine/aiRegister.test.ts", "../report/fixture"],
    ["src/platform/tauri.test.ts", "../wizard/persistence"],
    ["src/platform/tauri.test.ts", "../wizard/sessionSecrets"],
  ])("rejects old misplaced dependency in %s: %s", async (file, target) => {
    await probe(file, `import "${target}";`, target);
  });
  it.each([
    ["src/engine/aiRegister.test.ts", 'import { fixtureAssessment } from "./fixture"; export { fixtureAssessment };'],
    ["src/report/fixture.ts", 'export { fixtureAssessment } from "../engine/fixture";'],
    ["src/report/model.test.ts", 'import "../engine/risk"; import "./model";'],
    ["src/wizard/desktop-persistence.test.ts", 'import "../platform/tauri"; import "./persistence"; import "./sessionSecrets";'],
  ])("accepts relocated dependency in %s", async (file, code) => { await probe(file, code); });

  const syntax = [
    ['import { value } from TARGET; export { value };', false],
    ['import value from TARGET; export { value };', false],
    ['import * as value from TARGET; export { value };', false],
    ['import TARGET;', false],
    ['import type { Value } from TARGET; export type { Value };', false],
    ['import { type Value } from TARGET; export type { Value };', false],
    ['export { value } from TARGET;', false],
    ['export * from TARGET;', false],
    ['export * as value from TARGET;', false],
    ['export type { Value } from TARGET;', false],
    ['export type * from TARGET;', false],
    ['export type * as value from TARGET;', false],
    ['export type Value = import(TARGET).Value;', false],
    ['void import(TARGET);', false],
    ['void import(`PATH`);', false],
    ['export const value = require(TARGET);', true],
    ['import value = require(TARGET); export { value };', true],
    ...["mock", "doMock", "importActual", "importMock"].map((method) =>
      [`import { vi } from "vitest"; vi.${method}(TARGET);`, false] as const),
  ] as const;
  it.each(syntax)("checks syntax %s", async (template, otherRules) => {
    for (const target of ["../report/model", "../content/schema"]) {
      const code = template.replaceAll("TARGET", JSON.stringify(target)).replaceAll("PATH", target);
      await probe("src/engine/probe.test.ts", code, target.includes("report") ? target : undefined, otherRules);
    }
  });

  it.each([
    "../../LAYER/model", "../../engine/../LAYER/model", "./../../engine/../LAYER/model",
    "../../LAYER/model.ts", "../../LAYER/model.tsx", "../../LAYER/model.js",
    "../../LAYER", "../../LAYER/", "../../LAYER/index", "../../LAYER/model?worker", "../../LAYER/model?raw", "../../LAYER/model#section",
  ])("normalises %s", async (shape) => {
    for (const layer of ["report", "content"]) {
      const target = shape.replace("LAYER", layer);
      await probe("src/engine/nested/probe.ts", `import "${target}";`, layer === "report" ? target : undefined);
    }
  });
  it.each([
    "/src/report/model", "/tmp/model.ts", "src/report/model", "@/report/model", "~/report/model",
    "file:///src/report/model.ts", "#report/model", "..\\report\\model", "../%72eport/model", "%2e%2e/report/model",
    "reporting/model", "@undeclared/report", "virtual:crownguard-content/unknown",
  ])("rejects unsupported target %s", async (target) => {
    await probe("src/engine/probe.ts", `import ${JSON.stringify(target)};`, target);
  });
  it("matches complete path components", async () => {
    await probe("src/wizard/probe.ts", 'import "../reporting/model";', "../reporting/model");
  });

  it.each([
    'const target = "../report/model"; void import(target);',
    'const name = "model"; void import(`../report/${name}`);',
    'void import("../report/" + "model");',
    'const target = "../report/model"; require(target);',
    ...["mock", "doMock", "importActual", "importMock"].map((method) =>
      `import { vi } from "vitest"; const target = "../report/model"; vi.${method}(target);`),
  ])("rejects computed loader %s", async (code) => {
    await probe("src/engine/probe.test.ts", code, "nonliteral");
  });
  it.each(["glob", "globEager"])("rejects unsupported import.meta.%s", async (method) => {
    await probe("src/engine/probe.ts", `import.meta.${method}("../report/*.ts");`, "import.meta");
  });
  it.each([
    ["src/platform/index.ts", "./tauri"], ["src/report/probe.ts", "./pdf"],
    ["src/wizard/probe.ts", "../report/pdf"], ["src/content/probe.ts", "./loader"],
  ])("accepts literal lazy loading in %s", async (file, target) => {
    await probe(file, `void import("${target}");`);
  });
  it("classifies Worker module URLs without restricting data URLs or filesystem reads", async () => {
    for (const target of ["./worker.ts", "../report/worker.ts"]) {
      await probe("src/engine/probe.ts", `new Worker(new URL("${target}", import.meta.url), { type: "module" });`, target.includes("report") ? target : undefined);
    }
    await probe("src/engine/probe.ts", 'const target = "./worker.ts"; new Worker(new URL(target, import.meta.url));', "nonliteral");
    await probe("src/engine/probe.test.ts", 'import { readFileSync } from "node:fs"; readFileSync(new URL("../../e2e/fixtures/v1.json", import.meta.url)); new URL("../report/style.css", import.meta.url);');
  });

  it.each(["ts", "tsx", "d.ts", "test.ts", "js", "jsx", "mjs", "cjs", "mts", "cts"])("checks source .%s files", async (extension) => {
    await probe(`src/engine/probe.${extension}`, 'import "../report/model";', "../report/model");
    await probe(`src/engine/probe.${extension}`, 'import "../content/schema";');
  });
  it.each(["App.tsx", "main.tsx"])("allows root composition %s", async (file) => {
    await probe(`src/${file}`, 'import "./wizard/App"; import "./platform"; import "./zodConfig"; import "./index.css";');
  });
  it.each(["../App", "../main", "../zodConfig", "../new-root", "../../scripts/helper", "../../e2e/helper"])("rejects lower-layer escape %s", async (target) => {
    await probe("src/engine/probe.ts", `import "${target}";`, target);
  });
  it.each(["src/new-layer/probe.ts", "src/new-root.ts"])("rejects unclassified source %s even without imports", async (file) => {
    await probe(file, "export const value = 1;", "unclassified");
  });
  it("keeps bootstrap constrained", async () => {
    await probe("src/zodConfig.ts", 'import "zod";');
    await probe("src/zodConfig.ts", 'import "./wizard/App";', "./wizard/App");
  });
  it.each(["scripts/probe.ts", "e2e/probe.ts", "probe.config.ts"])("allows tooling consumer %s", async (file) => {
    await probe(file, 'import "./src/wizard/App";');
  });
  it("permits only the schema metadata edge", async () => {
    await probe("src/format/schema.ts", 'import "../../package.json";');
    await probe("src/format/probe.ts", 'import "../../package.json";', "../../package.json");
    await probe("src/format/schema.ts", 'import "../../tsconfig.json";', "../../tsconfig.json");
  });
  it.each(["shared", "platforms", "report", "platform/microsoft", "platform/google", "platform/aws"])("classifies virtual content %s as content", async (suffix) => {
    const target = `virtual:crownguard-content/${suffix}`;
    await probe("src/content/probe.ts", `import "${target}";`);
    await probe("src/engine/probe.ts", `import "${target}";`);
    await probe("src/format/probe.ts", `import "${target}";`, target);
  });
  it("accepts current ambient virtual declarations", async () => {
    await probe("src/content/virtual-content.d.ts", readFileSync(new URL("../src/content/virtual-content.d.ts", import.meta.url), "utf8"));
  });
  it.each(["react", "react/jsx-runtime", "@tauri-apps/api/core", "vitest", "node:fs", "fs/promises", "@fontsource-variable/inter", "./styles.css"])("accepts external package/builtin/asset %s", async (target) => {
    await probe("src/format/probe.ts", `import "${target}";`);
  });

  it("requires boundary policy review before TS or Vite aliases are added", async () => {
    const config = ts.readConfigFile(`${root}tsconfig.json`, ts.sys.readFile);
    expect(config.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    expect(parsed.options.paths).toBeUndefined();
    expect(parsed.options.baseUrl).toBeUndefined();
    for (const mode of ["production", "desktop"]) {
      const vite = await loadConfigFromFile({ command: "build", mode }, `${root}vite.config.ts`);
      expect(vite).not.toBeNull();
      expect(vite!.config.resolve?.alias).toBeUndefined();
      expect(vite!.config.resolve?.tsconfigPaths).toBeFalsy();
    }
  });
});
