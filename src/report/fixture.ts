import type { Catalogue } from "../content/schema";
import type { Answer, Assessment } from "../engine/types";
import { emptyAssessment } from "../wizard/empty";

/** A full assessment touching every asset type and a mix of answers, for render tests. */
export function fixtureAssessment(catalogue: Catalogue, platforms: string[]): Assessment {
  const a = emptyAssessment();
  const cycle: Answer[] = ["yes", "no", "partial", "yes", "unknown", "na", "no"];
  a.org = { name: "Riverbend Health", abn: "51824753556", sector: "Health", size: "200–999 staff", jurisdiction: "Australia", regulations: ["privacy-act"] };
  a.platforms = platforms;
  for (const pid of platforms) {
    const b = catalogue.platforms.get(pid)!;
    a.licence[pid] = b.platform.licenceTiers[0].id;
    a.modules[pid] = b.platform.modules.filter((m) => m.optional).map((m) => m.id);
    b.assetTypes.forEach((t, i) =>
      a.jewels.push({
        id: `${t.id}-1`,
        name: t.examples[0] ?? t.name,
        platform: pid,
        assetType: t.id,
        description: i % 3 === 0 ? `Why ${t.name} matters to the organisation.` : "",
        classification: i % 2 ? "highly-confidential" : "confidential",
        confidentiality: ((i % 5) + 1) as 1,
        integrity: 4,
        availability: 3,
        regulations: i % 2 ? ["privacy-act"] : [],
        exposures: t.exposures.slice(0, i % 3),
        businessProcesses: i % 2 ? "Payroll, client billing" : "",
      }),
    );
    b.questions.forEach((q, i) => {
      a.answers[q.id] = cycle[i % cycle.length];
      // Every second N/A gets a reason; the rest exercise the "reason missing counts as unanswered" rule.
      if (a.answers[q.id] === "na" && i % 2 === 0) a.notes[q.id] = "Not used here: we have no on-premises infrastructure.";
    });
  }
  a.notes[catalogue.platforms.get(platforms[0])!.questions[1].id] = "Tracked in change CHG-1042.";
  a.branding = { ...a.branding, preparedBy: "Alex Chen, IT Manager", preparedFor: "Executive Leadership Team" };
  return a;
}
