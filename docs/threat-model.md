# Threat model

crownguard is a browser-only assessment wizard. Assessment data must never be sent anywhere. This note covers what is stored where, who could read it, and which controls address each risk. It does **not** claim to stop a compromised device or a malicious browser extension.

## What is stored where

| Data | Where | Lifetime |
|---|---|---|
| Assessment (org, jewels, answers, notes, branding, …) | `localStorage` key `crownguard:v1`, unless no-persistence mode is on | Until cleared, or until the origin's storage is wiped |
| Assessment (no-persistence mode) | In-memory only (zustand + a session Map). Not `sessionStorage`. | Lost on reload or tab close |
| No-persistence choice | `localStorage` key `crownguard:v1:ephemeral` (`"1"`) | Survives reload; does **not** hold assessment data |
| Optional passphrase | JavaScript memory only | Lost on reload; user must enter it again |
| Encrypted progress | Same `crownguard:v1` key, but the value is only the encryption envelope | Until unlocked or removed |
| Saved `.crownguard.json` | User-chosen file (download or File System Access API) | Wherever the user puts it; optional envelope encryption |
| Unreadable backup | `crownguard:v1:unreadable` | Until downloaded or cleared |

Nothing is posted to a server. The privacy e2e suite asserts no cross-origin requests during a journey.

## Who can read it

| Actor | What they can do | Control |
|---|---|---|
| Other sites on the same origin (e.g. every GitHub Pages site under `jusso-dev.github.io`) | Read and write `localStorage` for that origin | Dedicated origin (recommended; **not configured yet** — no custom domain chosen). Optional passphrase (envelope only on disk). No-persistence mode. Save file + open elsewhere. |
| Someone with the unlocked browser profile | Read plain `localStorage`, or prompt for / observe a typed passphrase | Passphrase (at rest). No-persistence. Remove from this browser. |
| Someone with the device and disk access | Read browser profile files, including plain or encrypted blobs | Passphrase raises the bar for the blob; full-disk encryption and OS accounts are outside crownguard |
| Browser extension with storage or page access | Read `localStorage`, page memory, or keystrokes | **Not solved.** Documented limitation. Prefer a dedicated profile / no extensions for sensitive work |
| Compromised or malicious crownguard build | Exfiltrate whatever the user enters | **Not solved** by app features. Supply-chain and hosting integrity (CI, Pages, self-host headers) |
| XSS in the app | Run script as the origin, read storage and memory | Strict CSP (`script-src 'self'`, `require-trusted-types-for 'script'`, no `object-src`, …), no `innerHTML` / `eval` in `src/` |
| Cross-site framing / opener attacks | Embed or navigate tricks | `frame-ancestors 'none'` (header), `Cross-Origin-Opener-Policy: same-origin` |

## Controls (summary)

1. **Stay on-device.** No backend, no analytics, no accounts.
2. **Optional passphrase.** PBKDF2-SHA-256 (600 000 iterations) + AES-GCM via WebCrypto. Envelope `{ crownguardEncrypted: 1, kdf, iterations, salt, iv, ciphertext }`. Key/passphrase in memory only. No recovery.
3. **No-persistence mode.** Assessment never written to `localStorage` / `sessionStorage`; only the mode flag may remain. `beforeunload` when there is unsaved in-memory work.
4. **Remove from this browser.** Clears the storage key and drops the in-memory assessment immediately.
5. **CSP + Trusted Types.** Production meta/header policy includes `require-trusted-types-for 'script'`. See [self-hosting.md](./self-hosting.md).
6. **Dedicated origin (recommended, unmet).** Until a custom domain is chosen, production remains on the shared GitHub Pages origin. Builds may set `VITE_CANONICAL_ORIGIN` so the legacy origin shows a “save a file, then open the new address” banner; origins cannot read each other’s storage.

## Out of scope

- Accounts, sync, or server-side storage.
- Stopping a malicious extension or a fully compromised endpoint.
- Recovering a forgotten passphrase.
