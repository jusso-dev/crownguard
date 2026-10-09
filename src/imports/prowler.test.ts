import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { collapse, countText } from "./aggregate";
import { importers } from "./index";
import { detectDelimiter, parseCsv, prowlerImporter, prowlerProvider, readProwler, readProwlerCsv, readProwlerOcsf } from "./prowler";
import type { Finding } from "./types";

const fixture = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
const awsMapping = catalogue.imports.get("prowler-aws")!;
const azureMapping = catalogue.imports.get("prowler-azure")!;
const importer = prowlerImporter("aws");

const finding = (over: Partial<Finding> = {}): Finding => ({
  check: "s3_bucket_public_access",
  status: "pass",
  muted: false,
  account: "123456789012",
  at: "2026-10-08T22:00:00.000Z",
  ...over,
});

describe("Prowler CSV", () => {
  it("reads the columns Prowler documents, wherever they appear in the row", () => {
    const rows = readProwlerCsv(fixture("prowler-aws.csv"));
    expect(rows).toHaveLength(16);
    expect(rows[0]).toMatchObject({
      check: "backup_plans_exist",
      title: "Ensure AWS Backup plans exist",
      status: "pass",
      muted: false,
      account: "123456789012",
      accountName: "Example Co",
      region: "ap-southeast-2",
      resource: "arn:aws:backup:ap-southeast-2:123456789012:backup-plan/daily",
      at: "2026-10-08T22:00:00.000Z",
      toolVersion: "5.44.0",
    });
  });

  it("reads a Prowler v3 file by its older column names", () => {
    const v3 = ["ACCOUNT_ID,ASSESSMENT_START_TIME,CHECK_ID,STATUS,MUTED,RESOURCE_ARN,FINDING_UNIQUE_ID,PROWLER_VERSION", "123456789012,2026-10-08T22:00:00Z,s3_bucket_public_access,PASS,FALSE,arn:aws:s3:::b,uid-1,3.11.0"].join("\n");
    expect(readProwlerCsv(v3)[0]).toMatchObject({ check: "s3_bucket_public_access", account: "123456789012", resource: "arn:aws:s3:::b", toolVersion: "3.11.0" });
  });

  it("spots the delimiter instead of assuming a comma", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(parseCsv('a,b\n"x,1","say ""hi"""\n')).toEqual([
      ["a", "b"],
      ["x,1", 'say "hi"'],
    ]);
  });

  it("says so when the file isn't Prowler CSV", () => {
    expect(() => readProwlerCsv("name,value\nx,1")).toThrow(/CHECK_ID and STATUS/);
  });
});

describe("Prowler JSON-OCSF", () => {
  it("reads the fields Prowler fills in", () => {
    const rows = readProwlerOcsf(fixture("prowler-aws.json"));
    expect(rows).toHaveLength(16);
    expect(rows[2]).toMatchObject({ check: "s3_bucket_public_access", status: "pass", account: "123456789012", toolVersion: "5.44.0" });
  });

  it("says so when the file isn't Prowler OCSF", () => {
    expect(() => readProwlerOcsf('[{"hello": 1}]')).toThrow(/metadata.event_code/);
  });

  it("gives the same suggestions from CSV and from OCSF", () => {
    const fromCsv = readProwler(readProwlerCsv(fixture("prowler-aws.csv")), awsMapping);
    const fromOcsf = readProwler(readProwlerOcsf(fixture("prowler-aws.json")), awsMapping);
    expect(fromOcsf.suggestions).toEqual(fromCsv.suggestions);
    expect(fromOcsf.unmapped).toBe(fromCsv.unmapped);
  });

  it("recognises which provider a report covers", () => {
    expect(prowlerProvider(fixture("prowler-aws.json"))).toBe("aws");
    expect(prowlerProvider(fixture("prowler-aws.csv"))).toBe("aws");
    expect(prowlerImporter("microsoft").detect(fixture("prowler-aws.csv"))).toBe(false);
  });
});

describe("collapsing per-resource findings", () => {
  it("fails a check when one resource fails, however many pass", () => {
    const many = [...Array.from({ length: 40 }, () => finding({ status: "pass" })), finding({ status: "fail", resource: "the-bad-one" })];
    expect(collapse(many)).toMatchObject({ status: "fail", pass: 40, fail: 1 });
    expect(countText(collapse(many))).toBe("1 of 41 resources failing");
  });

  it("passes only when every resource passes", () => {
    expect(collapse([finding(), finding()])).toMatchObject({ status: "pass" });
  });

  it("never turns a muted finding into a pass", () => {
    const muted = [finding({ status: "pass" }), finding({ status: "fail", muted: true })];
    expect(collapse(muted)).toMatchObject({ status: "review", pass: 1, review: 1 });
    expect(countText(collapse(muted))).toBe("1 of 2 resources passing, 1 needing review");
  });

  it("treats MANUAL as review", () => {
    expect(collapse([finding({ status: "review" })])).toMatchObject({ status: "review" });
    expect(countText(collapse([finding({ status: "review" })]))).toBe("1 of 1 resource needing review");
  });
});

describe("mapping Prowler findings to questions", () => {
  const read = (name: string) => readProwler(readProwlerCsv(fixture(name)), awsMapping);
  const answers = (name: string) => Object.fromEntries(read(name).suggestions.map((s) => [s.question, s.evidence.suggested]));

  it("suggests an answer per question using the mapping's safeguards", () => {
    const a = answers("prowler-aws.csv");
    expect(a["AWS-DATA-002"]).toBe("yes");
    expect(a["AWS-DATA-003"]).toBe("no");
    // cap: partial — the checks only cover part of the question.
    expect(a["AWS-BCK-001"]).toBe("partial");
    // One check fails while another passes.
    expect(a["AWS-DATA-001"]).toBe("partial");
    // MANUAL only: nothing decisive, so it stays for the assessor.
    expect(a["AWS-DATA-004"]).toBeUndefined();
    // failIsInconclusive — a fail goes to review rather than No.
    expect(a["AWS-DATA-006"]).toBeUndefined();
  });

  it("says how many resources are behind each check", () => {
    const data = read("prowler-aws.csv").suggestions.find((s) => s.question === "AWS-DATA-001")!;
    const buckets = data.evidence.checks.find((c) => c.id === "s3_bucket_public_access")!;
    expect(buckets.count).toBe("1 of 3 resources failing");
    expect(buckets.examples).toContain("arn:aws:s3:::riverbend-open-data");
  });

  it("lists failing checks it has no question for", () => {
    const result = read("prowler-aws.csv");
    expect(result.unmapped).toBe(1);
    expect(result.unmappedFailing).toEqual(["unmapped_legacy_check"]);
  });

  it("names the scanner, its version and the account on every piece of evidence", () => {
    const ev = read("prowler-aws.csv").suggestions[0].evidence;
    expect(ev).toMatchObject({ source: "Prowler (AWS)", tool: "Prowler (AWS)", toolVersion: "5.44.0", account: "123456789012" });
  });

  it("warns when the scan came from a different major version of Prowler", () => {
    const rows = readProwlerCsv(fixture("prowler-aws.csv")).map((f) => ({ ...f, toolVersion: "6.0.0" }));
    expect(readProwler(rows, awsMapping).warnings?.join(" ")).toMatch(/came from Prowler 6\.0\.0.*checked against 5\.44\.0/);
    expect(read("prowler-aws.csv").warnings).toBeUndefined();
  });

  it("combines several accounts and says which", () => {
    const rows = readProwlerCsv(fixture("prowler-aws.csv"));
    const two = [...rows, ...rows.map((f) => ({ ...f, account: "210987654321", accountName: "Second Co" }))];
    const result = readProwler(two, awsMapping);
    expect(result.accounts?.map((a) => a.id)).toEqual(["123456789012", "210987654321"]);
    expect(result.warnings?.join(" ")).toMatch(/2 accounts were combined/);
    expect(result.suggestions[0].evidence.account).toBeUndefined();
  });
});

describe("the pinned Prowler check list", () => {
  const pinned = (prov: string) =>
    new Set(
      fixture(`prowler-checks-${prov}.txt`)
        .split("\n")
        .filter((l) => l && !l.startsWith("#")),
    );

  it("has every check id the mappings use, so a Prowler bump shows up as a rename", () => {
    for (const [mapping, prov] of [
      [awsMapping, "aws"],
      [azureMapping, "azure"],
    ] as const) {
      const known = pinned(prov);
      const used = mapping.mappings.flatMap((m) => m.checks);
      expect(used.length).toBeGreaterThan(50);
      expect(used.filter((c) => !known.has(c)), `${mapping.id}: check ids Prowler ${prov} doesn't have`).toEqual([]);
    }
  });
});

describe("the importers crownguard registers", () => {
  it("gives every importer a mapping to read", () => {
    for (const i of importers) expect(catalogue.imports.has(i.id), i.id).toBe(true);
  });

  it("detects its own format and no one else's", () => {
    const csv = fixture("prowler-aws.csv");
    expect(importer.detect(csv)).toBe(true);
    expect(prowlerImporter("microsoft").detect(csv)).toBe(false);
  });
});
