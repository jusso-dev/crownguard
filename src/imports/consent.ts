import { aiAppCategories, type AiAppCategory, type AiKind, type KnownAiApp, type OAuthScope } from "../content/schema";
import { newUseCase } from "../engine/aiRegister";
import type { AiDataKind } from "../engine/aiOptions";
import type { AiUseCase } from "../engine/types";
import { parseCsv } from "./prowler";

/**
 * Shadow AI discovery: read an app consent inventory the user exports themselves (Microsoft Graph PowerShell or the
 * Google Admin console) and turn it into a list of apps, classified offline against `content/ai-register/known-ai-apps.yaml`.
 *
 * Privacy: the exports name the people who granted consent. This module counts them and drops them. Nothing it
 * returns carries a user principal name or an email address, so none can end up in a saved assessment.
 */

/** Which platform's export a file came from. */
export type ConsentSource = "microsoft" | "google";

/** How the app got its access. Admin consent covers the whole tenant; user consent is one person at a time. */
export type ConsentType = "admin" | "user" | "both";

/** One app found in a consent export, with counts instead of people. */
export interface FoundApp {
  /** The app's client (application) id. Not personal; used for matching and never written to the assessment. */
  clientId: string;
  /** Display name from the service principal (Microsoft) or the log (Google), falling back to the client id. */
  name: string;
  /** Publisher as the platform records it. */
  publisher?: string;
  /** Microsoft only: the app owner organisation id from the service principal. */
  ownerOrgId?: string;
  consent: ConsentType;
  /** How many distinct people granted it. Counted from the export; the people themselves are dropped. */
  users: number;
  /** Google only: the export said this grant was made by or through an AI agent. */
  byAgent?: boolean;
  /** Permission scopes as the platform writes them. */
  scopes: string[];
  /** Scopes in plain English. */
  scopeSummary: string[];
  /** Holds mail, files, calendar or meeting content, whatever the app is. */
  highReach: boolean;
  /** Data kinds these scopes reach, for "Data it handles" on a register entry. */
  data: AiDataKind[];
  /** AI classification from the curated list, when the app matches one. */
  category?: AiAppCategory;
  /** What matched: a client id or a name pattern. */
  matchedBy?: string;
}

/** What one export holds, ready for the panel. Carries counts and app details, never user identities. */
export interface FoundInventory {
  source: ConsentSource;
  /** What the file was, for the panel heading. */
  label: string;
  apps: FoundApp[];
  /** Consent rows in the file. Counted. */
  grants: number;
  /** Distinct people who granted consent across the file. Counted; never named. */
  users: number;
  /** Google only: the export carried the "By an agent" column. */
  agentColumn?: boolean;
  /** Non-fatal problems worth telling the user. */
  warnings: string[];
}

/** The three groupings the results screen shows. */
export interface AppGroups {
  known: FoundApp[];
  highReach: FoundApp[];
  other: FoundApp[];
}

export const consentImportLabels: Record<ConsentSource, string> = {
  microsoft: "Microsoft consent inventory import",
  google: "Google OAuth log import",
};

/** Files bigger than this are refused rather than parsed: a consent export is small. */
const MAX_BYTES = 8_000_000;
/** And a single file can't carry more rows than this. */
const MAX_ITEMS = 50_000;

const checkSize = (text: string, what: string) => {
  if (text.length > MAX_BYTES)
    throw new Error(`this ${what} is too large to be a consent export (${Math.round(text.length / 1_000_000)} MB; crownguard reads up to ${MAX_BYTES / 1_000_000} MB)`);
};

const truthy = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s !== "" && !/^(false|no|0|n|none|-|n\/a)$/i.test(s);
};

/** Short form of an OAuth scope: the last path segment of a URL, otherwise the token as written. */
export const shortScope = (token: string) => {
  const t = token.trim();
  if (!t.includes("/")) return t;
  return t.split("/").filter(Boolean).at(-1) ?? t;
};

/** A matched client id or name pattern, for the "why is this AI?" line. */
export interface AiMatch {
  app: KnownAiApp;
  matchedBy: string;
}

/**
 * Classify one app against the curated list, offline. Client ids win over names; entries are checked in file order,
 * so a more specific entry (Copilot Studio) is listed before a broader one (Copilot).
 */
export function classifyApp(name: string, clientId: string, known: KnownAiApp[]): AiMatch | undefined {
  const id = clientId.trim().toLowerCase();
  if (id) {
    const byId = known.find((a) => a.clientIds.some((c) => c.trim().toLowerCase() === id));
    if (byId) return { app: byId, matchedBy: `client id ${clientId}` };
  }
  const lower = name.toLowerCase();
  for (const a of known) {
    const pattern = a.namePatterns.find((p) => lower.includes(p.trim().toLowerCase()));
    if (pattern) return { app: a, matchedBy: `the name matches ${a.name} (${pattern})` };
  }
  return undefined;
}

export interface ScopeSummary {
  /** Plain English per distinct meaning; unrecognised scopes are listed by name so nothing is hidden. */
  lines: string[];
  highReach: boolean;
  data: AiDataKind[];
}

/** Scopes in plain English, from `content/ai-register/oauth-scopes.yaml`. */
export function summariseScopes(tokens: string[], table: OAuthScope[]): ScopeSummary {
  const lines: string[] = [];
  const data = new Set<AiDataKind>();
  let highReach = false;
  let unknown = 0;
  for (const raw of tokens) {
    const token = shortScope(raw);
    if (!token) continue;
    const entry = table.find((s) => s.scope.toLowerCase() === token.toLowerCase());
    if (entry) {
      if (!lines.includes(entry.summary)) lines.push(entry.summary);
      highReach = highReach || entry.highReach;
      for (const d of entry.data) data.add(d);
    } else {
      unknown++;
      const line = `Other permission: ${token}`;
      if (unknown <= 5 && !lines.includes(line)) lines.push(line);
    }
  }
  if (unknown > 5) lines.push(`${unknown - 5} more permissions crownguard has no plain-English name for`);
  if (lines.length && data.size === 0) data.add("unknown");
  return { lines, highReach, data: [...data].sort() };
}

/** Group for the panel: known AI first, then anything high-reach, then the rest. Most-granted first in each. */
export function groupApps(apps: FoundApp[]): AppGroups {
  const byReach = (a: FoundApp, b: FoundApp) => b.users - a.users || a.name.localeCompare(b.name);
  return {
    known: apps.filter((a) => a.category).sort(byReach),
    highReach: apps.filter((a) => !a.category && a.highReach).sort(byReach),
    other: apps.filter((a) => !a.category && !a.highReach).sort(byReach),
  };
}

/** "3 users", "1 user", or "everyone (admin consent)". Counts only; the export's names never survive the parse. */
export function userCountText(app: FoundApp): string {
  if (app.consent !== "user" && app.users === 0) return "everyone (admin consent)";
  return `${app.users} user${app.users === 1 ? "" : "s"}`;
}

/** "Admin consent for everyone in the tenant", "User consent from 3 users", or the mix of both. */
export function consentText(app: FoundApp): string {
  const admin = "Admin consent for everyone in the tenant";
  const user = `User consent from ${userCountText(app)}`;
  return app.consent === "both" ? `${admin}, and ${user.toLowerCase()}` : app.consent === "admin" ? admin : user;
}

/** The category label for the panel, e.g. "Meeting note-taker". */
export const categoryLabel = (category: AiAppCategory) => aiAppCategories[category];

/** What one app looks like while a file is being read. User principal ids are counted here and never leave it. */
interface MutableApp {
  clientId: string;
  name?: string;
  publisher?: string;
  ownerOrgId?: string;
  admin: boolean;
  user: boolean;
  byAgent: boolean;
  scopes: Set<string>;
  /** Counted and dropped: only the size of this ever leaves the parse. */
  principals: Set<string>;
}

/** Microsoft's first-party app owner organisation, so Microsoft apps show a publisher even with none recorded. */
const MS_OWNER_ORG = "f8cdef31-a31e-4b4a-93e4-5f571e91255a";

/** Turn the counted apps into the inventory the panel shows, classifying and summarising each one. */
function assemble(
  source: ConsentSource,
  label: string,
  byApp: Map<string, MutableApp>,
  people: Set<string>,
  grants: number,
  known: KnownAiApp[],
  scopes: OAuthScope[],
  warnings: string[],
  agentColumn?: boolean,
): FoundInventory {
  const apps = [...byApp.values()].map((a): FoundApp => {
    const name = a.name ?? a.clientId;
    const match = classifyApp(name, a.clientId, known);
    const summary = summariseScopes([...a.scopes], scopes);
    return {
      clientId: a.clientId,
      name,
      publisher: a.publisher,
      ownerOrgId: a.ownerOrgId,
      consent: a.admin && a.user ? "both" : a.admin ? "admin" : "user",
      users: a.principals.size,
      byAgent: agentColumn ? a.byAgent : undefined,
      scopes: [...a.scopes].sort(),
      scopeSummary: summary.lines,
      highReach: summary.highReach,
      data: summary.data,
      category: match?.app.category,
      matchedBy: match?.matchedBy,
    };
  });
  return { source, label, apps, grants, users: people.size, agentColumn, warnings };
}

type JsonObject = Record<string, unknown>;
const lowerKeys = (o: JsonObject): JsonObject => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
const asString = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

/**
 * Collect the grant and service principal rows out of whatever wrapper the file has: a bare array, `{"value": [...]}`
 * (both PowerShell emits depending on version), or an object with several arrays in it.
 */
function collectItems(value: unknown, rows: JsonObject[], depth = 0): void {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const v of value) collectItems(v, rows, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const o = lowerKeys(value as JsonObject);
  const isGrant = "consenttype" in o || ("clientid" in o && ("scope" in o || "principalid" in o));
  const isSp = "appid" in o || "displayname" in o || "appownerorganizationid" in o;
  if (isGrant || isSp) {
    rows.push(o);
    return;
  }
  for (const v of Object.values(o)) collectItems(v, rows, depth + 1);
}

/**
 * Read a Microsoft consent inventory: the JSON from `Get-MgOauth2PermissionGrant -All | ConvertTo-Json -Depth 5` and
 * `Get-MgServicePrincipal -All | ConvertTo-Json -Depth 5`, saved as one file or picked together. Grants carry the
 * client id, consent type (`AllPrincipals` or `Principal`), scopes and the consenting user; the service principals
 * name the app and its publisher. The users are counted and dropped.
 */
export function readGraphConsent(text: string | string[], known: KnownAiApp[], scopes: OAuthScope[]): FoundInventory {
  const rows: JsonObject[] = [];
  for (const file of Array.isArray(text) ? text : [text]) {
    checkSize(file, "file");
    let json: unknown;
    try {
      json = JSON.parse(file);
    } catch {
      throw new Error("this isn't a Microsoft consent export: it isn't JSON. Look for the Get-MgOauth2PermissionGrant and Get-MgServicePrincipal output");
    }
    collectItems(json, rows);
  }
  const isGrant = (o: JsonObject) => "consenttype" in o || ("clientid" in o && ("scope" in o || "principalid" in o));
  const grants = rows.filter(isGrant);
  const sps = rows.filter((o) => !isGrant(o));
  if (!grants.length && !sps.length)
    throw new Error("this isn't a Microsoft consent export: no OAuth2 permission grants or service principals in it. Look for the Get-MgOauth2PermissionGrant and Get-MgServicePrincipal output");
  if (grants.length + sps.length > MAX_ITEMS) throw new Error(`this export has more than ${MAX_ITEMS} rows; narrow it with Where-Object and try again`);
  if (!grants.length)
    throw new Error("this export has service principals but no consent grants. Pick the Get-MgOauth2PermissionGrant export too (both files can be selected together)");

  const byApp = new Map<string, MutableApp>();
  const people = new Set<string>();
  for (const g of grants) {
    const clientId = asString(g.clientid).trim();
    const key = clientId.toLowerCase();
    const app =
      byApp.get(key) ?? { clientId, admin: false, user: false, byAgent: false, scopes: new Set<string>(), principals: new Set<string>() };
    byApp.set(key, app);
    if (/^allprincipals$/i.test(asString(g.consenttype).trim())) app.admin = true;
    else app.user = true;
    for (const t of asString(g.scope).split(/[\s,]+/)) if (t.trim()) app.scopes.add(shortScope(t));
    const principal = asString(g.principalid).trim();
    if (principal) {
      app.principals.add(principal);
      people.add(principal);
    }
  }

  const named = new Set<string>();
  for (const sp of sps) {
    const key = asString(sp.appid).trim().toLowerCase();
    const app = key ? byApp.get(key) : undefined;
    if (!app) continue;
    named.add(key);
    const displayName = asString(sp.displayname).trim();
    const verified = sp.verifiedpublisher && typeof sp.verifiedpublisher === "object" ? lowerKeys(sp.verifiedpublisher as JsonObject) : {};
    const publisher = asString(verified.displayname).trim() || asString(sp.publishername).trim();
    const ownerOrgId = asString(sp.appownerorganizationid).trim();
    if (displayName) app.name = displayName;
    if (publisher) app.publisher = publisher;
    if (ownerOrgId) {
      app.ownerOrgId = ownerOrgId;
      if (ownerOrgId.toLowerCase() === MS_OWNER_ORG && !app.publisher) app.publisher = "Microsoft";
    }
  }
  const unnamed = [...byApp.values()].filter((a) => !named.has(a.clientId.toLowerCase())).length;
  const warnings: string[] = [];
  if (unnamed)
    warnings.push(
      `${unnamed} ${unnamed === 1 ? "app has" : "apps have"} no matching service principal entry, so ${unnamed === 1 ? "it shows" : "they show"} the app id instead of a name. Pick the Get-MgServicePrincipal export alongside the grants export to name them.`,
    );

  return assemble("microsoft", "Microsoft consent export", byApp, people, grants.length, known, scopes, warnings);
}

/** Google's CSV column names, mapped to what crownguard calls them. */
const googleColumns: Record<string, string[]> = {
  name: ["APPLICATION NAME", "APP NAME"],
  id: ["APPLICATION ID", "CLIENT ID", "OAUTH CLIENT ID"],
  scope: ["SCOPE", "SCOPES", "PERMISSION SCOPE"],
  event: ["EVENT", "EVENT NAME", "EVENT DESCRIPTION"],
  user: ["USER", "USER ID", "USER EMAIL", "USER PRINCIPAL NAME"],
  byAgent: ["BY AN AGENT"],
};

/**
 * Read the CSV the Google Admin console exports from Reporting > Audit and investigation > OAuth log events. The
 * header can sit below preamble lines, and the newer "By an agent" column is picked up where present. User names and
 * emails are counted and dropped here.
 */
export function readGoogleConsent(text: string, known: KnownAiApp[], scopes: OAuthScope[]): FoundInventory {
  checkSize(text, "file");
  if (!text.trim()) throw new Error("this isn't a Google OAuth log export: the file is empty");
  const lines = text.split(/\r?\n/);
  // The header can sit below preamble lines, and the preamble can carry punctuation (a ";" throws the delimiter
  // sniffing off), so find the header line first and parse from there.
  let headerAt = -1;
  for (let r = 0; r < Math.min(lines.length, 50); r++) {
    const upper = lines[r].toUpperCase();
    if (googleColumns.name.some((n) => upper.includes(n)) && (googleColumns.scope.some((n) => upper.includes(n)) || googleColumns.event.some((n) => upper.includes(n)))) {
      headerAt = r;
      break;
    }
  }
  if (headerAt < 0)
    throw new Error("this isn't a Google OAuth log export: no header row with an Application name column. Export from Reporting > Audit and investigation > OAuth log events");

  // parseCsv is the Prowler importer's: delimiter detection plus RFC 4180 quoting.
  const rows = parseCsv(lines.slice(headerAt).join("\n"));
  const index = new Map((rows[0] ?? []).map((c, i) => [c.trim().toUpperCase(), i] as const));
  const pick = (names: string[]) => {
    for (const n of names) {
      const i = index.get(n);
      if (i !== undefined) return i;
    }
    return -1;
  };
  const wanted = Object.fromEntries(Object.entries(googleColumns).map(([k, names]) => [k, pick(names)])) as Record<string, number>;
  const agentColumn = wanted.byAgent >= 0;

  const byApp = new Map<string, MutableApp>();
  const people = new Set<string>();
  let grants = 0;
  for (const cells of rows.slice(1)) {
    if (grants > MAX_ITEMS) throw new Error(`this export has more than ${MAX_ITEMS} rows; narrow the date range and try again`);
    const value = (i: number) => (i >= 0 ? (cells[i] ?? "") : "");
    const event = value(wanted.event).trim();
    if (/revok|remov|delet|block/i.test(event)) continue;
    const name = value(wanted.name).trim();
    const clientId = value(wanted.id).trim();
    if (!name && !clientId) continue;
    grants++;
    const key = (clientId || name).toLowerCase();
    const app = byApp.get(key) ?? { clientId: clientId || name, admin: false, user: false, byAgent: false, scopes: new Set<string>(), principals: new Set<string>() };
    byApp.set(key, app);
    if (name) app.name = name;
    if (/admin|domain/i.test(event)) app.admin = true;
    else app.user = true;
    for (const t of value(wanted.scope).split(/[\s,]+/)) if (t.trim()) app.scopes.add(shortScope(t));
    const user = value(wanted.user).trim();
    if (user) {
      app.principals.add(user);
      people.add(user);
    }
    if (truthy(value(wanted.byAgent))) app.byAgent = true;
  }
  if (!byApp.size) throw new Error("this Google OAuth log export has no grant rows in it");

  const warnings: string[] = [];
  if (!agentColumn) warnings.push(`This export has no "By an agent" column. Add that attribute to the OAuth log events report to see which grants an AI agent made.`);
  return assemble("google", "Google OAuth log export", byApp, people, grants, known, scopes, warnings, agentColumn);
}

/** What a register entry created from the panel carries. Never a readiness answer, never a user identity. */
export function importedUseCase(kind: AiKind, id: string, app: FoundApp, source: ConsentSource): AiUseCase {
  const who =
    app.consent === "user"
      ? `${userCountText(app)} granted it, one person at a time`
      : app.consent === "both"
        ? `an admin granted it for everyone, and ${userCountText(app)} also granted it individually`
        : "an admin granted it for everyone in the tenant";
  return {
    ...newUseCase(kind, id),
    name: app.name,
    product: app.name,
    access: app.consent === "user" ? "delegated" : "org-wide",
    data: [...app.data],
    description: `Found by the ${consentImportLabels[source]}. Publisher: ${app.publisher ?? "not recorded in the export"}. ${who.charAt(0).toUpperCase()}${who.slice(1)}. It holds: ${app.scopeSummary.join("; ") || "no permissions crownguard could name"}.`,
    foundBy: consentImportLabels[source],
    answers: {},
    notes: {},
  };
}
