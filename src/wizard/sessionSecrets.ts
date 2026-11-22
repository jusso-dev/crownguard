/**
 * In-memory only: the optional passphrase and a locked encrypted blob waiting to be unlocked.
 * Never written to autosave storage. Lost on reload (user must enter the passphrase again).
 */

let passphrase: string | null = null;
let lockedRaw: string | null = null;
const listeners = new Set<() => void>();
export function onPassphraseChange(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setSessionPassphrase(value: string | null) {
  const next = value && value.length > 0 ? value : null;
  if (next === passphrase) return;
  passphrase = next;
  for (const listener of listeners) listener();
}

export function getSessionPassphrase(): string | null {
  return passphrase;
}

export function hasSessionPassphrase(): boolean {
  return passphrase !== null;
}

/** Raw autosaved value of an encrypted progress blob that could not be opened yet. */
export function setLockedEnvelope(raw: string | null) {
  lockedRaw = raw;
}

export function getLockedEnvelope(): string | null {
  return lockedRaw;
}

export function hasLockedEnvelope(): boolean {
  return lockedRaw !== null;
}
