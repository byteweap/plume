# Security Policy

## Supported Versions

Plume has not published a stable 1.0 release yet. Security fixes currently target the latest commit on the default branch and the newest published pre-release, if one exists. After 1.0, this table will identify supported release lines explicitly.

| Version | Supported |
|---|---|
| Default branch / latest pre-release | Yes |
| Older development snapshots | No |

## Reporting A Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/byteweap/plume/security/advisories/new). Do not open a public issue, discussion, or pull request for a suspected vulnerability.

Include enough information to reproduce and assess the report safely:

- affected Plume version or commit and operating system;
- vulnerability class and realistic impact;
- minimal reproduction steps or proof of concept;
- whether credentials, local files, database contents, or remote systems are exposed;
- suggested remediation, if available.

Remove real credentials, private keys, personal data, and production database content. Use synthetic values and a disposable database.

Maintainers aim to acknowledge a complete report within three business days, provide an initial assessment within ten business days, and coordinate remediation and disclosure based on severity. These are response targets, not guarantees. Please allow a reasonable remediation window before disclosure.

## Scope

Security-sensitive areas include:

- system credential storage and connection-profile persistence;
- TLS and SSH validation, host keys, certificates, and jump hosts;
- SQL execution, cancellation, risk confirmation, and replay protection;
- IPC capabilities and webview content security policy;
- diagnostic redaction and crash reporting;
- local history, drafts, session recovery, and data clearing;
- CSV/JSON export paths, temporary files, atomic replacement, and cancellation;
- dependency, build, installer, signing, and update supply chains.

Issues that require physical access to an already-unlocked user session, unsupported operating systems, or social engineering without a product defect may be out of scope, but can still be reported privately when impact is unclear.

## Disclosure And Credit

Plume follows coordinated disclosure. Maintainers will confirm the affected versions, prepare tests and a fix, and publish an advisory when users can take protective action. Reporter credit is offered unless anonymity is requested or disclosure was harmful or premature.

For non-security bugs, use the public [issue tracker](https://github.com/byteweap/plume/issues).
