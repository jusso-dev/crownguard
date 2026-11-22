/**
 * Guards the desktop app's security settings so a later change can't quietly widen them. Run in CI (`pnpm
 * check:desktop`) and from scripts/desktop-config.test.ts. Exits non-zero with one line per problem.
 *
 * - No static frontend file-system paths. Native dialogs and validated OS-open paths grant runtime access.
 * - Exactly the supported command inventory in one local main-window capability.
 * - No http or shell plugin, and the opener may open https:// links only.
 * - The webview CSP is the web CSP with connect-src narrowed to the IPC bridge (vite.config.ts), with Trusted Types.
 * - freezePrototype on, withGlobalTauri off, asset protocol off, updater over https only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { desktopCspDirectives } from "../vite.config";
import { isMain } from "./lib/cli";
import { repoPath } from "./lib/repo";

const tauriDir = repoPath("src-tauri");

// Deliberately explicit product policy, not a general Tauri schema validator.
const REQUIRED_PERMISSIONS = new Set([
  "allow-autosave-load", "allow-autosave-set", "allow-autosave-remove", "allow-recent-list", "allow-recent-record",
  "allow-launch-file-take", "allow-settings-get", "allow-settings-set-update-check", "allow-update-check", "allow-update-install",
  "core:event:allow-listen", "core:event:allow-unlisten", "core:window:allow-destroy",
  "dialog:allow-open", "dialog:allow-save", "dialog:allow-message",
  "fs:allow-read-text-file", "fs:allow-write-text-file", "fs:allow-write-file",
]);
const CAPABILITY_FIELDS = new Set(["$schema", "identifier", "description", "windows", "local", "permissions"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function isHttpsOpener(permission: Record<string, unknown>): boolean {
  if (permission.identifier !== "opener:allow-open-url" || Object.keys(permission).length !== 2) return false;
  const allow = permission.allow;
  return Array.isArray(allow) && allow.length === 1 && isRecord(allow[0]) &&
    Object.keys(allow[0]).length === 1 && allow[0].url === "https://*";
}

export function checkCapability(name: string, cap: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(cap)) return [`${name}: expected a capability object`];
  for (const key of Object.keys(cap)) {
    if (!CAPABILITY_FIELDS.has(key)) problems.push(`${name}: capability field ${key} is not allowed`);
  }
  if (cap.identifier !== "default") problems.push(`${name}: identifier must be default`);
  if (JSON.stringify(cap.windows) !== '["main"]') problems.push(`${name}: windows must be exactly ["main"]`);
  if ("local" in cap && cap.local !== true) problems.push(`${name}: capability must be local-only`);
  if (!Array.isArray(cap.permissions)) return [...problems, `${name}: permissions must be an array`];
  const seen = new Set<string>();
  for (const permission of cap.permissions) {
    const id = typeof permission === "string" ? permission : isRecord(permission) ? permission.identifier : undefined;
    if (typeof id !== "string") {
      problems.push(`${name}: invalid permission`);
      continue;
    }
    if (seen.has(id)) problems.push(`${name}: duplicate permission ${id}`);
    seen.add(id);
    if (typeof permission === "string" && REQUIRED_PERMISSIONS.has(permission)) continue;
    if (isRecord(permission) && isHttpsOpener(permission)) continue;
    problems.push(`${name}: ${id} must match the supported command policy (no static fs paths; HTTPS default opener only)`);
  }
  for (const id of [...REQUIRED_PERMISSIONS, "opener:allow-open-url"]) {
    if (!seen.has(id)) problems.push(`${name}: missing required permission ${id}`);
  }
  return problems;
}

export function checkConfig(conf: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const app = conf.app as { withGlobalTauri?: boolean; security?: Record<string, unknown> };
  const security = app?.security ?? {};
  if (JSON.stringify(security.capabilities) !== '["default"]')
    problems.push('tauri.conf.json: app.security.capabilities must be exactly ["default"]');
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
  const files = readdirSync(capDir, { withFileTypes: true });
  if (files.length !== 1 || files[0].name !== "default.json" || !files[0].isFile())
    problems.push("capabilities: expected only default.json");
  if (files.some((file) => file.name === "default.json" && file.isFile()))
    problems.push(...checkCapability("default.json", JSON.parse(readFileSync(join(capDir, "default.json"), "utf8"))));
  problems.push(...checkConfig(JSON.parse(readFileSync(join(dir, "tauri.conf.json"), "utf8")) as Record<string, unknown>));
  problems.push(...checkCargo(readFileSync(join(dir, "Cargo.toml"), "utf8")));
  return problems;
}

if (isMain(import.meta.url)) {
  const problems = checkDesktopConfig();
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log("Desktop security settings OK");
}
