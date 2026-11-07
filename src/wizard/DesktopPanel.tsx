import { useEffect, useState } from "react";
import { Button } from "./ui";
import { relativeTime } from "./time";
import { desktopSettings, flushAutosave, type DesktopSettings } from "../platform/tauri";
import type { RecentAssessment } from "../platform/types";

/**
 * Desktop only: files recently opened or saved on this device, and the optional update check. Loaded lazily from the
 * footer; the web build never includes it.
 */
export default function DesktopPanel({ onOpenRecent }: { onOpenRecent: (path: string) => void }) {
  const [recent, setRecent] = useState<RecentAssessment[]>([]);
  const [settings, setSettings] = useState<DesktopSettings>();
  const [status, setStatus] = useState<string>();
  const [update, setUpdate] = useState<{ version: string }>();
  const [busy, setBusy] = useState(false);
  const [now] = useState(Date.now);

  useEffect(() => {
    desktopSettings.listRecent().then((r) => setRecent(r.filter((x) => x.filePath).slice(0, 8)), () => setRecent([]));
    desktopSettings.get().then(setSettings, () => setSettings(undefined));
  }, []);

  async function toggleUpdates(on: boolean) {
    await desktopSettings.setUpdateCheck(on);
    setSettings((s) => s && { ...s, updateCheck: on });
    setUpdate(undefined);
    setStatus(on ? "Update checks are on. crownguard only connects to GitHub when you choose Check for updates." : "Update checks are off. crownguard makes no network connections.");
  }

  async function check() {
    setBusy(true);
    setStatus("Checking GitHub Releases…");
    try {
      const found = await desktopSettings.checkForUpdate();
      setUpdate(found ?? undefined);
      setStatus(found ? `Version ${found.version} is available. It is verified against crownguard's signing key before it installs.` : "You have the latest version.");
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function install() {
    setBusy(true);
    setStatus("Downloading and verifying the update…");
    try {
      // The app restarts once the update is installed; let every autosave write land first.
      await flushAutosave();
      await desktopSettings.installUpdate();
    } catch (e) {
      setStatus(String(e instanceof Error ? e.message : e));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="desktop-heading" className="mx-auto mb-4 max-w-6xl space-y-3 border-b border-rule pb-4">
      <h2 id="desktop-heading" className="mono-label text-ink-2">
        This device
      </h2>
      {recent.length > 0 && (
        <div>
          <p className="text-ink-2">Recent files</p>
          <ul className="mt-1 space-y-1">
            {recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                <button type="button" className="font-medium text-accent underline decoration-accent/30 underline-offset-2" onClick={() => onOpenRecent(r.filePath!)}>
                  {r.encrypted ? "Encrypted assessment" : r.orgName || "Untitled assessment"}
                </button>
                <span className="font-mono">{r.filePath}</span>
                <span>· {relativeTime(r.updatedAt, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {settings && (
        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-3 text-ink-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.updateCheck}
              disabled={!settings.updateAvailableInBuild}
              onChange={(e) => void toggleUpdates(e.target.checked)}
            />
            <span>
              <span className="font-medium text-ink">Allow checking for updates</span>
              <span className="block">
                Off by default. When on, Check for updates asks GitHub Releases for a newer signed version. Nothing else
                ever connects to the network.
                {!settings.updateAvailableInBuild && " This build has no update signing key, so updates are unavailable."}
              </span>
            </span>
          </label>
          {settings.updateCheck && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy && !update} disabled={busy} onClick={() => void check()}>
                Check for updates
              </Button>
              {update && (
                <Button loading={busy} disabled={busy} onClick={() => void install()}>
                  Install {update.version} and restart
                </Button>
              )}
            </div>
          )}
          {status && <p role="status">{status}</p>}
        </div>
      )}
    </section>
  );
}
