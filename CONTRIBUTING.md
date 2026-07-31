# Contributing To Plume

Plume welcomes focused bug fixes, tests, documentation improvements, accessibility work, and features aligned with the [product requirements](docs/产品需求文档.md) and [task breakdown](docs/开发任务分解.md).

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), never through a public issue or pull request.

## Before You Start

Search [existing issues](https://github.com/byteweap/plume/issues) before opening a new one. For a material feature or architectural change, open an issue first so scope and product behavior can be agreed before implementation. Small fixes and documentation corrections can go directly to a pull request.

Do not include database credentials, connection URLs, private keys, production data, signing certificates, generated test fixtures, or build outputs in issues, commits, screenshots, or logs.

## Development Workflow

1. Fork the repository and create a focused branch from the current default branch.
2. Follow [BUILDING.md](BUILDING.md) to install prerequisites and dependencies.
3. Keep changes within the boundaries described in the [architecture guide](docs/architecture.md) and accepted [ADRs](docs/adr/README.md).
4. Add tests in proportion to behavioral risk. Database protocol, cancellation, TLS, SSH, or transaction changes need real PostgreSQL integration coverage.
5. Keep English and Simplified Chinese user-facing strings synchronized through the typed localization catalog.
6. Run `npm run check:all`. Run the PostgreSQL integration suite when backend or database behavior changes.
7. Use a conventional commit subject such as `fix(query): preserve cancellation state`.

## Pull Requests

Keep each pull request reviewable and limited to one coherent outcome. The description should state:

- the user-visible or engineering problem;
- the chosen behavior and important tradeoffs;
- tests and manual verification performed;
- security, persistence, migration, performance, or compatibility impact;
- screenshots for meaningful UI changes in both relevant themes or languages.

Do not weaken tests, security checks, result limits, redaction, signing gates, or platform coverage merely to make CI pass. Explain intentionally deferred work and link a follow-up issue.

Maintainers may ask for a change to be split, an ADR to be added, or compatibility evidence on macOS and Windows. A pull request is ready to merge only when required checks pass and review comments are resolved.

## Style And Boundaries

- React owns presentation and local UI state; privileged database, credential, persistence, and file operations remain in Rust behind typed commands.
- Preserve stable command error codes and redact secrets before logs or IPC serialization.
- Parameterize values and quote PostgreSQL identifiers through the established helpers.
- Do not automatically replay SQL or writes after reconnect, restore, or retry.
- Keep dependencies narrow and update `THIRD_PARTY_NOTICES.md` when direct runtime dependencies change.
- Prefer existing components, design tokens, and interaction patterns over parallel abstractions.

## Documentation And Releases

Update README or architecture documentation when behavior, prerequisites, commands, or boundaries change. Release signing credentials are maintainer-operated secrets; contributors should use unsigned package builds from [BUILDING.md](BUILDING.md).

Contributions are licensed under the repository's [MIT License](LICENSE).
