import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalogue } from "../content/catalogue";
import { prowlerImporter } from "./prowler";

const fixture = (name: string) => readFileSync(new URL(`../../e2e/fixtures/${name}`, import.meta.url), "utf8");
const awsMapping = catalogue.imports.get("prowler-aws")!;
const azureMapping = catalogue.imports.get("prowler-azure")!;
const aws = prowlerImporter("aws");
const azure = prowlerImporter("microsoft");
const csv = fixture("prowler-aws.csv");
const ocsf = fixture("prowler-aws.json");
const read = (text: string, mapping = awsMapping) => aws.read(text, mapping);
const answers = (text: string) => Object.fromEntries(read(text).suggestions.map((s) => [s.question, s.evidence.suggested]));

/** A small Prowler CSV for one check: one row per resource, `status` then optional `muted`. */
const rows = (check: string, resources: [string, string, string?][], header = "CHECK_ID;CHECK_TITLE;STATUS;MUTED;ACCOUNT_UID;RESOURCE_UID;TIMESTAMP") =>
  [header, ...resources.map(([resource, status, muted = "False"]) => [check, "A check", status, muted, "123456789012", resource, "2026-10-08T22:00:00Z"].join(";"))].join("\n");
const evidenceFor = (check: string, text: string) => {
  const m = { ...awsMapping, mappings: [{ question: "AWS-DATA-001", checks: [check], rationale: "test only" }] };
  return read(text, m).suggestions[0].evidence;
};

describe("reading Prowler output", () => {
  it("reads the columns Prowler documents, wherever they appear in the row", () => {
    const r = read(csv);
    expect(r).toMatchObject({ tool: "Prowler (AWS)", toolVersion: "5.44.0", tenant: "Example Co", domain: "123456789012", scannedAt: "2026-10-08T22:00:00.000Z" });
    expect(r.accounts).toEqual([{ id: "123456789012", name: "Example Co", findings: 16 }]);
    const backup = r.suggestions.flatMap((s) => s.evidence.checks).find((c) => c.id === "backup_plans_exist")!;
    expect(backup).toMatchObject({ setting: "Ensure AWS Backup plans exist", status: "pass", examples: ["arn:aws:backup:ap-southeast-2:123456789012:backup-plan/daily"] });
  });

  it("reads a Prowler v3 file by its older column names", () => {
    const v3 = [
      "ACCOUNT_ID,ASSESSMENT_START_TIME,CHECK_ID,STATUS,MUTED,RESOURCE_ARN,FINDING_UNIQUE_ID,PROWLER_VERSION",
      "123456789012,2026-10-08T22:00:00Z,s3_bucket_public_access,PASS,FALSE,arn:aws:s3:::b,uid-1,3.11.0",
    ].join("\n");
    const r = read(v3);
    expect(r).toMatchObject({ toolVersion: "3.11.0", domain: "123456789012" });
    expect(r.suggestions.flatMap((s) => s.evidence.checks).find((c) => c.id === "s3_bucket_public_access")?.examples).toEqual(["arn:aws:s3:::b"]);
  });

  it("spots the delimiter and reads quoted fields", () => {
    const quoted = 'CHECK_ID\tCHECK_TITLE\tSTATUS\tRESOURCE_UID\ns3_bucket_public_access\t"Say ""hi""\tto\nme"\tPASS\tarn:aws:s3:::b\n';
    expect(evidenceFor("s3_bucket_public_access", quoted).checks[0]).toMatchObject({ setting: 'Say "hi"\tto\nme', status: "pass" });
  });

  it("says so when the file isn't Prowler CSV or OCSF", () => {
    expect(() => read("CHECK_ID_X,STATUS_Y\nx,1")).toThrow(/CHECK_ID and STATUS/);
    expect(() => read('[{"hello": 1}]')).toThrow(/metadata.event_code/);
    expect(() => read("CHECK_ID,STATUS\n")).toThrow(/no findings/);
  });

  it("gives the same result from CSV and from OCSF", () => {
    const fromCsv = read(csv);
    const fromOcsf = read(ocsf);
    expect(fromOcsf.suggestions).toEqual(fromCsv.suggestions);
    expect(fromOcsf.unmapped).toBe(fromCsv.unmapped);
    expect(fromOcsf.scannedAt).toBe(fromCsv.scannedAt);
  });
});

describe("telling AWS and Azure reports apart", () => {
  it("sends each to its own importer, and never reads JSON as a CSV because it names CHECK_ID and STATUS", () => {
    expect(aws.detect(csv)).toBe(true);
    expect(aws.detect(ocsf)).toBe(true);
    expect(azure.detect(csv)).toBe(false);
    expect(azure.detect(ocsf)).toBe(false);
    expect(azure.detect(fixture("prowler-azure.json"))).toBe(true);
    const json = '{"summary":{},"findings":[{"check_id":"X","status":"pass"}]}';
    expect(aws.detect(json)).toBe(false);
    expect(aws.detect(`  \n[${json}]`)).toBe(false);
  });

  it("takes a file that doesn't name its provider at face value", () => {
    const bare = rows("s3_bucket_public_access", [["arn:aws:s3:::b", "PASS"]]);
    expect(aws.detect(bare)).toBe(true);
    expect(azure.detect(bare)).toBe(true);
  });
});

describe("collapsing per-resource findings", () => {
  const check = "s3_bucket_public_access";

  it("fails a check when one resource fails, however many pass, and gives the failing resources as examples", () => {
    const many = rows(check, [...Array.from({ length: 40 }, (_, i): [string, string] => [`ok-${i}`, "PASS"]), ["the-bad-one", "FAIL"]]);
    expect(evidenceFor(check, many).checks[0]).toMatchObject({ status: "fail", count: "1 of 41 resources failing", current: "1 of 41 resources failing", examples: ["the-bad-one"] });
  });

  it("passes only when every resource passes", () => {
    expect(evidenceFor(check, rows(check, [["a", "PASS"], ["b", "PASS"]])).checks[0]).toMatchObject({ status: "pass", count: "2 of 2 resources passing" });
  });

  it("never turns a muted finding into a pass", () => {
    const muted = rows(check, [["a", "PASS"], ["b", "FAIL", "True"]]);
    expect(evidenceFor(check, muted).checks[0]).toMatchObject({ status: "review", count: "1 of 2 resources passing, 1 needing review", examples: ["a"] });
  });

  it("treats MANUAL, MUTED and anything unknown as review", () => {
    for (const status of ["MANUAL", "MUTED", "PASSIVE"])
      expect(evidenceFor(check, rows(check, [["a", status]])).checks[0], status).toMatchObject({ status: "review", count: "1 of 1 resource needing review" });
  });
});

describe("mapping Prowler findings to questions", () => {
  it("suggests an answer per question using the mapping's safeguards", () => {
    const a = answers(csv);
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
    const data = read(csv).suggestions.find((s) => s.question === "AWS-DATA-001")!;
    const buckets = data.evidence.checks.find((c) => c.id === "s3_bucket_public_access")!;
    expect(buckets.count).toBe("1 of 3 resources failing");
    expect(buckets.examples).toContain("arn:aws:s3:::riverbend-open-data");
  });

  it("lists failing checks it has no question for", () => {
    const result = read(csv);
    expect(result.unmapped).toBe(1);
    expect(result.unmappedFailing).toEqual(["unmapped_legacy_check"]);
  });

  it("names the scanner, its version and the account on every piece of evidence", () => {
    expect(read(csv).suggestions[0].evidence).toMatchObject({ source: "Prowler (AWS)", toolVersion: "5.44.0", account: "123456789012" });
  });

  it("warns when the scan came from a different major version of Prowler", () => {
    const six = csv.replaceAll(",5.44.0,", ",6.0.0,");
    expect(read(six).warnings?.join(" ")).toContain(`came from Prowler (AWS) 6.0.0. The check ids in crownguard's mappings were checked against ${awsMapping.checkedAgainst}`);
    expect(read(csv).warnings).toBeUndefined();
  });

  it("combines several accounts and says which", () => {
    const [header, ...body] = csv.trimEnd().split("\n");
    const second = body.map((l) => l.replaceAll("123456789012", "210987654321").replace("Example Co", "Second Co"));
    const result = read([header, ...body, ...second].join("\n"));
    expect(result.accounts?.map((a) => a.id)).toEqual(["123456789012", "210987654321"]);
    expect(result).toMatchObject({ tenant: "Example Co, Second Co", domain: "2 accounts" });
    expect(result.warnings?.join(" ")).toMatch(/2 accounts were combined/);
    expect(result.suggestions[0].evidence.account).toBeUndefined();
  });

  it("keeps resource ids as examples but drops one that is a user's address", () => {
    const check = "entra_user_with_vm_access_has_mfa";
    const m = { ...azureMapping, mappings: [{ question: "MS-ID-001", checks: [check], rationale: "test only" }] };
    const ev = azure.read(rows(check, [["alice@contoso.example", "FAIL"], ["/subscriptions/1/vm/a", "FAIL"]]), m).suggestions[0].evidence;
    expect(ev.checks[0].examples).toEqual(["[account]", "/subscriptions/1/vm/a"]);
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
      // The list and checkedAgainst move together (pnpm guidance:update), so the list is the release checked against.
      expect(fixture(`prowler-checks-${prov}.txt`)).toMatch(new RegExp(`^# .* at tag ${mapping.checkedAgainst!.replaceAll(".", "\\.")} \\(`));
    }
  });
});
