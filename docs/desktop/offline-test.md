# Offline test

Run this on macOS, Windows and Linux with the installers from a draft release before publishing it, and attach the
filled-in results to the release pull request or draft. It checks the guarantees in [README.md](README.md) on the real
app; `e2e/desktop.spec.ts` checks the same behaviour in CI against the desktop build with the desktop CSP.

You need: the installer, `e2e/fixtures/m365-secure-scan.json`, `e2e/fixtures/prowler-aws.csv`,
`e2e/fixtures/ScubaResults.json`, and a `.crownguard.json` file saved by the web app at
https://jusso-dev.github.io/crownguard/.

## 1. Before you start

1. Install crownguard. Check the signature first:
   - macOS: `spctl -a -vv /Applications/crownguard.app` says `accepted` and `source=Notarized Developer ID`.
   - Windows: `signtool verify /pa crownguard_<version>_x64_en-US.msi` succeeds; the installer shows a verified
     publisher.
   - Linux: `gpg --verify crownguard_<version>_amd64.deb.asc crownguard_<version>_amd64.deb` reports a good
     signature.
2. Start a traffic monitor:
   - macOS: Little Snitch (or LuLu) in alert mode, with no rules for crownguard.
   - Windows: Windows Firewall with outbound connections blocked by default and logging on, or
     `pktmon start --capture` then `pktmon stop` and `pktmon etl2txt`.
   - Linux: `sudo tcpdump -i any -n 'not (host 127.0.0.1 or host ::1)' -w crownguard.pcap`.
3. Turn networking off at the OS level (Wi-Fi off and Ethernet unplugged, or airplane mode).

## 2. A full assessment with no network

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Open crownguard. | The start screen. No error. The status line says "on this device". | |
| 2 | Full crown-jewel assessment, organisation "Offline Test", choose **Microsoft 365**, add two crown jewels. | Each step loads. | |
| 3 | On Controls, import `m365-secure-scan.json` and apply. | "Imported … answers from the scan". | |
| 4 | Answer a few questions, go through SOC maturity, AI register (load example entries), Review, Branding (add a logo), Report. | Each step works. | |
| 5 | **Generate PDF report**. Save it. | A save dialog. The PDF opens and has the logo and every section. | |
| 6 | On the AI register step, **Download XLSX**. Save it. | A save dialog. The file opens in a spreadsheet app. | |
| 7 | Start a new assessment for **Google Workspace**; add a Gmail crown jewel; import `ScubaResults.json`; generate the PDF. | As above. | |
| 8 | Start a new assessment for **Amazon Web Services**; add "AWS data stores"; import `prowler-aws.csv`; generate the PDF. | As above. | |

## 3. Saving, opening and resuming

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | Open file, choose the web-saved `.crownguard.json`. | "Opened … Picking up at …". | |
| 2 | Change an answer, press Ctrl/⌘ S. | No dialog. "Saved to <file name>". The file on disk has the change. | |
| 3 | Open the saved file in the web app (Open file at jusso-dev.github.io/crownguard, with networking back on, in a separate check). | It opens with the change. | |
| 4 | Move to a Controls section part-way down. Quit crownguard (Cmd Q, or close the window). Open it again. | "Welcome back". Continue lands on the same step and section with answers intact. | |
| 5 | Set a passphrase, change an answer, quit. Run `sqlite3 <app data>/crownguard.db "select value from autosave"` and search the output and the database file for the organisation name (`grep -a "Offline Test" crownguard.db`). | Only the encrypted envelope (`crownguardEncrypted`), and no match for the name. | |
| 6 | Reopen crownguard, unlock with the passphrase. | The assessment loads. | |
| 7 | Linux only: double-click a `.crownguard.json` file in the file manager. | crownguard opens it. | |

## 4. No outbound connections

| # | Step | Expected | Result |
|---|---|---|---|
| 1 | With networking back **on** and the update setting **off** (the default), repeat section 2 steps 2 to 5. | The traffic monitor shows **no** connection attempts from crownguard. | |
| 2 | Click a vendor guidance link on a Controls question. | A confirmation dialog naming the link. Cancel opens nothing. Open launches the system browser (the browser's traffic, not crownguard's). | |
| 3 | Debug build only (`pnpm tauri build --debug`): open the web inspector (right-click → Inspect) and run `fetch("https://example.com")`. | Rejected, with a Content Security Policy error for `connect-src`. | |
| 4 | Turn on **Allow checking for updates** under **This device**, then **Check for updates**. | One HTTPS connection to `github.com` (and its release asset host). Nothing before the button is pressed. | |
| 5 | Turn the setting off again. | Check for updates disappears. | |

## Results

| System and version | Installer | Tester | Date | Sections passed | Notes |
|---|---|---|---|---|---|
| | | | | | |
