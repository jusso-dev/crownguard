# crownguard desktop

The same crownguard wizard as the web app, packaged as a desktop app for macOS, Windows and Linux with
[Tauri v2](https://v2.tauri.app/). It runs the full assessment and generates the PDF report with no network access.
Assessments are kept in local files and a local SQLite database, not in browser storage. Nothing leaves the device
unless you turn on the optional update check.

## Install

Download the installer for your system from the
[GitHub releases](https://github.com/jusso-dev/crownguard/releases) whose tag starts with `desktop-v`:

| System | File | Notes |
|---|---|---|
| macOS 11 or later (Apple silicon and Intel) | `crownguard_<version>_universal.dmg` | Signed and notarised. Drag crownguard to Applications. |
| Windows 10 or 11 | `crownguard_<version>_x64_en-US.msi` or `crownguard_<version>_x64-setup.exe` | Authenticode signed. The MSI suits managed deployment (Intune, Group Policy). |
| Linux (x86-64) | `crownguard_<version>_amd64.AppImage` or `crownguard_<version>_amd64.deb` | Each has a detached `.asc` GPG signature. Needs WebKitGTK 4.1. |

Check a download before you install it:

```sh
sha256sum --check --ignore-missing SHA256SUMS            # every file is listed in SHA256SUMS
gh attestation verify crownguard_<version>_amd64.deb --repo jusso-dev/crownguard
gpg --verify crownguard_<version>_amd64.deb.asc crownguard_<version>_amd64.deb   # Linux packages
```

To build it yourself you need Node 22, pnpm, stable Rust and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your system:

```sh
pnpm install
pnpm tauri:dev     # the app, with the Vite dev server on localhost:1420
pnpm tauri:build   # installers in src-tauri/target/release/bundle/ (unsigned unless signing is set up)
```

## Where your data lives

| What | Where |
|---|---|
| Autosaved progress, the list of recent files and the update setting | `crownguard.db` (SQLite) in the app data folder |
| Saved assessments | `.crownguard.json` files wherever you save them |
| PDF, XLSX and CSV exports | Wherever you save them |

The app data folder is:

- macOS: `~/Library/Application Support/io.github.jusso-dev.crownguard/`
- Windows: `%APPDATA%\io.github.jusso-dev.crownguard\`
- Linux: `~/.local/share/io.github.jusso-dev.crownguard/`

With a passphrase set, the autosaved copy in SQLite and every file you save are only the encryption envelope; the
recent-files list records that a file is encrypted and nothing else about it. **Remove from this device** deletes the
autosaved copy from the database. Uninstalling the app leaves the app data folder in place; delete it to remove
everything.

## Offline guarantees

- No analytics, crash reporting, accounts or remote fonts. Fonts, question content and the PDF engine are all inside
  the app.
- The webview's Content Security Policy only lets it talk to the app itself (`connect-src 'self' ipc:
  http://ipc.localhost`), so even a bug in the app can't make it fetch anything from the network.
- The app has no HTTP or shell plugin. Links to vendor guidance open in your web browser only after you confirm each
  one, and only `https://` links can be opened.
- The only thing that can reach the network is the update check, which is **off** until you turn it on under
  **This device** at the foot of the window. Even then it only connects when you choose **Check for updates**, it only
  talks to GitHub Releases, and it only installs an update signed with crownguard's update key.

[offline-test.md](offline-test.md) is the script used to check this on each operating system before a release.

## Saving and opening files

- **Save file** (Ctrl/⌘ S) asks where to save the first time, then saves back to the same file. Opening a file makes
  that file the one Save writes to.
- **Open file** uses the system's open dialog. Files saved by the web app at https://jusso-dev.github.io/crownguard/
  open in the desktop app, and files saved by the desktop app open in the web app: it is the same format
  ([file-format.md](../file-format.md)).
- The app registers itself for `.crownguard.json` files. On Linux, double-clicking one opens it in crownguard. macOS
  and Windows only look at the last part of a file name (`.json`), so there use **Open With → crownguard**, drag the
  file onto the app, or use **Open file**.
- **This device** at the foot of the window lists recent files. The list is only a shortcut: it opens the system's
  open dialog at that file, so the app never reads a file you haven't picked.

## Backing up assessments

Your assessments are only as safe as the files you keep:

1. Use **Save file** for every assessment you want to keep, and keep the `.crownguard.json` files somewhere that is
   backed up (a synced folder, a network share or your usual backup).
2. Autosave is a convenience for picking up where you left off, not a backup. To copy it anyway, quit crownguard and
   copy `crownguard.db` from the app data folder.
3. If you protect an assessment with a passphrase, store the passphrase in your password manager. There is no
   recovery without it.

## More

- [security.md](security.md): the desktop threat model and the controls behind the guarantees above.
- [release.md](release.md): how signed releases are built, and the secrets they need.
- [offline-test.md](offline-test.md): the manual offline test.
