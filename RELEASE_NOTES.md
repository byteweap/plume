# Plume 1.0.0-rc.1

This is the first Plume 1.0 release candidate. It is intended for validation on disposable or non-production PostgreSQL environments before the stable 1.0 release.

## Highlights

- Direct PostgreSQL 14+ connections with SSL, SSH tunnels, jump hosts, and operating-system credential storage.
- pgAdmin-style lazy object navigation across servers, databases, schemas, and database objects.
- SQL editing, completion, multi-statement execution, cancellation, diagnostics, history, and safe session recovery.
- Virtualized query results with bounded retention, selection copying, and cancellable CSV or JSON exports.
- Transactional table-data inserts, edits, deletes, previews, rollback, and leave protection.
- Persistent environment indicators and strengthened confirmation for high-risk production SQL.
- English and Simplified Chinese interfaces with keyboard-accessible workflows.

## Candidate Platforms

- macOS 13 or newer: universal Apple Silicon and Intel DMG, published as an unsigned GitHub pre-release candidate.
- Windows 10 or 11 x64: MSI and current-user NSIS installers, published as an unsigned GitHub pre-release candidate.

The release workflow publishes this note only after both platform jobs verify package structure and installer behavior. `SHA256SUMS` accompanies the three installers.

## Validation Scope

The source gate covers TypeScript, ESLint, frontend and Rust tests, AC-01 through AC-10, production builds, security boundaries, bilingual catalogs, release metadata, and platform packaging configuration. PostgreSQL integration CI covers versions 14, 16, and 18, including TLS and SSH paths.

Before promoting this candidate to 1.0, maintainers must complete the target-device checks in [the release candidate runbook](docs/release-candidate.md), including clean install, upgrade, uninstall, cold start, stable memory, and online dependency review. Signed macOS and Windows workflows remain available separately if code signing becomes possible later.

## Known Scope Limits

- Linux packages and automatic updates are not included in 1.0.
- Cloud IAM authentication and `EXPLAIN` visualization are deferred.
- The browser-only development build cannot run privileged database commands; use the desktop application for database validation.

Report security issues through [private vulnerability reporting](SECURITY.md). Report other candidate defects through the public issue tracker with the operating system, Plume version, PostgreSQL version, and reproduction steps.
