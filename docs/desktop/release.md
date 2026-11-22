# Desktop releases

`.github/workflows/desktop-release.yml` builds the desktop app when a tag matching `desktop-v*` is pushed, for
example `desktop-v1.0.0`. It never publishes anything: the result is a **draft** GitHub release for a maintainer to
check and publish by hand.

## What a release run produces

| Job | Output |
|---|---|
| build (macos) | Universal `.dmg` and `.app` (Apple silicon and Intel), signed with a Developer ID certificate and notarised. Checked with `codesign --verify`, `spctl -a -vv` and `xcrun stapler validate`. |
| build (windows) | `.msi` (WiX) and `-setup.exe` (NSIS), Authenticode signed with a SHA-256 digest and timestamp. Checked with `signtool verify /pa`. |
| build (linux) | `.AppImage` and `.deb`. |
| all builds | Updater bundles and their signatures, and `latest.json` for the updater, when the updater key is configured. |
| checksums and provenance | Detached GPG signatures (`.asc`) for the Linux packages, `SHA256SUMS` over every asset, and a build provenance attestation (`actions/attest-build-provenance`) for every file in `SHA256SUMS`. |

The version comes from the tag (`desktop-v1.2.3` builds 1.2.3). A tag with a prerelease part, such as
`desktop-v0.0.0-rc1`, is marked as a prerelease. MSI versions must be numeric, so the WiX version drops the suffix.

## Secrets

Signing material comes from repository secrets only, and none of it is committed. Add these under **Settings →
Secrets and variables → Actions**:

| Secret | Used for |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | The updater's minisign private key (from `pnpm tauri signer generate`). Signs update bundles. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Its password. |
| `TAURI_UPDATER_PUBKEY` | The matching public key, built into release apps so they only accept updates signed with the private key. |
| `APPLE_CERTIFICATE` | Developer ID Application certificate and key, as a base64 `.p12`. |
| `APPLE_CERTIFICATE_PASSWORD` | The `.p12` password. |
| `APPLE_SIGNING_IDENTITY` | The identity name, e.g. `Developer ID Application: Example Pty Ltd (TEAMID)`. |
| `APPLE_ID` | Apple ID used for notarisation. |
| `APPLE_PASSWORD` | An app-specific password for that Apple ID. |
| `APPLE_TEAM_ID` | The Apple Developer team ID. |
| `WINDOWS_CERTIFICATE` | Authenticode code-signing certificate and key, as a base64 `.pfx`. |
| `WINDOWS_CERTIFICATE_PASSWORD` | The `.pfx` password. |
| `LINUX_GPG_PRIVATE_KEY` | ASCII-armoured GPG private key for the detached Linux signatures. Publish the public key so users can verify. |
| `LINUX_GPG_PASSPHRASE` | Its passphrase. |

Keep the updater private key safe: if it is lost, installed apps can't accept any future update and users must
reinstall by hand. Rotating it needs a release signed with the old key that ships the new public key.

A release tag (no hyphen) fails before building if any platform's signing secrets or the updater key are missing.
A prerelease tag builds without them, unsigned, as a dry run of the pipeline, with a warning on each job.

## Dry run

Before the first real release, check the pipeline end to end:

```sh
git tag desktop-v0.0.0-rc1
git push origin desktop-v0.0.0-rc1
```

The run should leave a draft prerelease with installers for all three systems, `SHA256SUMS` and an attestation. Delete
the draft release and the tag afterwards. Run [offline-test.md](offline-test.md) on each system with the installers
before publishing a real release.

## Publishing

1. Push `desktop-vX.Y.Z` from `main`.
2. When the run finishes, open the draft release, check every installer is there along with `SHA256SUMS`, the `.asc`
   files and `latest.json`.
3. Install on each system and run the [offline test](offline-test.md).
4. Publish the release. Installed apps with update checks turned on will find it through `latest.json`.

## Pull requests

The `desktop` job in `ci.yml` runs `pnpm tauri build --debug --bundles deb` on Linux, then `cargo clippy -D warnings`
and `cargo test`, so a change to the web app can't silently break the desktop build. `pnpm check:desktop` (in the
`check` job too) fails if a capability widens file access, adds the http or shell plugin, or the CSP drifts from
`vite.config.ts`.
