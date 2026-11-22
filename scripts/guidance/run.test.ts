// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ismGenerator } from "../ism/build";
import { createReleaseGitHub, type ReleaseGitHub } from "../lib/github";
import { headerTag, sourceReleaseTag } from "../lib/pins";
import { readRepoFile as repo, repoPath } from "../lib/repo";
import { ESSENTIALS_IT, ISM } from "../lib/upstreams";
import { UPDATERS } from "./registry";
import { currentVersion, renderPrBody, runUpdates } from "./run";
import type { GuidanceUpdater, Workspace } from "./types";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const updater = (id: string) => UPDATERS.find((u) => u.id === id)!;

const workspace = (files: Record<string, string>, citing: Record<string, string[]> = {}): Workspace => ({
  read: (p) => {
    if (!(p in files)) throw new Error(`unexpected read of ${p}`);
    return files[p];
  },
  citing: () => new Map(Object.entries(citing)),
  today: "2026-11-04",
});

const offline = (latest: Record<string, string>, raw: Record<string, string> = {}): ReleaseGitHub => ({
  latestRelease: async (r) => {
    if (!latest[r]) throw new Error(`${r}: 503 Service Unavailable`);
    return { tag: latest[r], date: "2026-10-29", url: `https://github.com/${r}/releases/tag/${latest[r]}` };
  },
  dir: async () => [],
  tree: async () => [],
  raw: async (r, ref, path) => {
    const t = raw[`${r}@${ref}:${path}`];
    if (t === undefined) throw new Error(`no ${path} at ${ref}`);
    return t;
  },
});

/** A minimal updater: one pin in one file. */
const fake = (id: string, path: string, write: (from: string, to: string) => Record<string, string>): GuidanceUpdater => ({
  id,
  label: id,
  name: id,
  repo: `example/${id}`,
  paths: [path, "shared.txt"],
  pins: (ws) => ({ [path]: ws.read(path).match(/pin (\S+)/)![1] }),
  update: async (_ws, _gh, release, from) => ({ files: write(from, release.tag), pinsMoved: true, review: [], notes: [] }),
});

describe("a guidance run", () => {
  it("does nothing when every source is on its latest release", async () => {
    const u = fake("a", "a.txt", () => ({ "a.txt": "changed" }));
    const r = await runUpdates({ updaters: [u], ws: workspace({ "a.txt": "pin 1.2.0\n" }), gh: offline({ "example/a": "1.2.0" }) });
    expect(r.changed).toBe(false);
    expect(r.updates[0]).toMatchObject({ status: "current", from: "1.2.0" });
    expect(r.title).toBe("Guidance update: nothing to change");
  });

  it("regenerates a source with a newer release and names it in the title", async () => {
    const u = fake("a", "a.txt", (from, to) => ({ "a.txt": `pin ${to} (was ${from})\n` }));
    const r = await runUpdates({ updaters: [u], ws: workspace({ "a.txt": "pin 1.2.0\n" }), gh: offline({ "example/a": "1.10.0" }) });
    expect(r.files).toEqual({ "a.txt": "pin 1.10.0 (was 1.2.0)\n" });
    expect(r.title).toBe("Update guidance: a 1.10.0");
  });

  it("lets two updaters edit one file, each on top of the other", async () => {
    const edit = (n: string) => (_f: string, to: string) => ({ "shared.txt": `${(ws.read("shared.txt") as string)}${n}=${to}\n` });
    let ws = workspace({});
    const files = { "a.txt": "pin 1.0.0", "b.txt": "pin 2.0.0", "shared.txt": "" };
    const a = fake("a", "a.txt", edit("a"));
    const b = fake("b", "b.txt", edit("b"));
    // The run hands each updater a workspace that sees earlier edits; capture it to build on.
    const wrap = (u: GuidanceUpdater): GuidanceUpdater => ({ ...u, update: (w, ...rest) => ((ws = w), u.update(w, ...rest)) });
    const r = await runUpdates({ updaters: [wrap(a), wrap(b)], ws: workspace(files), gh: offline({ "example/a": "1.1.0", "example/b": "2.1.0" }) });
    expect(r.files["shared.txt"]).toBe("a=1.1.0\nb=2.1.0\n");
  });

  it("starts from the oldest pin, so a half-landed bump is finished", () => {
    expect(currentVersion({ list: "5.47.0", mapping: "5.44.0" })).toBe("5.44.0");
  });

  it("reports an upstream it can't read without touching anything, and carries on", async () => {
    const a = fake("a", "a.txt", () => ({ "a.txt": "x" }));
    const b = fake("b", "b.txt", (_f, to) => ({ "b.txt": `pin ${to}` }));
    const r = await runUpdates({ updaters: [a, b], ws: workspace({ "a.txt": "pin 1.0.0", "b.txt": "pin 1.0.0" }), gh: offline({ "example/b": "1.1.0" }) });
    expect(r.updates[0]).toMatchObject({ status: "error", error: expect.stringMatching(/503/) });
    expect(Object.keys(r.files)).toEqual(["b.txt"]);
  });

  it("refuses a write outside the updater's own paths", async () => {
    const u = fake("a", "a.txt", () => ({ ".github/workflows/ci.yml": "oops" }));
    const r = await runUpdates({ updaters: [u], ws: workspace({ "a.txt": "pin 1.0.0" }), gh: offline({ "example/a": "1.1.0" }) });
    expect(r.updates[0].error).toMatch(/not in its paths/);
    expect(r.files).toEqual({});
  });

  it("filters with --only", async () => {
    const r = await runUpdates({ updaters: [fake("a", "a.txt", () => ({})), fake("b", "b.txt", () => ({}))], ws: workspace({ "b.txt": "pin 1.0.0" }), gh: offline({ "example/b": "1.0.0" }), only: new Set(["b"]) });
    expect(r.updates.map((u) => u.id)).toEqual(["b"]);
  });
});

describe("the pull request body", () => {
  it("lists old and new tags with release links, and puts anything blocking first", async () => {
    const blocked: GuidanceUpdater = {
      ...fake("Prowler", "a.txt", () => ({})),
      update: async () => ({
        files: { "a.txt": "pin 5.47.0" },
        pinsMoved: false,
        review: [{ id: "old_check", file: "content/imports/prowler-aws.yaml", questions: ["AWS-BCK-001"], reason: "removed upstream" }],
        notes: ["a note"],
      }),
    };
    const r = await runUpdates({ updaters: [blocked], ws: workspace({ "a.txt": "pin 5.44.0" }), gh: offline({ "example/Prowler": "5.47.0" }) });
    expect(r.title).toBe("Update guidance: Prowler 5.47.0 (review needed)");
    const body = renderPrBody(r, { guideUrl: "https://example.com/guide" });
    expect(body.indexOf("## Needs review")).toBeLessThan(body.indexOf("## Updates"));
    expect(body).toContain("- **Prowler** `old_check` removed upstream; used by AWS-BCK-001 in `content/imports/prowler-aws.yaml`.");
    expect(body).toContain("| 5.44.0 | [5.47.0](https://github.com/example/Prowler/releases/tag/5.47.0) (2026-10-29) | `a.txt` |");
    expect(body).toMatch(/pins .* did not/);
    expect(body).not.toMatch(/—/);
  });
});

describe("the ISM updater", () => {
  const ism = updater("ism");
  const sampleText = fixture("../../ism/fixtures/oscal-sample.json");
  // The committed state at v2026.09.4, built from the sample plus one control the next release drops.
  const withExtra = JSON.parse(sampleText);
  withExtra.catalog.groups[0].groups[0].groups[0].controls.push({ id: "ism-0001", class: "ISM-control", parts: [{ name: "statement", prose: "An old control." }] });
  const old = ismGenerator.build({ "ISM_catalog.json": JSON.stringify(withExtra) }, { tag: "v2026.09.4", retrieved: "2026-10-10" });
  const files = { [ISM.frameworkFile]: old.yaml, [ISM.idsFile]: old.ids, [ISM.source!.file]: repo(ISM.source!.file) };
  const release = (catalog: string) => offline({ [ISM.repo]: "v2026.12.1" }, { [`${ISM.repo}@v2026.12.1:ISM_catalog.json`]: catalog });

  it("moves the generated files and the cited release together", async () => {
    const r = await runUpdates({ updaters: [ism], ws: workspace(files, { "ISM-0001": ["GO-ID-002"], "ISM-1504": ["MS-ID-001"] }), gh: release(sampleText) });
    expect(r.updates[0]).toMatchObject({ status: "updated", from: "v2026.09.4" });
    expect(headerTag(r.files[ISM.frameworkFile])).toBe("v2026.12.1");
    expect(headerTag(r.files[ISM.idsFile])).toBe("v2026.12.1");
    expect(parse(r.files[ISM.frameworkFile]).name).toContain("December 2026");
    expect(sourceReleaseTag(r.files[ISM.source!.file], ISM.source!.id)).toBe("v2026.12.1");
    // Only the question citing a control the release drops is listed; ISM controls the release keeps are fine.
    expect(r.updates[0].review).toEqual([{ id: "ISM-0001", file: ISM.frameworkFile, questions: ["GO-ID-002"], reason: "gone from the catalog" }]);
  });

  it("stops on a catalog whose shape changed", async () => {
    const odd = JSON.parse(sampleText);
    odd.catalog.groups[0].brandNewKey = true;
    const r = await runUpdates({ updaters: [ism], ws: workspace(files), gh: release(JSON.stringify(odd)) });
    expect(r.updates[0]).toMatchObject({ status: "error", error: expect.stringMatching(/expected OSCAL shape/) });
    expect(r.files).toEqual({});
  });
});

describe("the Essentials updater", () => {
  const essentials = updater("essentials");
  const sampleDir = repoPath("scripts", "essentials", "fixtures", "sample");
  const names = readdirSync(sampleDir).filter((n) => n.endsWith(".json"));
  const raw = Object.fromEntries(names.map((n) => [`${ESSENTIALS_IT.repo}@v2099.01.20:${n}`, readFileSync(join(sampleDir, n), "utf8")]));
  const files = { [ESSENTIALS_IT.frameworkFile]: repo(ESSENTIALS_IT.frameworkFile), [ESSENTIALS_IT.idsFile]: repo(ESSENTIALS_IT.idsFile) };

  it("reads every release file it needs and moves the chapter and its pinned list together", async () => {
    // The gh stub throws on any file the generator asks for that the sample doesn't have.
    const gh = offline({ [ESSENTIALS_IT.repo]: "v2099.01.20" }, raw);
    const r = await runUpdates({ updaters: [essentials], ws: workspace(files, { "IT.PRO-13.4": ["MS-ID-001"], "IT.PRO-13.5": ["MS-ID-002"] }), gh });
    expect(r.updates[0]).toMatchObject({ status: "updated", from: headerTag(files[ESSENTIALS_IT.frameworkFile]) });
    expect(headerTag(r.files[ESSENTIALS_IT.frameworkFile])).toBe("v2099.01.20");
    expect(headerTag(r.files[ESSENTIALS_IT.idsFile])).toBe("v2099.01.20");
    // The sample keeps IT.PRO-13.4 and drops IT.PRO-13.5, so only the question tagged with the dropped action is listed.
    expect(r.updates[0].review).toEqual([{ id: "IT.PRO-13.5", file: ESSENTIALS_IT.frameworkFile, questions: ["MS-ID-002"], reason: "gone from the catalog" }]);
  });
});

describe("the GitHub client", () => {
  const recorded = fixture("prowler-release-latest.json");
  const respond = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "application/json" } });

  it("reads the latest release and builds the link itself", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const gh = createReleaseGitHub({
      token: "t0ken",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), auth: (init?.headers as Record<string, string>).authorization });
        return respond(recorded.replace("https://github.com/prowler-cloud/prowler/releases/tag/5.47.0", "https://evil.example/"));
      },
    });
    expect(await gh.latestRelease("prowler-cloud/prowler")).toEqual({ tag: "5.47.0", date: "2026-10-29", url: "https://github.com/prowler-cloud/prowler/releases/tag/5.47.0" });
    expect(seen).toEqual([{ url: "https://api.github.com/repos/prowler-cloud/prowler/releases/latest", auth: "Bearer t0ken" }]);
  });

  it("throws on anything it can't trust, instead of returning a partial answer", async () => {
    const gh = (body: string, status = 200) => createReleaseGitHub({ fetchImpl: async () => respond(body, status) });
    await expect(gh(JSON.stringify({ tag_name: "nightly", published_at: "2026-10-29T00:00:00Z" })).latestRelease("a/b")).rejects.toThrow(/not a version tag/);
    await expect(gh("{}", 404).latestRelease("a/b")).rejects.toThrow(/404/);
    await expect(gh(JSON.stringify({ truncated: true, tree: [] })).tree("a/b", "0".repeat(40))).rejects.toThrow(/truncated/);
    await expect(gh("[]").raw("a/b", "v1.0.0", "../../etc/passwd")).rejects.toThrow(/not a repo path/);
    await expect(gh("[]").latestRelease("not a repo")).rejects.toThrow(/not a GitHub repo/);
  });
});

describe("the registry and the workflow", () => {
  const workflow = repo(".github/workflows/guidance-update.yml");
  const addPaths = workflow.match(/add-paths: \|\n((?:\s{12}\S.*\n)+)/)![1].split("\n").map((l) => l.trim()).filter(Boolean);
  /** Glob match for add-paths entries: `*` is any run of characters within one path segment. */
  const globMatch = (glob: string, p: string) => {
    const [head, ...rest] = glob.split("*");
    if (!p.startsWith(head)) return false;
    let at = head.length;
    for (const [i, part] of rest.entries()) {
      const last = i === rest.length - 1;
      const found = last ? (p.endsWith(part) && p.length - part.length >= at ? p.length - part.length : -1) : p.indexOf(part, at);
      if (found < 0 || p.slice(at, found).includes("/")) return false;
      at = found + part.length;
    }
    return at === p.length;
  };
  const covered = (p: string) => addPaths.some((a) => (a.includes("*") ? globMatch(a, p) : a === p));

  it("commits every file an updater writes, and nothing else", () => {
    const paths = [...new Set(UPDATERS.flatMap((u) => u.paths))];
    for (const p of paths) expect(covered(p), `${p} missing from add-paths`).toBe(true);
    for (const a of addPaths) expect(paths.some((p) => (a.includes("*") ? globMatch(a, p) : a === p)), `${a} is in add-paths but no updater writes it`).toBe(true);
  });

  it("reads every pin it is going to move from the repo, and they agree", () => {
    const ws: Workspace = { read: repo, citing: () => new Map(), today: "2026-11-04" };
    for (const u of UPDATERS) {
      const pins = u.pins(ws);
      expect(Object.keys(pins).length, u.id).toBeGreaterThanOrEqual(2);
      expect(new Set(Object.values(pins)).size, `${u.id} pins disagree: ${JSON.stringify(pins)}`).toBe(1);
    }
    expect(new Set(UPDATERS.map((u) => u.id)).size).toBe(UPDATERS.length);
  });
});
