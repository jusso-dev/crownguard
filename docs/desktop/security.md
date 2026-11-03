# Desktop security and threat model

This extends the web [threat model](../threat-model.md) to the desktop app in `src-tauri/`. The desktop app runs the
same React code as the web app inside the operating system's webview (WKWebView on macOS, WebView2 on Windows,
WebKitGTK on Linux). The goals are the same: assessment data never leaves the device, and a mistake in the web code
can't widen what the app can reach.

## What is stored where

| Data | Where | Notes |
|---|---|---|
| Autosaved assessment | `autosave` table in `crownguard.db` (app data folder), key `crownguard:v1` | The same value the web app keeps in `localStorage`. With a passphrase it is only the encryption envelope. |
| No-persistence choice, unreadable backup | `autosave` table, keys `crownguard:v1:ephemeral`, `crownguard:v1:unreadable` | As on the web. |
| Assessments index | `assessments` table: id, org name, platforms, mode, encrypted flag, file path, updated time | Org name, platforms and mode are left empty for encrypted assessments. At most 50 files. |
| Update setting | `settings` table, `update_check` | Off unless the user turns it on. |
| Saved files and exports | Wherever the user saves them | Encrypted files are only the envelope. |
| Passphrase | Webview memory only | As on the web. |

The database uses `PRAGMA secure_delete = ON` and a rollback journal that is deleted on commit, so a value replaced by
its encrypted envelope does not linger in free pages. `db::tests::encrypted_assessments_never_reach_the_database_file_in_plaintext`
reads the database file byte for byte to check this, and `e2e/desktop.spec.ts` checks that nothing but the envelope
crosses the IPC bridge or reaches disk once a passphrase is set.

## Trust boundaries

1. **Webview to Rust (IPC).** The webview is treated as untrusted. It can call only the commands granted in
   `src-tauri/capabilities/default.json`.
2. **Rust to the file system.** File access is limited to the app data folder plus each file the user picks in a
   native open or save dialog (the dialog plugin adds that one path to the scope at run time). A file opened from the
   operating system (double-click, Open With) is checked (a `.json` file, a regular file, no larger than 32 MB) and
   added to the scope the same way.
3. **App to the network.** Nothing, except the optional update check run by the Rust updater plugin.

## Threats and controls

| Threat | Control |
|---|---|
| A bug or injected script in the webview reads files | No wildcard fs scope: only `$APPDATA` and user-picked paths. `scripts/check-desktop-config.ts` fails CI if a capability adds `$HOME`, a user folder, an absolute path or a bare wildcard. |
| A bug or injected script sends data out | CSP `connect-src 'self' ipc: http://ipc.localhost`, no `http` or `shell` plugin, opener limited to `https://` links after a confirmation dialog. Asset protocol disabled. |
| Script injection (XSS) | The web CSP ported to `app.security.csp`, including `require-trusted-types-for 'script'`; `freezePrototype: true` against prototype pollution; `withGlobalTauri: false` so the IPC API isn't on `window`; no `innerHTML` or `eval` in `src/`. |
| Two copies of the app overwrite each other's autosave | One copy per user owns the database: it holds an OS lock on `crownguard.lock` in the app data folder for its whole life. A second copy (on Windows and Linux a double-click while crownguard is open starts one) gets no database and its window says crownguard is already open. The database also waits up to five seconds for a busy lock instead of failing. |
| Recent-file summaries kept while the user asked for nothing to be kept | With "Don't keep this assessment on this device" on, opened and saved files are not added to the recent list. |
| Malformed input to custom commands | Every command checks its input: autosave keys must be one of four known keys, values are capped at 32 MB, recorded paths must be absolute `.json` paths without NUL bytes and under 4 KB. SQL uses bound parameters only. |
| Memory-safety bugs in app code | `unsafe_code = "forbid"` in `Cargo.toml`; clippy with `-D warnings` in CI. |
| Plaintext of an encrypted assessment at rest | Encryption happens in the webview before anything reaches IPC (unchanged `crypto.ts`); the index never stores the plaintext summary of an envelope; `secure_delete` (see above). |
| A malicious update | The updater is off by default, its commands refuse to run while the setting is off, and the plugin only installs packages signed with the minisign key whose public half is built into the release. A build without that key (local and PR builds) can't check for updates at all. |
| Tampered installers | macOS signed and notarised, Windows Authenticode signed, Linux packages with detached GPG signatures, SHA256SUMS and a build provenance attestation (see [release.md](release.md)). |
| Supply chain in CI | Third-party actions pinned to commit SHAs; signing material only in repository secrets; `dependency-review` checks npm and Cargo licences and advisories. |

## Custom commands

| Command | Input checks | Purpose |
|---|---|---|
| `autosave_load` | none | Load every autosave value at start-up. |
| `autosave_set`, `autosave_remove` | known key, size cap | Autosave writes. |
| `recent_list` | none | The recent-files list. |
| `recent_record`, `recent_forget` | absolute `.json` path, size cap | Index a file the user opened or saved. Contents are only summarised (and not at all when encrypted). |
| `launch_file_take` | none | Hand over a file the operating system asked the app to open. |
| `settings_get`, `settings_set_update_check` | boolean | The update setting. |
| `update_check`, `update_install` | refuses unless the setting is on and the build has an update key | The only network access. |

## Out of scope

As for the web app: a compromised device or OS account, malware with access to the user's files, and a malicious build
of crownguard itself. Full-disk encryption and OS account controls protect `crownguard.db` at rest beyond the optional
passphrase.
