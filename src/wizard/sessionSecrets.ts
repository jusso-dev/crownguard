/**
 * In-memory only: the optional passphrase and a locked encrypted blob waiting to be unlocked.
 * Never written to localStorage. Lost on reload (user must enter the passphrase again).
 */

let passphrase: string | null = null;
let lockedRaw: string | null = null;

export function setSessionPassphrase(value: string | null) {
  passphrase = value && value.length > 0 ? value : null;
}

export function getSessionPassphrase(): string | null {
  return passphrase;
}

export function hasSessionPassphrase(): boolean {
  return passphrase !== null;
}

/** Raw localStorage value of an encrypted progress blob that could not be opened yet. */
export function setLockedEnvelope(raw: string | null) {
  lockedRaw = raw;
}

export function getLockedEnvelope(): string | null {
  return lockedRaw;
}

export function hasLockedEnvelope(): boolean {
  return lockedRaw !== null;
}
