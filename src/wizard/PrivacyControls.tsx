import { useState, type FormEvent } from "react";
import { Button, Field, inputClass } from "./ui";
import { isEphemeralMode, setEphemeralMode } from "./persistence";
import { getSessionPassphrase, hasSessionPassphrase, setSessionPassphrase } from "./sessionSecrets";
import { useStore } from "./store";
import { unlockProgress } from "./unlock";

/** Touch the assessment so zustand persist rewrites (plain or encrypted) under the current session settings. */
export function repersist() {
  useStore.getState().update(() => ({}));
}

/** Passphrase fields: optional protection for browser progress and/or a saved file. */
export function PassphraseFields({
  idPrefix,
  onApplied,
}: {
  idPrefix: string;
  /** Called after a passphrase is set or cleared and storage has been asked to rewrite. */
  onApplied?: (protectedWithPassphrase: boolean) => void;
}) {
  const active = hasSessionPassphrase();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function apply(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pass.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (pass !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    setSessionPassphrase(pass);
    repersist();
    setPass("");
    setConfirm("");
    setOpen(false);
    onApplied?.(true);
  }

  function clearProtection() {
    if (!window.confirm("Remove passphrase protection? Progress in this browser will be stored as plain JSON again.")) return;
    setSessionPassphrase(null);
    repersist();
    setOpen(false);
    onApplied?.(false);
  }

  if (active && !open) {
    return (
      <div className="text-sm text-ink-2">
        <p>
          Protected with a passphrase. The key stays in memory only for this visit — you will need it again after a
          reload. There is <strong className="font-medium text-ink">no recovery</strong> if you forget it.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change passphrase
          </Button>
          <Button variant="ghost" onClick={clearProtection}>
            Remove protection
          </Button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Protect with a passphrase
        </Button>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Optional. Encrypts the copy kept in this browser and any file you save while the passphrase is set. There is no
          recovery if you forget it.
        </p>
      </div>
    );
  }

  return (
    <form className="space-y-3" onSubmit={apply}>
      <Field label="Passphrase" hint="At least 8 characters. Kept in memory only for this visit.">
        <input
          id={`${idPrefix}-pass`}
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          required
          minLength={8}
        />
      </Field>
      <Field label="Confirm passphrase">
        <input
          id={`${idPrefix}-confirm`}
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted">
        There is <strong className="font-medium text-ink-2">no recovery</strong> if you lose this passphrase. A wrong
        passphrase will not partially load the assessment.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Apply passphrase</Button>
        <Button
          variant="ghost"
          type="button"
          onClick={() => {
            setOpen(false);
            setPass("");
            setConfirm("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Toggle: don't keep the assessment in this browser (flag may remain; assessment must not). */
export function EphemeralToggle({
  onBeforeEnable,
  onChange,
}: {
  onBeforeEnable?: () => boolean;
  onChange?: (on: boolean) => void;
}) {
  const [on, setOn] = useState(isEphemeralMode);

  function toggle(next: boolean) {
    if (next) {
      if (
        !window.confirm(
          "Don't keep this assessment in this browser? Use Save file first if you want a copy. Reloading will lose the assessment. The choice itself is remembered.",
        )
      ) {
        return;
      }
      if (onBeforeEnable && !onBeforeEnable()) return;
    }
    setEphemeralMode(next);
    setOn(next);
    onChange?.(next);
    if (!next) repersist();
  }

  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-ink-2">
      <input
        type="checkbox"
        className="mt-1"
        checked={on}
        onChange={(e) => toggle(e.target.checked)}
      />
      <span>
        <span className="font-medium text-ink">Don&apos;t keep this assessment in this browser</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
          Progress stays in memory only. Reloading loses it. A small flag is kept so the choice survives a reload — the
          assessment is not. Save a file before you leave.
        </span>
      </span>
    </label>
  );
}

/** Unlock card when localStorage holds an envelope and no session passphrase is set. */
export function UnlockCard({
  onUnlocked,
  onForget,
}: {
  onUnlocked: () => void;
  onForget: () => void;
}) {
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await unlockProgress(pass);
      if (!result.ok) {
        setError(result.error);
        setPass("");
        return;
      }
      onUnlocked();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-4 max-w-xl overflow-hidden rounded-[var(--radius-card)] border border-rule bg-surface">
      <form className="p-7" onSubmit={(e) => void submit(e)}>
        <p className="mono-label text-accent">Protected</p>
        <h1 className="mt-2 text-[1.75rem] font-semibold leading-tight">Enter passphrase</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Progress in this browser is encrypted. Enter the passphrase to unlock it. A wrong passphrase will not load
          anything. There is no recovery if you have forgotten it.
        </p>
        <div className="mt-5">
          <Field label="Passphrase">
            <input
              id="unlock-pass"
              type="password"
              autoComplete="current-password"
              className={inputClass}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoFocus
              required
            />
          </Field>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Unlock
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={() => {
              if (window.confirm("Remove the encrypted progress from this browser? You will need a saved file to get it back.")) {
                onForget();
              }
            }}
          >
            Remove from this browser
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Shown only when built with VITE_CANONICAL_ORIGIN and still served from the shared Pages origin. */
export function LegacyOriginBanner() {
  const canonical = import.meta.env.VITE_CANONICAL_ORIGIN as string | undefined;
  if (!canonical) return null;
  if (typeof location === "undefined" || location.origin !== "https://jusso-dev.github.io") return null;
  return (
    <div role="status" className="border-b border-warn/20 bg-warn-soft px-4 py-2.5 text-sm text-warn sm:px-6">
      <div className="mx-auto max-w-6xl leading-relaxed">
        This address shares an origin with other sites on the same GitHub Pages account, so they can read progress
        stored here. Save a file, then open the assessment at{" "}
        <a className="font-medium underline decoration-warn/40 underline-offset-2" href={canonical}>
          {canonical}
        </a>
        . This page cannot read storage from the new address.
      </div>
    </div>
  );
}

/** Current passphrase if set — for encrypting a save without re-prompting. */
export { getSessionPassphrase, hasSessionPassphrase };
