import { useRef } from "react";
import { catalogue } from "../content/catalogue";
import type { AiUseCase } from "../engine/types";
import {
  categoryLabel,
  consentText,
  groupApps,
  importedUseCase,
  readGoogleConsent,
  readGraphConsent,
  type FoundApp,
  type FoundInventory,
} from "../imports/consent";
import { useStore } from "./store";
import { Button } from "./ui";

const link = "text-accent underline decoration-accent/30 underline-offset-2 [@media(hover:hover)]:hover:decoration-accent";
const mono = "rounded-[4px] border border-rule bg-sunken px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2";

/** The Graph cmdlets the panel documents. Shown verbatim so the export can be made with the least privilege. */
const GRANTS_CMD = "Get-MgOauth2PermissionGrant -All | ConvertTo-Json -Depth 5 | Set-Content grants.json";
const SERVICE_PRINCIPALS_CMD = "Get-MgServicePrincipal -All | ConvertTo-Json -Depth 5 | Set-Content service-principals.json";

/**
 * Scroll to the panel wherever it now is. Used by the Controls step's link, which changes steps first, so the panel
 * may still be a frame away from existing: try a few times before giving up.
 */
export function scrollToFoundApps(attempts = 10) {
  const el = document.getElementById("found-apps");
  if (el) el.scrollIntoView({ block: "start" });
  else if (attempts > 0) requestAnimationFrame(() => scrollToFoundApps(attempts - 1));
}

/** Open the export instructions and scroll to them. */
function openHow() {
  const how = document.getElementById("found-apps-how") as HTMLDetailsElement | null;
  if (how) {
    how.open = true;
    how.scrollIntoView({ block: "start" });
  }
}

/**
 * Optional "Found apps" panel on the AI register step: shadow AI discovery. The user exports their own app consent
 * inventory (Microsoft Graph PowerShell or the Google Admin console), this reads it in the browser, classifies the
 * apps offline against `content/ai-register/known-ai-apps.yaml`, and offers to add each one to the AI use-case
 * register. The export names the people who granted consent; crownguard counts them and never saves them.
 *
 * The transient state (the parsed file and its messages) lives on the step, not here: starting the register swaps the
 * step's layout, this panel remounts, and the results have to survive that.
 */
export interface FoundAppsState {
  preview?: FoundInventory;
  error?: string;
  done?: string;
}

/** Stable empty list, so the store selector never hands back a fresh array. */
const NO_ENTRIES: AiUseCase[] = [];

export function FoundApps({ state, setState }: { state: FoundAppsState; setState: (fn: (s: FoundAppsState) => FoundAppsState) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const setAiIncluded = useStore((s) => s.setAiIncluded);
  const addImportedAiUseCase = useStore((s) => s.addImportedAiUseCase);
  const entries = useStore((s) => s.assessment.aiRegister?.entries) ?? NO_ENTRIES;
  const { preview, error, done } = state;

  const added = new Set(entries.filter((e) => e.foundBy).map((e) => e.name));

  async function onFiles(files: FileList) {
    setState((s) => ({ ...s, error: undefined, done: undefined, preview: undefined }));
    try {
      const picked = [...files];
      if (!picked.length) return;
      const texts = await Promise.all(picked.map((f) => f.text()));
      const known = catalogue.aiRegister?.knownApps ?? [];
      const scopes = catalogue.aiRegister?.scopes ?? [];
      const json = texts.every((t) => /^\s*[[{]/.test(t));
      const csv = texts.length === 1 && /^\s*[^[{]/.test(texts[0]);
      if (!json && !csv) throw new Error("pick either the Microsoft Graph export (one or two JSON files) or the Google OAuth log export (one CSV file)");
      const result = json ? readGraphConsent(texts, known, scopes) : readGoogleConsent(texts[0], known, scopes);
      if (!result.apps.length) throw new Error("no apps with consent grants were found in that file");
      setState((s) => ({ ...s, preview: result }));
    } catch (e) {
      setState((s) => ({ ...s, error: `Couldn't read that export: ${(e as Error).message}.` }));
    }
  }

  function add(app: FoundApp) {
    const kind = catalogue.aiRegister?.model.kinds.find((k) => k.id === "ai-connector");
    if (!kind || !preview) return;
    setAiIncluded(true);
    addImportedAiUseCase(importedUseCase(kind, crypto.randomUUID(), app, preview.source));
    setState((s) => ({ ...s, done: `${app.name} added to the AI use-case register as a third-party AI connector. Its readiness questions start unanswered.` }));
  }

  const groups = preview ? groupApps(preview.apps) : undefined;

  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-rule bg-surface" aria-label="Found apps" data-testid="found-apps" id="found-apps">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Found apps: find the AI people have already connected.</p>
          <p className="mt-0.5 text-xs text-muted">
            Optional. Export the list of apps people have granted access to — Microsoft Entra ID or Google Workspace — and crownguard sorts
            out the AI tools, note-takers and agents from it, entirely in your browser.{" "}
            <button type="button" className={link} onClick={openHow}>
              How to export the list
            </button>
          </p>
        </div>
        <Button variant="secondary" onClick={() => input.current?.click()}>
          Choose an export file
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".json,.csv,application/json,text/csv"
          className="hidden"
          data-testid="consent-input"
          onChange={(e) => {
            if (e.target.files) void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p className="border-t border-rule px-4 py-2.5 text-xs text-muted sm:px-5" data-testid="consent-privacy">
        <strong className="font-medium text-ink-2">These exports name people.</strong> They list the user names and email addresses of everyone who
        granted consent. crownguard counts them to show how many users each app has and never keeps the names: only the app&apos;s name, publisher,
        scope summary and user counts can end up in your saved assessment.
      </p>

      <ExportHow />

      {error && (
        <p role="alert" data-testid="consent-error" className="border-t border-rule px-4 py-2.5 text-sm text-danger sm:px-5">
          {error}
        </p>
      )}
      {done && (
        <p role="status" data-testid="consent-done" className="border-t border-rule bg-ok-soft px-4 py-2.5 text-sm text-ok sm:px-5">
          {done}
        </p>
      )}

      {preview && groups && (
        <div className="space-y-6 border-t border-rule bg-paper p-4 text-sm sm:px-5" data-testid="consent-preview">
          <p className="text-ink">
            <strong className="font-medium">{preview.label}:</strong> {preview.apps.length} {preview.apps.length === 1 ? "app" : "apps"} from{" "}
            {preview.grants} consent {preview.grants === 1 ? "grant" : "grants"}, given by {preview.users} {preview.users === 1 ? "user" : "users"}.
            {preview.agentColumn && " The export's \"By an agent\" column is shown below."}
          </p>
          {preview.warnings.map((w) => (
            <p key={w} role="status" className="rounded-[var(--radius-control)] border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
              {w}
            </p>
          ))}
          {(
            [
              { key: "known", title: "Known AI", hint: "Matched against crownguard's curated list of AI tools, each with the vendor's own page.", apps: groups.known },
              { key: "high", title: "High-reach, not known AI", hint: "Not on the AI list, but holding mail, files, calendar or meeting permissions: worth a look whatever it is.", apps: groups.highReach },
              { key: "other", title: "Other", hint: "Everything else in the export. Low-reach, but still worth knowing about.", apps: groups.other },
            ] as { key: string; title: string; hint: string; apps: FoundApp[] }[]
          ).map(({ key, title, hint, apps }) =>
            apps.length ? (
              <div key={key} data-testid={`found-group-${key}`}>
                <h3 className="font-sans text-base font-semibold tracking-normal">
                  {title} <span className="font-mono text-xs font-normal tabular-nums text-muted">{apps.length}</span>
                </h3>
                <p className="mt-0.5 text-xs text-muted">{hint}</p>
                <ul className="mt-2 space-y-2">
                  {apps.map((app) => (
                    <li key={app.clientId} className="rounded-[var(--radius-control)] border border-rule bg-surface px-4 py-3" data-testid="found-app" data-app={app.name}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">{app.name}</span>
                        {app.category && <span className="mono-label rounded-[4px] bg-accent-soft px-1.5 py-0.5 text-accent">{categoryLabel(app.category)}</span>}
                        {app.byAgent && (
                          <span className="mono-label rounded-[4px] bg-warn-soft px-1.5 py-0.5 text-warn" data-testid="by-agent">
                            By an agent
                          </span>
                        )}
                        {added.has(app.name) && (
                          <span className="mono-label rounded-[4px] bg-ok-soft px-1.5 py-0.5 text-ok" data-testid="found-added">
                            In the AI register
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {app.publisher ? `${app.publisher} · ` : ""}
                        {consentText(app)}
                        {app.byAgent === false && " · granted by people, not by an agent"}
                      </p>
                      {app.category && <p className="mt-1 text-xs text-muted">{app.matchedBy}</p>}
                      {app.scopeSummary.length > 0 && (
                        <ul className="mt-2 space-y-0.5 text-ink-2" aria-label={`What ${app.name} can do`}>
                          {app.scopeSummary.map((s) => (
                            <li key={s}>· {s}</li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          data-testid="add-to-register"
                          aria-label={`Add to AI register: ${app.name}`}
                          disabled={added.has(app.name)}
                          onClick={() => add(app)}
                        >
                          {added.has(app.name) ? "Added to the AI register" : "Add to AI register"}
                        </Button>
                        <span className="font-mono text-[0.6875rem] text-muted">{app.scopes.length} permissions</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
          <p className="text-xs text-muted">
            Nothing here answers a readiness question. Adding an app creates a register entry with its product, access and data handled filled in;
            everything else is yours to fill in and answer.
          </p>
        </div>
      )}
    </section>
  );
}

/** The export steps, including the two PowerShell commands and the least-privileged role that can run them. */
function ExportHow() {
  return (
    <details className="border-t border-rule px-4 py-3 text-sm sm:px-5" id="found-apps-how" data-testid="consent-how">
      <summary className="cursor-pointer text-ink-2 transition-colors [@media(hover:hover)]:hover:text-ink">How to export the list</summary>
      <div className="mt-3 max-w-[72ch] space-y-4 leading-relaxed text-ink-2">
        <div>
          <p className="font-medium text-ink">Microsoft Entra ID</p>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5">
            <li>
              Give your own account the <strong className="font-medium text-ink">Global Reader</strong> role — the least-privileged role that can read
              every app&apos;s consents. Nothing here changes the tenant.
            </li>
            <li>
              In PowerShell with the Microsoft Graph module signed in (<span className={mono}>Connect-MgGraph -Scopes &quot;Directory.Read.All&quot;</span>),
              export the consent grants and the apps behind them:
              <pre className={`${mono} mt-1.5 overflow-x-auto whitespace-pre`}>{GRANTS_CMD}</pre>
              <pre className={`${mono} mt-1.5 overflow-x-auto whitespace-pre`}>{SERVICE_PRINCIPALS_CMD}</pre>
            </li>
            <li>
              Pick both JSON files here together (crownguard joins the grants to their app names). One file containing both arrays works too —
              PowerShell writes either a bare array or <span className={mono}>{"{ \"value\": [...] }"}</span> depending on the version.
            </li>
          </ol>
          <p className="mt-1.5 text-xs text-muted">
            What the file holds: each grant&apos;s <span className={mono}>clientId</span>, <span className={mono}>consentType</span> (AllPrincipals or
            Principal), <span className={mono}>scope</span>, and each app&apos;s display name, publisher and{" "}
            <span className={mono}>appOwnerOrganizationId</span>.{" "}
            <a className={link} href="https://learn.microsoft.com/en-us/graph/api/resources/oauth2permissiongrant" target="_blank" rel="noreferrer noopener">
              Microsoft Graph consent grants
            </a>
          </p>
        </div>
        <div>
          <p className="font-medium text-ink">Google Workspace</p>
          <ol className="mt-1.5 list-decimal space-y-1.5 pl-5">
            <li>Sign in to the Admin console and open Reporting &gt; Audit and investigation &gt; OAuth log events.</li>
            <li>
              Add the Application name, Application ID, Scope, Event and User columns, and the newer <strong className="font-medium text-ink">By an
              agent</strong> and Agent info columns where they&apos;re offered, then pick your date range and export the CSV.
            </li>
            <li>Pick the CSV here.</li>
          </ol>
          <p className="mt-1.5 text-xs text-muted">
            <a className={link} href="https://support.google.com/a/answer/6124308" target="_blank" rel="noreferrer noopener">
              Google: OAuth log events
            </a>
          </p>
        </div>
      </div>
    </details>
  );
}


