import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The supply-chain rules the workflows have to keep to. They run with the rest of the tests, so a workflow that
 * unpins an action or widens a permission fails locally and in CI, not at the next incident.
 */
const dir = join(process.cwd(), ".github", "workflows");
const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
const text = (f: string) => readFileSync(join(dir, f), "utf8");

describe("GitHub workflows", () => {
  it("finds the workflows it is meant to be policing", () => {
    expect(files.sort()).toEqual(["ci.yml", "dependency-review.yml", "scorecard.yml", "source-watch.yml"]);
  });

  it("pins every action to a full commit SHA, with the version in a comment", () => {
    for (const f of files) {
      for (const line of text(f).split("\n")) {
        const m = /^\s*(?:-\s*)?uses:\s*(\S+)\s*(#.*)?$/.exec(line);
        if (!m) continue;
        const [, ref, comment] = m;
        const at = ref.lastIndexOf("@");
        const owner = ref.slice(0, at);
        const spec = ref.slice(at + 1);
        expect(owner, `${f}: ${line.trim()}`).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w.-]+)?$/);
        expect(spec, `${f}: ${line.trim()} must pin a 40-character commit SHA`).toMatch(/^[0-9a-f]{40}$/);
        expect(comment, `${f}: ${line.trim()} needs a '# vX.Y.Z' comment`).toMatch(/^#\s*v\d+\.\d+\.\d+$/);
      }
    }
    // And something is actually being checked.
    expect(files.flatMap((f) => text(f).split("\n").filter((l) => l.includes("uses:"))).length).toBeGreaterThan(8);
  });

  it("starts every workflow with no token at all", () => {
    for (const f of files) {
      const body = text(f);
      // A workflow-level `permissions: {}` is required; grants belong on the jobs that need them.
      expect(body, f).toMatch(/^permissions: \{\}$/m);
      const workflowLevel = body.split(/^jobs:/m)[0];
      expect(workflowLevel, `${f}: don't grant permissions at workflow level`).not.toMatch(/^permissions:\s*$/m);
    }
  });

  it("keeps the Pages write permission in the deploy job alone", () => {
    for (const f of files) {
      for (const job of text(f).split(/\n(?=[ ]{2}\w[\w-]*:\n)/)) {
        const name = /^\s{2}(\w[\w-]*):/m.exec(job)?.[1];
        if (!name) continue;
        for (const secret of ["pages: write", "attestations: write"]) {
          if (job.includes(secret)) expect(name, `${f}: ${secret} in ${name}`).toBe("deploy");
        }
        // The jobs that build and test get no OIDC token. Only the two that publish something may mint one.
        if (["check", "e2e"].includes(name)) expect(job, `${f}: ${name} must not have id-token: write`).not.toContain("id-token: write");
      }
    }
  });

  it("only deploys when the tests have passed", () => {
    const ci = text("ci.yml");
    expect(ci).toMatch(/^[ ]{2}deploy:$/m);
    expect(ci).toMatch(/\n\s+needs: \[check, e2e\]\n/);
    // Deploying is for main only, and the branch can't be force-pushed or deleted (see the main ruleset).
    expect(ci).toMatch(/if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  });

  it("does not leave git credentials in the workspace after checkout", () => {
    for (const f of files) {
      const body = text(f);
      const checkouts = body.split("actions/checkout@").slice(1);
      for (const c of checkouts) {
        // The next few lines after the `uses:` are the `with:` block.
        const block = c.slice(0, 200);
        expect(block, `${f}: actions/checkout needs persist-credentials: false`).toContain("persist-credentials: false");
      }
    }
  });
});
