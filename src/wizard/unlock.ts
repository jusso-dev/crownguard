import { allQuestionIds } from "../content/catalogue";
import type { Assessment } from "../format/schema";
import { decrypt, isEncryptedEnvelope } from "../format/crypto";
import { parseAssessment } from "../format/parse";
import { dropProgress, readProgress, STORAGE_KEY } from "./persistence";
import { getLockedEnvelope, setLockedEnvelope, setSessionPassphrase } from "./sessionSecrets";
import { useStore } from "./store";

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

  const result = parseAssessment(assessment, { questionIds: allQuestionIds });
  if (result.kind === "error") {
    return { ok: false, error: `Encrypted progress couldn't be read (${result.issues[0] ?? result.message}).` };
  }
  if (result.kind === "newer" || !result.assessment) {
    return { ok: false, error: "Encrypted progress was saved by a newer crownguard and can't be unlocked here. Reload to update, then try again." };
  }

  setSessionPassphrase(passphrase);
  setLockedEnvelope(null);
  useStore.getState().load(result.assessment);
  return { ok: true, assessment: useStore.getState().assessment };
}

/** Drop the assessment kept here, encrypted or not, with its passphrase, and start blank. */
export function forgetProgress() {
  setSessionPassphrase(null);
  setLockedEnvelope(null);
  // Reset first: resetting saves the blank assessment, and dropping afterwards leaves nothing behind.
  useStore.getState().reset();
  dropProgress(STORAGE_KEY);
}
