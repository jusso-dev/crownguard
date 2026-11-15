import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import layerBoundaries from "./scripts/eslint/layer-boundaries.js";

export default tseslint.config(
  { ignores: ["dist", "dist-desktop", "src-tauri", "playwright-report", "test-results", "public/trusted-types.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    plugins: { local: { rules: { "layer-boundaries": layerBoundaries } } },
    rules: { "local/layer-boundaries": "error" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
