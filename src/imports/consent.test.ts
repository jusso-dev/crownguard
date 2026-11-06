import { describe, expect, it } from "vitest";
import { readContentFiles } from "../content/disk";
import { loadCatalogue } from "../content/loader";
import { consentText, groupApps, importedUseCase, readGoogleConsent, readGraphConsent, type FoundApp } from "./consent";

const { catalogue } = loadCatalogue(readContentFiles());
const known = catalogue.aiRegister!.knownApps;
const scopes = catalogue.aiRegister!.scopes;
const connector = catalogue.aiRegister!.model.kinds.find((k) => k.id === "ai-connector")!;

/** Synthetic example data shaped like `Get-MgOauth2PermissionGrant` output. User ids are written as emails on purpose. */
const GRANTS = JSON.stringify([
  { clientId: "11111111-1111-1111-1111-111111111111", consentType: "Principal", scope: "Calendars.Read OnlineMeetings.Read", principalId: "ana.ivanovic@contoso.example" },
  { clientId: "11111111-1111-1111-1111-111111111111", consentType: "Principal", scope: "Calendars.Read OnlineMeetings.Read", principalId: "bo.chen@contoso.example" },
  { clientId: "11111111-1111-1111-1111-111111111111", consentType: "Principal", scope: "Calendars.Read", principalId: "ana.ivanovic@contoso.example" },
  { clientId: "22222222-2222-2222-2222-222222222222", consentType: "AllPrincipals", scope: "Mail.Read Files.Read.All", principalId: null },
  { clientId: "33333333-3333-3333-3333-333333333333", consentType: "Principal", scope: "User.Read", principalId: "bo.chen@contoso.example" },
]);

/** Synthetic example data shaped like `Get-MgServicePrincipal` output. */
const SERVICE_PRINCIPALS = JSON.stringify({
  value: [
    { appId: "11111111-1111-1111-1111-111111111111", displayName: "Fathom Meeting Assistant", appOwnerOrganizationId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", verifiedPublisher: { displayName: "Fathom Video" } },
    { appId: "22222222-2222-2222-2222-222222222222", displayName: "Contoso Backup Tool", appOwnerOrganizationId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", publisherName: "Contoso IT" },
    { appId: "33333333-3333-3333-3333-333333333333", displayName: "Weather Add-in", appOwnerOrganizationId: "f8cdef31-a31e-4b4a-93e4-5f571e91255a" },
  ],
});

const byName = (inventory: { apps: FoundApp[] }, name: string) => inventory.apps.find((a) => a.name === name)!;

describe("Microsoft consent export", () => {
  it("turns grants and service principals into apps with counts, never names", () => {
    const r = readGraphConsent([GRANTS, SERVICE_PRINCIPALS], known, scopes);
    expect(r.source).toBe("microsoft");
    expect(r.grants).toBe(5);
    expect(r.users).toBe(2);
    expect(r.apps.map((a) => a.name).sort()).toEqual(["Contoso Backup Tool", "Fathom Meeting Assistant", "Weather Add-in"]);

    const fathom = byName(r, "Fathom Meeting Assistant");
    expect(fathom.consent).toBe("user");
    expect(fathom.users).toBe(2);
    expect(fathom.publisher).toBe("Fathom Video");
    expect(fathom.category).toBe("note-taker");
    expect(fathom.highReach).toBe(true);
    expect(fathom.scopeSummary).toContain("Read everyone's calendars, including meeting titles and times");

    const backup = byName(r, "Contoso Backup Tool");
    expect(backup.consent).toBe("admin");
    expect(backup.users).toBe(0);
    expect(consentText(backup)).toBe("Admin consent for everyone in the tenant");
    expect(backup.category).toBeUndefined();
    expect(backup.highReach).toBe(true);
    // Microsoft's first-party owner org still names the publisher.
    expect(byName(r, "Weather Add-in").publisher).toBe("Microsoft");
  });

  it("accepts a bare array, a { value: [...] } wrapper, one file or two", () => {
    const combined = JSON.stringify([...JSON.parse(GRANTS), ...(JSON.parse(SERVICE_PRINCIPALS) as { value: unknown[] }).value]);
    const one = readGraphConsent(combined, known, scopes);
    expect(one.apps.map((a) => a.name).sort()).toEqual(["Contoso Backup Tool", "Fathom Meeting Assistant", "Weather Add-in"]);
    const wrapped = readGraphConsent(JSON.stringify({ value: JSON.parse(GRANTS) }), known, scopes);
    expect(wrapped.grants).toBe(5);
    const single = readGraphConsent(JSON.stringify(JSON.parse(GRANTS)[3]), known, scopes);
    expect(single.apps.map((a) => a.name)).toEqual(["22222222-2222-2222-2222-222222222222"]);
    expect(single.warnings.join(" ")).toContain("no matching service principal entry");
  });

  it("names apps by client id when only the grants export is picked", () => {
    const r = readGraphConsent(GRANTS, known, scopes);
    expect(byName(r, "11111111-1111-1111-1111-111111111111").users).toBe(2);
    expect(r.warnings.join(" ")).toContain("Get-MgServicePrincipal");
  });

  it("rejects an empty export", () => {
    expect(() => readGraphConsent("[]", known, scopes)).toThrow(/no OAuth2 permission grants or service principals/);
    expect(() => readGraphConsent('{"value": []}', known, scopes)).toThrow(/no OAuth2 permission grants or service principals/);
  });

  it("rejects the wrong file", () => {
    expect(() => readGraphConsent('{"version": 1, "org": {}}', known, scopes)).toThrow(/no OAuth2 permission grants or service principals/);
    expect(() => readGraphConsent("CHECK_ID,STATUS", known, scopes)).toThrow(/isn't JSON/);
    expect(() => readGraphConsent(SERVICE_PRINCIPALS, known, scopes)).toThrow(/service principals but no consent grants/);
  });

  it("refuses an oversized export rather than parsing it", () => {
    expect(() => readGraphConsent("[".concat("x".repeat(8_000_000), "]"), known, scopes)).toThrow(/too large/);
  });
});

/** Synthetic example data: a Google Admin console export of OAuth log events, with a preamble line above the header. */
const GOOGLE_CSV = `EXAMPLE DATA - synthetic export for crownguard's tests; not real users
Application name,Application ID,Scope,Event,User,By an agent,Agent info
Fathom Meeting Assistant,44444444,https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/meetings.readonly,Grant access,ana.ivanovic@contoso.example,Yes,Meeting agent
Fathom Meeting Assistant,44444444,calendar.readonly meetings.readonly,Grant access,bo.chen@contoso.example,Yes,Meeting agent
Contoso Backup Tool,55555555,gmail.readonly drive.readonly,Grant access,ana.ivanovic@contoso.example,No,
Weather Add-in,66666666,openid userinfo.email,Grant access,bo.chen@contoso.example,No,
Weather Add-in,66666666,openid,Revoke access,bo.chen@contoso.example,No,`;

describe("Google OAuth log export", () => {
  it("reads the header wherever it is, counts users, and flags grants made by an agent", () => {
    const r = readGoogleConsent(GOOGLE_CSV, known, scopes);
    expect(r.source).toBe("google");
    expect(r.agentColumn).toBe(true);
    expect(r.users).toBe(2);
    expect(r.apps).toHaveLength(3);

    const fathom = byName(r, "Fathom Meeting Assistant");
    expect(fathom.consent).toBe("user");
    expect(fathom.users).toBe(2);
    expect(fathom.byAgent).toBe(true);
    expect(fathom.category).toBe("note-taker");
    expect(fathom.highReach).toBe(true);

    const backup = byName(r, "Contoso Backup Tool");
    expect(backup.highReach).toBe(true);
    expect(backup.category).toBeUndefined();
    expect(backup.byAgent).toBe(false);

    const weather = byName(r, "Weather Add-in");
    expect(weather.highReach).toBe(false);
    expect(weather.users).toBe(1);
    expect(consentText(weather)).toBe("User consent from 1 user");
  });

  it("says when the 'By an agent' column is missing", () => {
    const noAgent = GOOGLE_CSV.split("\n")
      .map((line) => line.split(",").slice(0, 5).join(","))
      .join("\n");
    const r = readGoogleConsent(noAgent, known, scopes);
    expect(r.agentColumn).toBe(false);
    expect(r.apps.every((a) => a.byAgent === undefined)).toBe(true);
    expect(r.warnings.join(" ")).toContain("By an agent");
  });

  it("rejects the wrong file", () => {
    expect(() => readGoogleConsent("CHECK_ID,STATUS\nCA-1,pass", known, scopes)).toThrow(/isn't a Google OAuth log export/);
    expect(() => readGoogleConsent("", known, scopes)).toThrow(/empty/);
  });

  it("refuses an oversized export rather than parsing it", () => {
    expect(() => readGoogleConsent("x".repeat(8_000_001), known, scopes)).toThrow(/too large/);
  });
});

describe("keeping people out of what is read", () => {
  it("keeps every user name and email out of both readers' results and the register entry", () => {
    const ms = readGraphConsent([GRANTS, SERVICE_PRINCIPALS], known, scopes);
    const gw = readGoogleConsent(GOOGLE_CSV, known, scopes);
    for (const [label, out] of [["graph", ms], ["google", gw]] as const)
      for (const leak of ["@", "ana.ivanovic", "bo.chen"]) expect(JSON.stringify(out), `${label} leaks ${leak}`).not.toContain(leak);
    for (const app of [...ms.apps, ...gw.apps]) expect(JSON.stringify(importedUseCase(connector, "e1", app, "microsoft"))).not.toContain("@");
  });
});

/** An app per name, each granted once, read from a Google export. */
const appsNamed = (names: string[], known_ = known) =>
  readGoogleConsent(["Application name,Application ID,Scope,Event", ...names.map((n, i) => `${n},id-${i},openid,Grant access`)].join("\n"), known_, scopes).apps;

describe("AI classification from the curated list", () => {
  it("matches names most specific first and never claims a non-AI app", () => {
    const names = ["Fathom Meeting Assistant", "Microsoft Copilot Studio", "Microsoft 365 Copilot", "Otter.ai Notetaker", "GitHub MCP Server", "OpenAI", "Contoso Backup Tool"];
    expect(Object.fromEntries(appsNamed(names).map((a) => [a.name, a.category]))).toEqual({
      "Fathom Meeting Assistant": "note-taker",
      "Microsoft Copilot Studio": "agent-platform",
      "Microsoft 365 Copilot": "assistant",
      "Otter.ai Notetaker": "note-taker",
      "GitHub MCP Server": "mcp-server",
      OpenAI: "model-provider",
      "Contoso Backup Tool": undefined,
    });
  });

  it("matches a published OAuth client id wherever the name leads", () => {
    const list = [{ ...known[0], id: "test-app", name: "Test App", namePatterns: ["nope"], clientIds: ["abcdef12-3456"] }];
    const grant = JSON.stringify([{ clientId: "ABCDEF12-3456", consentType: "AllPrincipals", scope: "openid" }]);
    expect(readGraphConsent(grant, list, scopes).apps[0]).toMatchObject({ category: known[0].category, matchedBy: "client id ABCDEF12-3456" });
  });

  it("cites the vendor's own page for every entry", () => {
    for (const app of known) expect(catalogue.sources.get(app.source)?.url, app.id).toMatch(/^https:\/\//);
  });
});

describe("scope summaries", () => {
  const appWith = (scope: string) => readGraphConsent(JSON.stringify([{ clientId: "c1", consentType: "AllPrincipals", scope }]), known, scopes).apps[0];

  it("says what the scopes mean in plain English and flags high reach", () => {
    const app = appWith("Mail.Read https://www.googleapis.com/auth/gmail.readonly Weird.Scope");
    expect(app.scopeSummary).toEqual(expect.arrayContaining(["Read all email in every mailbox", "Read all email in Gmail", "Other permission: Weird.Scope"]));
    expect(app.highReach).toBe(true);
    expect(app.data).toEqual(["official", "personal"]);
  });

  it("leaves low-reach scopes unflagged and shortens scope URLs", () => {
    const app = appWith("openid https://www.googleapis.com/auth/drive.file");
    expect(app.scopes).toEqual(["drive.file", "openid"]);
    expect(app.highReach).toBe(false);
    expect(app.data).toEqual(["official", "personal"]);
  });

  it("names the first five scopes it doesn't know and counts the rest", () => {
    const app = appWith(Array.from({ length: 7 }, (_, i) => `Weird.${i}`).join(" "));
    expect(app.scopeSummary).toHaveLength(6);
    expect(app.scopeSummary.at(-1)).toBe("2 more permissions crownguard has no plain-English name for");
    expect(app.data).toEqual(["unknown"]);
  });
});

describe("grouping and the register entry", () => {
  it("groups known AI, high-reach and everything else", () => {
    const r = readGraphConsent([GRANTS, SERVICE_PRINCIPALS], known, scopes);
    const g = groupApps(r.apps);
    expect(g.known.map((a) => a.name)).toEqual(["Fathom Meeting Assistant"]);
    expect(g.highReach.map((a) => a.name)).toEqual(["Contoso Backup Tool"]);
    expect(g.other.map((a) => a.name)).toEqual(["Weather Add-in"]);
  });

  it("creates an ai-connector entry with product, access and data filled and no answers", () => {
    const r = readGraphConsent([GRANTS, SERVICE_PRINCIPALS], known, scopes);
    const entry = importedUseCase(connector, "test-id", byName(r, "Contoso Backup Tool"), "microsoft");
    expect(entry.kind).toBe("ai-connector");
    expect(entry.product).toBe("Contoso Backup Tool");
    expect(entry.access).toBe("org-wide");
    expect(entry.data).toEqual(["official", "personal"]);
    expect(entry.foundBy).toBe("Microsoft consent inventory import");
    expect(entry.answers).toEqual({});
    expect(entry.notes).toEqual({});
    expect(entry.description).toContain("Publisher: Contoso IT");
    expect(entry.description).toContain("admin granted it for everyone");
    expect(entry.description).not.toContain("@");

    const user = importedUseCase(connector, "test-id", byName(r, "Fathom Meeting Assistant"), "microsoft");
    expect(user.access).toBe("delegated");
    expect(user.data).toEqual(["official", "personal"]);
  });
});
