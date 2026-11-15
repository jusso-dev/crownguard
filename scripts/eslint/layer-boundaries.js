import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const packages = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));

// An explicit partial policy, not a total ranking of otherwise unrelated layers.
const allowed = {
  format: [],
  lib: [],
  theme: [],
  content: ["format"],
  engine: ["content", "format"],
  imports: ["content", "engine", "format"],
  platform: ["format"],
  report: ["content", "engine", "format", "theme"],
  wizard: ["content", "engine", "format", "imports", "lib", "platform", "report", "theme"],
  cli: ["content", "engine", "format", "imports", "lib", "report"],
};
const rootModules = { App: "entry", main: "entry", zodConfig: "bootstrap" };

function layerOf(relative) {
  const parts = relative.split(path.sep);
  if (parts[0] !== "src") return null;
  if (Object.hasOwn(allowed, parts[1])) return parts[1];
  if (parts.length > 2) return null;
  const name = parts[1].replace(/\.(?:[cm]?[jt]sx?)$/, "");
  return Object.hasOwn(rootModules, name) ? rootModules[name] : null;
}

function literal(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

function memberName(node) {
  if (node?.type !== "MemberExpression") return null;
  return node.computed ? literal(node.property) : node.property.name;
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Enforce declared internal source dependencies, including tests and lazy loaders" },
    schema: [],
    messages: { boundary: '{{source}} cannot load "{{target}}": {{reason}}. Allowed destination layers: {{allowed}}.' },
  },
  create(context) {
    const filename = context.filename;
    const relative = path.relative(root, filename);
    if (!relative.startsWith(`src${path.sep}`)) return {};
    const source = layerOf(relative);
    const destinations = source === "entry"
      ? [...Object.keys(allowed), "entry", "bootstrap"]
      : source && source !== "bootstrap" ? [source, ...allowed[source]] : [];
    const report = (node, target, reason) => context.report({
      node, messageId: "boundary",
      data: { source: `${source ?? "unclassified"} (${relative})`, target, reason, allowed: destinations.join(", ") || "none" },
    });
    if (!source) return { Program: (node) => report(node, relative, "unclassified source; update the boundary policy") };

    function check(node) {
      const target = literal(node);
      if (target === null) {
        report(node, context.sourceCode.getText(node), "nonliteral module target; use a literal path");
        return;
      }
      // These spellings have no configured resolver. Do not mistake aliases for packages.
      if (/[\\%]/.test(target) || /^(?:\/|src\/|@\/|~\/|file:|#|[A-Za-z]:)/.test(target)) {
        report(node, target, "unsupported module path; use a relative path or update boundary resolution");
        return;
      }
      let destination;
      if (/^virtual:crownguard-content\/(?:shared|platforms|report|platform\/[^/?#]+)$/.test(target)) {
        destination = "content";
      } else if (target.startsWith("./") || target.startsWith("../")) {
        const resolved = path.relative(root, path.resolve(path.dirname(filename), target.split(/[?#]/)[0]));
        if (relative === path.join("src", "format", "schema.ts") && resolved === "package.json") return;
        if (!resolved.startsWith(`src${path.sep}`)) {
          report(node, target, "source cannot depend on repository tooling or files outside src");
          return;
        }
        // Assets are not code layers. Filesystem reads are not module declarations at all.
        if (/\.(?:css|svg|png|jpe?g|webp|woff2?)$/.test(resolved)) return;
        destination = layerOf(resolved);
      } else {
        const packageName = target.startsWith("@") ? target.split("/").slice(0, 2).join("/") : target.split("/")[0];
        if (isBuiltin(target) || packages.has(packageName)) return;
        report(node, target, "unsupported or undeclared module; declare its package or update boundary resolution");
        return;
      }
      if (!destination || !destinations.includes(destination)) {
        report(node, target, destination ? `target layer is ${destination}` : "unclassified target; update the boundary policy");
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => { if (node.source) check(node.source); },
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportType: (node) => check(node.source),
      TSImportEqualsDeclaration: (node) => {
        if (node.moduleReference.type === "TSExternalModuleReference") check(node.moduleReference.expression);
      },
      CallExpression(node) {
        const callee = node.callee;
        const method = memberName(callee);
        if (callee.type === "Identifier" && callee.name === "require"
          || callee.type === "MemberExpression" && callee.object.type === "Identifier" && callee.object.name === "vi"
            && ["mock", "doMock", "importActual", "importMock"].includes(method)) {
          check(node.arguments[0] ?? node);
        } else if (callee.type === "MemberExpression" && callee.object.type === "MetaProperty"
          && callee.object.meta.name === "import" && method?.startsWith("glob")) {
          report(node, "import.meta." + method, "unsupported glob loader; use literal module imports");
        }
      },
      NewExpression(node) {
        const url = node.arguments[0];
        if (node.callee.type !== "Identifier" || node.callee.name !== "Worker"
          || url?.type !== "NewExpression" || url.callee.type !== "Identifier" || url.callee.name !== "URL") return;
        const base = url.arguments[1];
        if (memberName(base) === "url" && base.object.type === "MetaProperty" && base.object.meta.name === "import") {
          check(url.arguments[0] ?? url);
        }
      },
    };
  },
};
