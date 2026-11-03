/**
 * Guards the desktop app's security settings so a later change can't quietly widen them. Run in CI (`pnpm
 * check:desktop`) and from scripts/desktop-config.test.ts. Exits non-zero with one line per problem.
 *
 * - No file-system permission or scope over the home directory (or any user folder, or the root), and no `**`
 *   wildcard outside the app's own data directory. Files the user picks are added to the scope at run time by the
 *   dialog plugin, so the capability never needs them.
 * - No http or shell plugin, and the opener may open https:// links only.
 * - The webview CSP is the web CSP with connect-src narrowed to the IPC bridge (vite.config.ts), with Trusted Types.
 * - freezePrototype on, withGlobalTauri off, asset protocol off, updater over https only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { desktopCspDirectives } from "../vite.config";

const root = join(import.meta.dirname, "..");
const tauriDir = join(root, "src-tauri");

type Permission = string | { identifier: string; allow?: Record<string, unknown>[]; deny?: Record<string, unknown>[] };
interface Capability {
  identifier: string;
  permissions: Permission[];
}

/** Base directories a capability may scope the file system to: the app's own folders and nothing of the user's. */
const APP_DIRS = ["$APPDATA", "$APPLOCALDATA", "$APPCONFIG", "$APPCACHE", "$APPLOG"];

/** Tauri's prebuilt fs permission sets that name a user folder, e.g. fs:allow-home-read-recursive, fs:scope-download. */
const USER_DIR_PERMISSION = /^fs:(allow|scope|read|write)-(home|desktop|document|download|picture|video|audio|public|resource|temp|cache|config|data|localdata|font|exe|runtime|template)\b/;

const FORBIDDEN_PLUGINS = /^(http|shell|sql|process|os|clipboard-manager|global-shortcut|websocket|upload|updater):/;

export function checkCapability(name: string, cap: Capability): string[] {
  const problems: string[] = [];
  for (const p of cap.permissions) {
    const id = typeof p === "string" ? p : p.identifier;
    if (FORBIDDEN_PLUGINS.test(id)) problems.push(`${name}: ${id} is not allowed in the desktop app`);
    if (USER_DIR_PERMISSION.test(id)) problems.push(`${name}: ${id} grants file access to a user folder`);
    if (id === "fs:default" || id === "opener:default" || id === "opener:allow-open-path" || id === "opener:allow-reveal-item-in-dir")
      problems.push(`${name}: ${id} is wider than the app needs`);
    if (typeof p === "string") continue;
    for (const entry of [...(p.allow ?? [])]) {
      if (id.startsWith("fs:")) {
        const path = String(entry.path ?? "");
        const base = path.split("/")[0];
        if (!APP_DIRS.includes(base))
          problems.push(`${name}: ${id} scope "${path}" is outside the app data directory (no $HOME, user folders, absolute paths or wildcards)`);
      }
      if (id.startsWith("opener:")) {
        const url = String(entry.url ?? entry.path ?? "");
        if (!url.startsWith("https://")) problems.push(`${name}: ${id} scope "${url}" must be https:// only`);
      }
    }
  }
  return problems;
}

export function checkConfig(conf: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const app = conf.app as { withGlobalTauri?: boolean; security?: Record<string, unknown> };
  const security = app?.security ?? {};
  const csp = security.csp;
  if (csp !== desktopCspDirectives.join("; "))
    problems.push(`tauri.conf.json: app.security.csp must be exactly desktopCspDirectives from vite.config.ts:\n  ${desktopCspDirectives.join("; ")}`);
  if (security.freezePrototype !== true) problems.push("tauri.conf.json: app.security.freezePrototype must be true");
  if (security.dangerousDisableAssetCspModification) problems.push("tauri.conf.json: dangerousDisableAssetCspModification must be off");
  if ((security.assetProtocol as { enable?: boolean } | undefined)?.enable) problems.push("tauri.conf.json: the asset protocol must stay disabled");
  if (app?.withGlobalTauri) problems.push("tauri.conf.json: app.withGlobalTauri must be false");
  const build = conf.build as { devUrl?: string; frontendDist?: string };
  if (build?.devUrl && !/^http:\/\/localhost:\d+\/?$/.test(build.devUrl)) problems.push("tauri.conf.json: build.devUrl must be a localhost dev server");
  if (!build?.frontendDist || /^https?:/.test(build.frontendDist)) problems.push("tauri.conf.json: build.frontendDist must be the bundled local build");
  const updater = (conf.plugins as { updater?: { endpoints?: string[] } } | undefined)?.updater;
  for (const e of updater?.endpoints ?? []) if (!e.startsWith("https://")) problems.push(`tauri.conf.json: updater endpoint ${e} must be https://`);
  return problems;
}

export function checkCargo(toml: string): string[] {
  return ["tauri-plugin-http", "tauri-plugin-shell", "tauri-plugin-sql"]
    .filter((c) => new RegExp(`^${c}\\s*=`, "m").test(toml))
    .map((c) => `Cargo.toml: ${c} is not allowed in the desktop app`);
}

export function checkDesktopConfig(dir = tauriDir): string[] {
  const problems: string[] = [];
  const capDir = join(dir, "capabilities");
  for (const f of readdirSync(capDir).filter((f) => f.endsWith(".json"))) {
    problems.push(...checkCapability(f, JSON.parse(readFileSync(join(capDir, f), "utf8")) as Capability));
  }
  problems.push(...checkConfig(JSON.parse(readFileSync(join(dir, "tauri.conf.json"), "utf8")) as Record<string, unknown>));
  problems.push(...checkCargo(readFileSync(join(dir, "Cargo.toml"), "utf8")));
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const problems = checkDesktopConfig();
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("Desktop security settings OK");
}
