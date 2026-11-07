// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Release, ReleaseGitHub } from "../lib/github";
import { checkedAgainst } from "../lib/pins";
import { readRepoFile as repo } from "../lib/repo";
import { parseIdList } from "../lib/text";
import { PROWLER, SCUBAGOGGLES } from "../lib/upstreams";
import { idListText, prowlerCheckIds, prowlerList, scannerUpdater, scubaList, scubaPolicyIds } from "./scanners";
import type { Workspace } from "./types";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");

/** The recorded `git/trees/<services sha>?recursive=1` sample: backup and cloudwatch from Prowler 5.47.0. */
const tree = JSON.parse(fixture("prowler-aws-services-tree.json")) as { sha: string; tree: { path: string; type: string }[] };

describe("check id lists from upstream", () => {
  it("takes Prowler check ids from the directories one level under each service", () => {
    const ids = prowlerCheckIds(tree.tree);
    expect(ids).toContain("backup_plans_exist");
    expect(ids).toContain("cloudwatch_log_group_no_secrets_in_logs");
    // Files, the service directories themselves and anything deeper are not checks.
    expect(ids).not.toContain("backup");
    expect(ids).not.toContain("backup_client.py");
    expect(ids.some((i) => i.includes("/") || i.endsWith(".py") || i.endsWith(".json"))).toBe(false);
    // `cloudwatch/lib` is a directory of shared helpers, not a check.
    expect(ids).not.toContain("lib");
    expect(ids).toHaveLength(28);
  });

  it("takes ScubaGoggles policy ids from the policy headings only", () => {
    expect(scubaPolicyIds(fixture("scuba-meet-excerpt.md"))).toEqual(["GWS.MEET.6.1v1", "GWS.MEET.6.2v1", "GWS.MEET.6.3v1"]);
  });

  it("writes the lists byte for byte as committed", () => {
    // The release each committed header names, so this holds after every bump.
    const releaseOf = (text: string): Release => {
      const m = text.match(/tag (v?[\d.]+) \((\d{4}-\d{2}-\d{2})\)/)!;
      return { tag: m[1], date: m[2], url: "" };
    };
    for (const list of [...PROWLER.lists.map((l) => prowlerList(PROWLER.repo, l)), ...SCUBAGOGGLES.lists.map((l) => scubaList(SCUBAGOGGLES.repo, l))]) {
      const file = list.file;
      const committed = repo(file);
      const ids = parseIdList(committed);
      // Shuffled and duplicated input still gives the same file.
      expect(idListText(list.header(releaseOf(committed)), [...ids].reverse().concat(ids[0])), file).toBe(committed);
    }
  });
});

describe("the pin bump", () => {
  const mapping = [
    "# Check ids were checked against Prowler 5.44.0 (2026-09-29); `checkedAgainst` records that.",
    "id: prowler-aws",
    "checkedAgainst: 5.44.0",
    "mappings:",
    "  - question: AWS-BCK-001",
    "    checks: [backup_plans_exist, backup_vaults_exist]",
    "  - question: AWS-LOG-002",
    "    checks: [cloudwatch_log_group_retired_check, backup_vaults_exist]",
    "",
  ].join("\n");
  const list = "# Check ids in Prowler aws at tag 5.44.0 (2026-09-29), taken from the check directory names in\n# x\n# y\nbackup_plans_exist\nbackup_vaults_exist\ncloudwatch_log_group_retired_check\n";

  const ws = (files: Record<string, string>): Workspace => ({
    read: (p) => {
      if (!(p in files)) throw new Error(`unexpected read of ${p}`);
      return files[p];
    },
    citing: () => new Map(),
    today: "2026-11-04",
  });
  const gh = (entries: { path: string; type: string }[]): ReleaseGitHub => ({
    latestRelease: async () => ({ tag: "5.47.0", date: "2026-10-29", url: "https://github.com/prowler-cloud/prowler/releases/tag/5.47.0" }),
    dir: async () => [{ name: "services", path: "prowler/providers/aws/services", type: "dir", sha: tree.sha }],
    tree: async () => entries,
    raw: async () => {
      throw new Error("not used");
    },
  });
  const aws = { ...PROWLER, lists: PROWLER.lists.filter((l) => l.provider === "aws") };
  const updater = scannerUpdater({ id: "prowler", label: "Prowler", name: "Prowler", upstream: aws, lists: aws.lists.map((l) => prowlerList(aws.repo, l)) });
  const files = { "e2e/fixtures/prowler-checks-aws.txt": list, "content/imports/prowler-aws.yaml": mapping };
  const release: Release = { tag: "5.47.0", date: "2026-10-29", url: "" };

  it("reads its pins from each list and mapping", () => {
    expect(updater.pins(ws(files))).toEqual({ "e2e/fixtures/prowler-checks-aws.txt": "5.44.0", "content/imports/prowler-aws.yaml": "5.44.0" });
  });

  it("is blocked by a mapped check removed upstream, but still moves the list", async () => {
    const r = await updater.update(ws(files), gh(tree.tree), release, "5.44.0");
    expect(r.pinsMoved).toBe(false);
    expect(r.review).toEqual([{ id: "cloudwatch_log_group_retired_check", file: "content/imports/prowler-aws.yaml", questions: ["AWS-LOG-002"], reason: "removed upstream" }]);
    expect(Object.keys(r.files)).toEqual(["e2e/fixtures/prowler-checks-aws.txt"]);
    expect(r.files["e2e/fixtures/prowler-checks-aws.txt"]).toMatch(/^# Check ids in Prowler aws at tag 5\.47\.0 \(2026-10-29\)/);
    expect(r.files["e2e/fixtures/prowler-checks-aws.txt"]).not.toContain("cloudwatch_log_group_retired_check");
    expect(r.notes.join(" ")).toMatch(/checkedAgainst` stays put/);
  });

  it("moves checkedAgainst when every mapped check is still there", async () => {
    const r = await updater.update(ws(files), gh([...tree.tree, { path: "cloudwatch/cloudwatch_log_group_retired_check", type: "tree" }]), release, "5.44.0");
    expect(r.pinsMoved).toBe(true);
    expect(r.review).toEqual([]);
    expect(checkedAgainst(r.files["content/imports/prowler-aws.yaml"])).toBe("5.47.0");
    expect(r.files["content/imports/prowler-aws.yaml"]).toContain("checked against Prowler 5.47.0 (2026-10-29)");
    // New checks in a family the mapping uses are pointed out, not blocking.
    expect(r.notes.join(" ")).toContain("`backup_recovery_point_encrypted`");
    expect(r.notes.join(" ")).not.toContain("`lib`");
  });

  it("refuses an empty upstream list rather than wiping the pins", async () => {
    await expect(updater.update(ws(files), gh([]), release, "5.44.0")).rejects.toThrow(/no ids found/);
  });
});
