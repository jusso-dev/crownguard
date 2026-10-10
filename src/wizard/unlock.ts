import type { Assessment } from "../engine/types";
import { questionIdSet } from "../content/questionIds";
import { decrypt, isEncryptedEnvelope } from "./crypto";
import { parseAssessment } from "./parseAssessment";
import { dropProgress, readProgress, STORAGE_KEY } from "./persistence";
import { getLockedEnvelope, setLockedEnvelope, setSessionPassphrase } from "./sessionSecrets";
import { migrateProgress, modeOf, clampStep, useStore } from "./store";

export type UnlockResult = { ok: true; assessment: Assessment } | { ok: false; error: string };

/**
 * Decrypt locked (or on-disk encrypted) progress with the passphrase, load it into the store, and keep the
 * passphrase in memory for this visit so further writes stay encrypted.
 */
export async function unlockProgress(passphrase: string): Promise<UnlockResult> {
  const raw = getLockedEnvelope() ?? readProgress(STORAGE_KEY);
  if (!raw) return { ok: false, error: "No encrypted progress found in this browser." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Encrypted progress in this browser is damaged." };
  }
  if (!isEncryptedEnvelope(parsed)) return { ok: false, error: "Progress in this browser is not encrypted." };

  let plain: string;
  try {
    plain = await decrypt(parsed, passphrase);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Wrong passphrase, or the encrypted data is damaged." };
  }

  let stored: { state?: { assessment?: Assessment }; version?: number };
  try {
    stored = JSON.parse(plain) as { state?: { assessment?: Assessment }; version?: number };
  } catch {
    return { ok: false, error: "Encrypted progress could not be read after decrypting." };
  }

  const assessment = stored.state?.assessment;
  if (!assessment) return { ok: false, error: "Encrypted progress had no assessment." };

  const result = parseAssessment(assessment, { questionIds: questionIdSet() });
  if (result.kind === "error") {
    return { ok: false, error: `Encrypted progress couldn't be read (${result.issues[0] ?? result.message}).` };
  }
  if (result.kind === "newer" || !result.assessment) {
    return { ok: false, error: "Encrypted progress was saved by a newer crownguard and can't be unlocked here. Reload to update, then try again." };
  }

  setSessionPassphrase(passphrase);
  setLockedEnvelope(null);
  const loaded = result.assessment;
  const mode = modeOf(loaded);
  const progress = migrateProgress(loaded.progress ?? { step: 0 }, mode)!;
  useStore.getState().load({ ...loaded, progress: { ...progress, step: clampStep(progress.step, mode) } });
  return { ok: true, assessment: useStore.getState().assessment };
}

/** Drop encrypted progress from this browser without unlocking it. */
export function forgetLockedProgress() {
  dropProgress(STORAGE_KEY);
  setLockedEnvelope(null);
  setSessionPassphrase(null);
  useStore.getState().reset();
}
