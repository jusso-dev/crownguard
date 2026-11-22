import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Command-line arguments. `pnpm x -- --flag` passes the `--` separator through; it isn't ours. */
export const cliArgs = (): string[] => process.argv.slice(2).filter((a) => a !== "--");

/** True when the module at `url` (its `import.meta.url`) is the script node was started with, not an import. */
export const isMain = (url: string): boolean => !!process.argv[1] && fileURLToPath(url) === process.argv[1];

/** Token for api.github.com: GITHUB_TOKEN in Actions, GH_TOKEN where the gh CLI is set up. */
export const githubToken = (env = process.env): string | undefined => env.GITHUB_TOKEN || env.GH_TOKEN || undefined;

/** Where the repo lives when the run isn't in Actions. */
const HOME_REPO = "jusso-dev/crownguard";

/** The Actions run, when there is one. */
export const actionsRunUrl = (env = process.env): string | undefined =>
  env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;

/** Absolute link to a section of docs/content-guide.md: a pull request body can't use repo-relative links. */
export const contentGuideUrl = (anchor: string, env = process.env): string =>
  `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY ?? HOME_REPO}/blob/main/docs/content-guide.md#${anchor}`;

/** Write Actions step outputs. A value with a line break would start an output of its own, so it is refused. */
export function setOutputs(outputs: Record<string, string | boolean>, env = process.env): void {
  if (!env.GITHUB_OUTPUT) return;
  const lines = Object.entries(outputs).map(([k, v]) => {
    if (/[\r\n]/.test(String(v))) throw new Error(`step output ${k} has a line break`);
    return `${k}=${v}\n`;
  });
  appendFileSync(env.GITHUB_OUTPUT, lines.join(""));
}
