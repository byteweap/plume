# Windows Release

Plume ships x64 installers for Windows 10 and Windows 11. The signed workflow produces both an MSI package and a current-user NSIS installer, signs the application and installers with SHA-256 Authenticode signatures, and uses an RFC 3161 timestamp so signatures remain valid after certificate expiry. The default 1.0 candidate workflow publishes unsigned installers when no code-signing certificate is available.

## Signing Inputs

Configure these encrypted repository secrets before manually running `Windows Signed Release` if you want signed installers:

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE` | Base64-encoded code-signing `.pfx` certificate and private key |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password used when exporting the `.pfx` |

The workflow writes the PFX only to the runner's temporary directory, imports it into the current-user certificate store, deletes the temporary PFX, and removes the imported certificate in an `always()` cleanup step. The PFX, password, private key, and certificate thumbprint must not be committed or supplied as workflow inputs.

## Installer Policy

- Both application binaries and installers use SHA-256 Authenticode signatures and DigiCert's RFC 3161 timestamp service.
- The stable MSI UpgradeCode is `1c64b784-fd98-59b4-92b3-68887bd545e9`; it must not change when the product name or release workflow changes.
- Downgrades are rejected to avoid replacing a newer local-data schema with older application code.
- NSIS installs for the current user without requiring elevation and follows the operating-system language for English or Simplified Chinese.
- MSI remains available for managed deployment.
- The WebView2 bootstrapper runs silently only when the required runtime is missing.

## Build And Verification

Run the configuration check on any platform:

```bash
npm run check:release:windows
```

The signed workflow verifies the compiled application, MSI, and NSIS signatures with Windows Authenticode APIs. Each artifact must have a valid signer certificate and a trusted timestamp. It then performs clean silent install/uninstall cycles for NSIS and MSI and uploads both verified installers as a 14-day artifact. The unsigned candidate workflow keeps the same install/uninstall checks but skips the signature assertions.

The certificate thumbprint is derived from the imported PFX at runtime and passed to Tauri as an ephemeral config override. This keeps machine-specific certificate selection out of the committed Tauri configuration.

## Local Unsigned Build

On Windows, repository configuration and installer generation can be tested without signing credentials:

```powershell
npm run tauri build -- --bundles msi,nsis --ci --no-sign
```

An unsigned installer can satisfy the current GitHub pre-release gate. For a 1.0 candidate tag, the coordinated workflow waits for the unsigned MSI and NSIS artifacts and the unsigned macOS artifact before creating a GitHub pre-release.

## External Gate

Repository-side release configuration is complete when configuration checks and the existing unsigned Windows CI build pass. P0-J07 is fully signed only after a maintainer supplies a trusted code-signing certificate, runs `Windows Signed Release`, and receives passing Authenticode and install/uninstall checks. P0-J10 additionally requires the [release candidate runbook](release-candidate.md). Certificate issuance, reputation, and timestamp-service availability are external prerequisites for signed releases only.
