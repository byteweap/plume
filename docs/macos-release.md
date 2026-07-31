# macOS Release

Plume ships a universal macOS application for Apple Silicon and Intel Macs. The bundle identifier is `com.weapon.plume`, the deployment target is macOS 13.0, and release signatures use Apple's hardened runtime. The repository does not request additional macOS entitlements.

## Signing Inputs

The `macOS Signed Release` workflow is manual so an unsigned branch build cannot accidentally publish a release. Configure these encrypted repository secrets before running it:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` certificate and private key |
| `APPLE_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `APPLE_ID` | Apple developer account used by `notarytool` |
| `APPLE_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Ten-character Apple Developer Team ID |

Tauri imports the certificate into a temporary CI keychain and infers the signing identity from it. The certificate, private key, passwords, and Team ID must never be committed or placed in workflow inputs.

## Build And Verification

Run the configuration check on any platform:

```bash
npm run check:release:macos
```

The signed workflow installs both Rust macOS targets and builds `universal-apple-darwin` app and DMG bundles. It then runs:

```bash
npm run verify:release:macos -- --bundle-root src-tauri/target/universal-apple-darwin/release/bundle
```

Verification rejects a release unless all of these conditions hold:

- `Info.plist` contains the configured identifier, version, and macOS 13.0 deployment target.
- The executable contains both `arm64` and `x86_64` slices.
- The app has a valid Developer ID Application signature, Apple Team ID, and hardened-runtime flag.
- Gatekeeper accepts the app and DMG.
- Apple notarization tickets are stapled to both the app and DMG.
- The DMG passes `hdiutil verify` and code-signature verification.

The workflow uploads the verified `.app` and `.dmg` as a 14-day artifact. For a 1.0 candidate tag, the coordinated workflow waits for this artifact and the verified Windows installers before creating a GitHub pre-release.

## Local Unsigned Build

A local package can validate compilation, metadata, icons, and DMG generation without signing credentials:

```bash
CI=true npm run tauri build -- --bundles app,dmg --no-sign
```

The `CI` environment flag skips Finder-based DMG decoration, which makes this command repeatable in headless terminals. An unsigned build is for engineering checks only. It cannot satisfy the release gate, and the signed verification command intentionally rejects ad-hoc or unsigned artifacts.

## External Gate

Repository-side release configuration is complete when the local configuration and unsigned packaging checks pass. P0-J06 is fully verified only after a maintainer supplies valid Apple credentials, runs `macOS Signed Release`, and obtains a passing signed/notarized artifact. P0-J10 additionally requires the [release candidate runbook](release-candidate.md). Certificate issuance, Apple service availability, and account agreements are external prerequisites.
