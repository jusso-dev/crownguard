import { describe, expect, it } from "vitest";
import { checkDrift, checkFamily, mappedChecks } from "./scanner-checks";

describe("scanner check drift", () => {
  it("groups ids into the families a suggestion is made from", () => {
    expect(checkFamily("ENTRA-ENTAPP-020")).toBe("ENTRA-ENTAPP");
    expect(checkFamily("backup_plans_exist")).toBe("backup");
    expect(checkFamily("GWS.GMAIL.7.3v1")).toBe("GWS.GMAIL");
  });

  it("lists every question using a removed check, and new checks only in families already mapped", () => {
    const mapped = mappedChecks([
      { question: "AWS-BCK-001", checks: ["backup_plans_exist", "backup_vaults_exist"] },
      { question: "AWS-LOG-002", checks: ["cloudwatch_retired", "backup_vaults_exist"] },
    ]);
    const drift = checkDrift(mapped, ["backup_plans_exist", "backup_new", "cloudwatch_new", "s3_new"]);
    expect(drift.removed).toEqual([
      { id: "backup_vaults_exist", questions: ["AWS-BCK-001", "AWS-LOG-002"] },
      { id: "cloudwatch_retired", questions: ["AWS-LOG-002"] },
    ]);
    expect(drift.added).toEqual(["backup_new", "cloudwatch_new"]);
    expect(checkDrift(mapped, ["backup_new", "cloudwatch_new"], new Set(["backup_new"])).added).toEqual(["cloudwatch_new"]);
  });

  it("treats a new SCuBA policy version as a removal plus an addition, so the mapping is updated", () => {
    const drift = checkDrift(mappedChecks([{ question: "GWS-GMAIL-001", checks: ["GWS.GMAIL.1.1v1"] }]), ["GWS.GMAIL.1.1v2"]);
    expect(drift.removed.map((r) => r.id)).toEqual(["GWS.GMAIL.1.1v1"]);
    expect(drift.added).toEqual(["GWS.GMAIL.1.1v2"]);
  });
});
