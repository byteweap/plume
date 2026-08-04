<div align="center">

# Plume

**A clean, lightweight PostgreSQL desktop workspace.**

[English](README.md) · [简体中文](README.zh-CN.md)

![Project status](https://img.shields.io/badge/status-1.0%20RC-D97706)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![License](https://img.shields.io/badge/license-MIT-2F6D52)

</div>

Plume is a local-first PostgreSQL management tool built for developers who want a focused alternative to large, general-purpose database clients. The desktop application connects directly to PostgreSQL. There is no Plume account, cloud relay, or remote application server between you and your database.

> [!IMPORTANT]
> Plume 1.0.0-rc.1 is prepared as an unsigned GitHub pre-release candidate. The downloadable macOS and Windows installers are not code-signed, so operating systems may show trust warnings; stable signed installers are not published yet. See the [candidate notes](RELEASE_NOTES.md) and [release runbook](docs/release-candidate.md).

## Why Plume

- **PostgreSQL-native:** models servers, databases, roles, tablespaces, database collections, schemas, and schema objects instead of flattening everything into a generic database tree.
- **Lightweight by design:** Tauri and Rust own privileged and database work while React stays focused on presentation.
- **Local-first:** database traffic goes directly from the desktop process to PostgreSQL.
- **Lazy and responsive:** metadata is loaded only when a tree node is expanded; additional databases get clients on demand.
- **Explicit security boundaries:** passwords never return to React after connection setup and are never written to regular configuration files.
- **Bilingual foundation:** the interface currently supports English and Simplified Chinese.

## Available Today

- Saved PostgreSQL connection profiles with Keychain/Credential Manager secrets, SSL modes, SSH tunnels, jump hosts, and categorized connection errors.
- PostgreSQL 14, 16, and 18 integration coverage for connections, metadata, queries, cancellation, TLS, SSH, and transactional editing.
- In-memory server sessions with independent, on-demand clients for each database and pgAdmin-style server navigation:

```text
Server
├── Databases
│   └── Database
│       ├── Casts
│       ├── Catalogs
│       ├── Event Triggers
│       ├── Extensions
│       ├── Foreign Data Wrappers
│       ├── Languages
│       ├── Publications
│       ├── Schemas
│       │   └── Schema
│       │       ├── Tables / Foreign Tables
│       │       ├── Views / Materialized Views
│       │       ├── Sequences
│       │       ├── Functions / Procedures
│       │       └── Types
│       └── Subscriptions
├── Login/Group Roles
└── Tablespaces
```

- SQL editor with statement targeting, asynchronous completion, drafts, execution feedback, cancellation, diagnostics, history, and safety confirmations.
- Virtualized and typed query results with limits, copying, cancellable CSV/JSON exports, and atomic file writes.
- Table browsing with stable pagination, sorting and parameterized filters, plus staged inserts, edits, deletes, previews, transactional commits, rollback, and leave protection.
- Versioned local settings, query history, drafts, session snapshots, retention, recovery, and selective data clearing.
- English and Simplified Chinese UI catalogs, keyboard workflows, and light/dark themes.

## Roadmap

| Area | Status |
|---|---|
| 1.0 release candidate | Unsigned 1.0.0-rc.1 GitHub pre-release path prepared |
| macOS and Windows signed installers | Optional manual workflows are configured; external signing credentials required |
| `EXPLAIN` visualization | Post-1.0 candidate |
| Cloud IAM authentication, automatic updates, and Linux releases | Later candidates |

The detailed product scope is maintained in the [product requirements](docs/产品需求文档.md) and [development task breakdown](docs/开发任务分解.md), currently written in Chinese.

## Architecture

```text
React UI
  → feature API
  → typed Tauri adapter
  → Rust command boundary
  → PostgreSQL service and session registry
  → PostgreSQL
```

React never connects to PostgreSQL directly. Rust owns database sessions, TLS/SSH, metadata and data queries, cancellation, transactional writes, credential access, local persistence, and export file-system capabilities. Stable, serializable command errors form the contract between both sides.

See [Architecture](docs/architecture.md) for module boundaries, session lifecycle, SSL semantics, and testing strategy. A [Simplified Chinese version](docs/architecture.zh-CN.md) is also available.

## Getting Started

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- A current stable Rust toolchain
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system
- A reachable PostgreSQL 14+ instance for database integration work

Plume currently targets macOS and Windows. Linux packaging is not part of the first release target.

### Run the Desktop App

```bash
git clone https://github.com/byteweap/plume.git
cd plume
npm install
npm run tauri dev
```

For UI-only work, run the Vite frontend:

```bash
npm run dev
```

The browser build is useful for layout work, but privileged database commands intentionally return `desktop_required`. Database behavior must be tested through Tauri; Plume does not fake successful database operations in browser mode.

### Quality Checks

```bash
npm run check:all
```

`npm install` configures the repository-local Git hook. It runs the same check
before each commit. If the repository was cloned before this configuration was
introduced, run `npm run hooks:install` once.

Run the PostgreSQL integration suite against the disposable local environment:

```bash
npm run postgres:up
npm run test:postgres
npm run postgres:down
```

The Compose environment listens on local port `55432` by default and creates
the `plume` and `plume_secondary` test databases. `PLUME_POSTGRES_VERSION` and
`PLUME_POSTGRES_PORT` can override the image version and local port. CI runs the
same integration tests against PostgreSQL 14, 16, and 18.

Build a desktop bundle with:

```bash
npm run tauri build
```

See [Building Plume](BUILDING.md) for complete source-build and test instructions. The [release candidate runbook](docs/release-candidate.md), [macOS](docs/macos-release.md), and [Windows](docs/windows-release.md) guides cover unsigned candidate builds, optional signed builds, artifact verification, and promotion criteria.

## Repository Layout

```text
src/
├── app/                  Application shell and composition
├── features/             Product capabilities grouped by domain
├── i18n/                 Typed localization catalog and context
├── platform/             Tauri and operating-system adapters
├── shared/               Small reusable UI primitives
└── styles/               Global styles and design foundations

src-tauri/src/
├── commands/             Stable IPC command boundary
├── database/             PostgreSQL connections, sessions, and metadata
└── error.rs              Safe, structured errors returned to the UI

docs/
├── adr/                  Architecture Decision Records
├── architecture.md       Architecture guide in English
├── architecture.zh-CN.md Architecture guide in Simplified Chinese
├── 产品需求文档.md         Product requirements
└── 开发任务分解.md         Prioritized engineering backlog

tests/postgres/            Repeatable PostgreSQL integration fixtures
```

## Privacy and Security

- No account or remote Plume service is required.
- Passwords are not written to ordinary configuration files.
- SQL, results, connection addresses, and database metadata are not collected by default.
- Logs and UI errors must not contain passwords, private keys, or credential-bearing URLs.
- Connection profiles, drafts, history, settings, and session layouts are stored locally; saved secrets remain in the operating-system credential store. Active database sessions and result sets are memory-only.

See the [security policy](SECURITY.md) for supported versions and private vulnerability reporting. Do not report vulnerabilities in public issues.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Plume is available under the [MIT License](LICENSE).
See [third-party software notices](THIRD_PARTY_NOTICES.md) for the dependency
inventory and release-reporting policy.
