import { describe, expect, it } from "vitest";
import { readContentFiles } from "../../scripts/read-content";
import { loadCatalogue } from "../content/loader";
import { importedUseCase, readGoogleConsent, readGraphConsent } from "./consent";

const { catalogue } = loadCatalogue(readContentFiles());
const known = catalogue.aiRegister!.knownApps;
const scopes = catalogue.aiRegister!.scopes;
const connector = catalogue.aiRegister!.model.kinds.find((k) => k.id === "ai-connector")!;

describe("independent privacy check", () => {
  it("keeps every user name and email out of the parsed result and the register entry", () => {
    const graph = JSON.stringify([
      { clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", consentType: "AllPrincipals", scope: "Calendars.Read OnlineMeetings.Read" },
    ]);
    const sp = JSON.stringify([
      { appId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", displayName: "Example Note-taker", appOwnerOrganizationId: "11111111-2222-3333-4444-555555555555" },
    ]);
    const csv = [
      "Event Name,Application Name,Application ID,Scope,User,By an agent",
      "grant,Example Note-taker,aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,Calendars.Read,jane.citizen@agency.gov.au,false",
    ].join("\n");

    const ms = readGraphConsent([graph, sp], known, scopes);
    const gw = readGoogleConsent(csv, known, scopes);
    for (const [label, out] of [["graph", ms], ["google", gw]] as const) {
      const text = JSON.stringify(out);
      for (const leak of ["jane.citizen", "@agency.gov.au", "jane"])
        expect(text, `${label} leaks ${leak}`).not.toContain(leak);
    }
    // And nothing from a person's name reaches the register entry that gets saved.
    const entry = importedUseCase(connector, "e1", (ms.apps ?? [])[0], "microsoft");
    expect(JSON.stringify(entry)).not.toContain("@");
  });
});
