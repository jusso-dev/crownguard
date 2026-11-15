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
crosses the mocked IPC bridge or reaches its in-memory file store once a passphrase is set. Browser tests do not
verify native filesystem permissions.

## Trust boundaries

1. **Webview to Rust (IPC).** The webview is treated as untrusted. It can call only the commands granted in
   `src-tauri/capabilities/default.json`.
2. **Frontend filesystem commands.** No static paths are granted, including app-data paths. Native single-file
   open/save dialogs grant each selected file at runtime. An OS-open file (double-click, Open With) is canonicalised
   and checked (a regular `.json` file, no larger than 32 MB) before native code grants its path. Grants last for the
   process, including previously selected files; they are not single-use or revoked on assessment changes. Recent
   paths are an index, not grants; reopening a recent file after restart asks the picker again. There are no static
   denies, so an explicitly selected destination inside app-data remains usable. Rust manages `crownguard.db`, its
   journal and `crownguard.lock` directly through std/rusqlite, outside plugin-fs scopes. This is not an OS sandbox.
3. **App to the network.** Nothing, except the optional update check run by the Rust updater plugin.

## Threats and controls

| Threat | Control |
|---|---|
| A bug or injected script in the webview reads files | No ambient frontend fs paths. Native dialogs and validated OS-open paths grant file access. `scripts/check-desktop-config.ts` requires the exact local main-window capability and command inventory, rejecting all static fs scopes and scoped fs command objects, including app-data allows and denies. |
| A bug or injected script sends data out | CSP `connect-src 'self' ipc: http://ipc.localhost`, no `http` or `shell` plugin, native opener scoped to generic `https://*` URLs in the default handler. Normal UI asks for confirmation; that frontend prompt is not a native authorisation boundary or a host restriction. Asset protocol disabled. |
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
| `recent_record` | absolute `.json` path, size cap | Index a file the user opened or saved. Contents are only summarised (and not at all when encrypted). |
| `launch_file_take` | none | Hand over a file the operating system asked the app to open. |
| `settings_get`, `settings_set_update_check` | boolean | The update setting. |
| `update_check`, `update_install` | refuses unless the setting is on and the build has an update key | The only network access. |

`recent_forget` remains declared in the native command manifest and registered, but has no capability grant or
frontend wrapper. `core:app:allow-version` is also ungranted. The deprecated `dialog:allow-ask` alias is removed;
JavaScript `ask()` still calls the native `message` command through retained `dialog:allow-message`.

The three retained fs permission IDs enable text reads, text writes and byte-buffer exports. The official
`fs:allow-write-file` bundle also enables native `open` and `write`; these remain subject to the same path scope.
Generic HTTPS support includes non-vendor hosts. Current guidance links mostly come from bundled content;
assessment notes and reference fields remain text, not arbitrary clickable links.

Pinned source evidence: Tauri 2.12.5, fs 2.7.1, dialog 2.8.4 and opener 2.7.2. Their cached crate archives were checked
against `Cargo.lock` checksums and source/permission files against archive bytes. Dialog `src/commands.rs` grants
selected files; fs `src/commands.rs` accepts runtime or static allows after checking denies; dialog
`permissions/ask.toml` aliases `message`; opener `src/scope.rs` restricts an omitted `app` to the default handler.
Source review and hosted compilation do not establish native picker/runtime behaviour. See the separate
[capability release checklist](offline-test.md#finding-9-native-capability-release-checklist).

## Out of scope

As for the web app: a compromised device or OS account, malware with access to the user's files, and a malicious build
of crownguard itself. Full-disk encryption and OS account controls protect `crownguard.db` at rest beyond the optional
passphrase.
