import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkCapability, checkCargo, checkConfig, checkDesktopConfig } from "./check-desktop-config";
import { repoPath } from "./lib/repo";

// Product policy owned by these tests, not imported from the guard or derived from the committed JSON.
const required = [
  "allow-autosave-load", "allow-autosave-set", "allow-autosave-remove", "allow-recent-list", "allow-recent-record",
  "allow-launch-file-take", "allow-settings-get", "allow-settings-set-update-check", "allow-update-check", "allow-update-install",
  "core:event:allow-listen", "core:event:allow-unlisten", "core:window:allow-destroy",
  "dialog:allow-open", "dialog:allow-save", "dialog:allow-message",
  "fs:allow-read-text-file", "fs:allow-write-text-file", "fs:allow-write-file",
];
type Permission = string | { identifier: string; [key: string]: unknown };
const opener = () => ({ identifier: "opener:allow-open-url", allow: [{ url: "https://*" }] });
const capability = () => ({ identifier: "default", windows: ["main"], permissions: [...required, opener()] as Permission[] });
const config = () => JSON.parse(readFileSync(repoPath("src-tauri/tauri.conf.json"), "utf8"));
const rejected = (permission: Permission) => {
  const cap = capability();
  cap.permissions.push(permission);
  expect(checkCapability("default.json", cap)).not.toEqual([]);
};
const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "crownguard-capabilities-"));
  fixtures.push(dir);
  mkdirSync(join(dir, "capabilities"));
  for (const name of ["tauri.conf.json", "Cargo.toml"]) copyFileSync(repoPath(`src-tauri/${name}`), join(dir, name));
  writeFileSync(join(dir, "capabilities/default.json"), JSON.stringify(capability()));
  return dir;
}

describe("desktop security settings", () => {
  it("the committed configuration has exactly the independently specified policy", () => {
    const cap = JSON.parse(readFileSync(repoPath("src-tauri/capabilities/default.json"), "utf8"));
    expect(cap.identifier).toBe("default");
    expect(cap.windows).toEqual(["main"]);
    expect(cap.permissions.filter((p: unknown) => typeof p === "string").sort()).toEqual([...required].sort());
    expect(cap.permissions.filter((p: unknown) => typeof p !== "string")).toEqual([opener()]);
    expect(checkDesktopConfig()).toEqual([]);
  });

  it("accepts independent policy, arbitrary permission ordering and explicit local-only scope", () => {
    const cap = capability();
    cap.permissions.reverse();
    expect(checkCapability("default.json", cap)).toEqual([]);
    expect(checkCapability("default.json", { ...cap, local: true })).toEqual([]);
    expect(checkDesktopConfig(fixture())).toEqual([]);
  });

  it.each([["$APPDATA"], ["$APPDATA/**"], ["$APPDATA", "$APPDATA/**"]])("rejects original app-data scope %j", (...paths) => {
    rejected({ identifier: "fs:scope", allow: paths.map((path) => ({ path })) });
  });

  it.each(["$APPLOCALDATA/**", "$APPCONFIG/**", "$APPCACHE/**", "$APPLOG/**", "$HOME/**", "$DOCUMENT/**", "/", "/Users/**", "C:\\**", "**", "~/**"])("rejects static scope %s", (path) => {
    rejected({ identifier: "fs:scope", allow: [{ path }] });
    rejected({ identifier: "fs:scope", deny: [{ path }] });
  });

  for (const id of required.filter((id) => id.startsWith("fs:"))) {
    it.each(["allow", "deny"])(`rejects ${id} object with %s paths`, (key) => {
      const cap = capability();
      cap.permissions = cap.permissions.map((p) => p === id ? { identifier: id, [key]: [{ path: "$APPDATA/**" }] } : p);
      expect(checkCapability("default.json", cap)).not.toEqual([]);
    });
  }

  it.each([
    "core:app:allow-version", "allow-recent-forget", "dialog:allow-ask", "unknown:default", "dialog:default",
    "fs:default", "fs:allow-appdata-read-recursive", "fs:scope-appdata", "fs:allow-home-read-recursive",
    "fs:scope-home-recursive", "fs:allow-download-write", "fs:scope-document", "http:default", "shell:allow-execute",
    "opener:default", "opener:allow-open-path", "opener:allow-reveal-item-in-dir", "opener:allow-open-url",
  ])("rejects unapproved grant %s", (id) => rejected(id));

  it.each(required)("rejects missing retained command %s", (id) => {
    const cap = capability();
    cap.permissions = cap.permissions.filter((p) => p !== id);
    expect(checkCapability("default.json", cap)).not.toEqual([]);
  });

  it.each([...required, opener()])("rejects duplicate permission %j", (permission) => rejected(permission));

  it.each([
    { allow: [{ url: "https://learn.microsoft.com/*" }] },
    { allow: [{ url: "http://*" }] }, { allow: [{ url: "mailto:*" }] },
    { allow: [{ url: "https://*" }, { url: "http://*" }] },
    { allow: [{ url: "https://*", app: true }] }, { allow: [{ url: "https://*", app: "browser" }] },
    { allow: [{ url: "https://*", path: "/tmp/*" }] }, { allow: [] },
    { deny: [] }, { app: true }, { unknown: true },
  ])("rejects changed opener scope %j", (change) => {
    const cap = capability();
    cap.permissions[required.length] = { ...opener(), ...change };
    expect(checkCapability("default.json", cap)).not.toEqual([]);
  });

  it("rejects missing opener, an unscoped replacement and global opener scope", () => {
    const cap = capability();
    cap.permissions.pop();
    expect(checkCapability("default.json", cap)).not.toEqual([]);
    cap.permissions.push("opener:allow-open-url");
    expect(checkCapability("default.json", cap)).not.toEqual([]);
    rejected({ identifier: "opener:scope", allow: [{ url: "https://*" }] });
  });

  it.each([
    { identifier: "other" }, { windows: ["*"] }, { windows: ["main", "other"] }, { windows: [] },
    { local: false }, { remote: { urls: ["https://*"] } }, { webviews: ["*"] },
    { platforms: ["linux"] }, { unknown: true }, { permissions: null },
  ])("rejects capability targeting or shape drift %j", (change) => {
    expect(checkCapability("default.json", { ...capability(), ...change })).not.toEqual([]);
  });

  it.each([undefined, [], ["other"], ["default", "other"], ["default", "default"], [capability()]].map((selection) => [selection]))("rejects capability selection %j", (selection) => {
    const conf = config();
    conf.app.security.capabilities = selection;
    expect(checkConfig(conf)).not.toEqual([]);
  });

  it.each(["extra.json", "extra.json5", "extra.toml"])("rejects additional capability file %s", (name) => {
    const dir = fixture();
    const contents = name.endsWith(".toml")
      ? 'identifier = "extra"\nwindows = ["main"]\npermissions = ["core:app:allow-version"]\n'
      : JSON.stringify({ ...capability(), identifier: "extra" });
    writeFileSync(join(dir, "capabilities", name), contents);
    expect(checkDesktopConfig(dir)).toContain("capabilities: expected only default.json");
  });

  it("rejects missing default capability", () => {
    const dir = fixture();
    rmSync(join(dir, "capabilities/default.json"));
    expect(checkDesktopConfig(dir)).toContain("capabilities: expected only default.json");
  });

  it.each([
    { csp: "default-src *" }, { freezePrototype: false }, { dangerousDisableAssetCspModification: true },
    { assetProtocol: { enable: true } },
  ])("retains security guard for %j", (change) => {
    const conf = config();
    Object.assign(conf.app.security, change);
    expect(checkConfig(conf)).not.toEqual([]);
  });

  it("retains global Tauri, build and updater guards", () => {
    const conf = config();
    conf.app.withGlobalTauri = true;
    conf.build.devUrl = "https://example.com";
    conf.build.frontendDist = "https://example.com/app";
    conf.plugins.updater.endpoints = ["http://example.com/latest.json"];
    expect(checkConfig(conf)).toHaveLength(4);
  });

  it.each(["http", "shell", "sql"])("retains forbidden Cargo plugin guard for %s", (plugin) => {
    expect(checkCargo(`tauri-plugin-${plugin} = "2"\n`)).toHaveLength(1);
  });
});
