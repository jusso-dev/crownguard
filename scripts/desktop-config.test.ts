import { describe, expect, it } from "vitest";
import { checkCapability, checkCargo, checkConfig, checkDesktopConfig } from "./check-desktop-config";

describe("desktop security settings", () => {
  it("the committed capabilities, tauri.conf.json and Cargo.toml pass", () => {
    expect(checkDesktopConfig()).toEqual([]);
  });

  it("fails on a file-system wildcard over $HOME", () => {
    const cap = { identifier: "x", permissions: [{ identifier: "fs:scope", allow: [{ path: "$HOME/**" }] }] };
    expect(checkCapability("x.json", cap)).toHaveLength(1);
    const allow = { identifier: "x", permissions: [{ identifier: "fs:allow-read-text-file", allow: [{ path: "$HOME/**" }] }] };
    expect(checkCapability("x.json", allow)).toHaveLength(1);
  });

  it("fails on prebuilt permissions over user folders, absolute paths and bare wildcards", () => {
    for (const id of ["fs:allow-home-read-recursive", "fs:scope-home-recursive", "fs:allow-download-write", "fs:scope-document"])
      expect(checkCapability("x.json", { identifier: "x", permissions: [id] }), id).not.toEqual([]);
    for (const path of ["/", "/Users/**", "C:\\\\**", "**", "~/**", "$DOCUMENT/**"])
      expect(checkCapability("x.json", { identifier: "x", permissions: [{ identifier: "fs:scope", allow: [{ path }] }] }), path).not.toEqual([]);
  });

  it("allows the app data directory", () => {
    expect(checkCapability("x.json", { identifier: "x", permissions: [{ identifier: "fs:scope", allow: [{ path: "$APPDATA/**" }] }] })).toEqual([]);
  });

  it("fails on http, shell or a wide opener", () => {
    for (const id of ["http:default", "shell:allow-execute", "opener:default", "opener:allow-open-path", "fs:default"])
      expect(checkCapability("x.json", { identifier: "x", permissions: [id] }), id).not.toEqual([]);
    expect(checkCapability("x.json", { identifier: "x", permissions: [{ identifier: "opener:allow-open-url", allow: [{ url: "http://*" }] }] })).toHaveLength(1);
    expect(checkCargo('tauri-plugin-http = "2"\n')).toHaveLength(1);
  });

  it("fails when the CSP drifts, the prototype isn't frozen or the global Tauri object is on", () => {
    const problems = checkConfig({
      app: { withGlobalTauri: true, security: { csp: "default-src *", freezePrototype: false } },
      build: { frontendDist: "../dist-desktop", devUrl: "https://example.com" },
      plugins: { updater: { endpoints: ["http://example.com/latest.json"] } },
    });
    expect(problems).toHaveLength(5);
  });
});
