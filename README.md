<div align="center">

# Plume

**A clean, lightweight PostgreSQL desktop workspace.**

[English](README.md) · [简体中文](README.zh-CN.md)

![Project status](https://img.shields.io/badge/status-early%20development-D97706)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)
![License](https://img.shields.io/badge/license-MIT-2F6D52)

</div>

Plume is a local-first PostgreSQL management tool built for developers who want a focused alternative to large, general-purpose database clients. The desktop application connects directly to PostgreSQL. There is no Plume account, cloud relay, or remote application server between you and your database.

> [!IMPORTANT]
> Plume is in early development. Connection management and PostgreSQL object navigation are usable today; the SQL editor, data browser, and data editing workflows are still being built.

## Why Plume

- **PostgreSQL-native:** models servers, databases, roles, tablespaces, database collections, schemas, and schema objects instead of flattening everything into a generic database tree.
- **Lightweight by design:** Tauri and Rust own privileged and database work while React stays focused on presentation.
- **Local-first:** database traffic goes directly from the desktop process to PostgreSQL.
- **Lazy and responsive:** metadata is loaded only when a tree node is expanded; additional databases get clients on demand.
- **Explicit security boundaries:** passwords never return to React after connection setup and are never written to regular configuration files.
- **Bilingual foundation:** the interface currently supports English and Simplified Chinese.

## Available Today

- PostgreSQL connection form with validation and categorized errors.
- PostgreSQL 14+ support, tested during development with PostgreSQL 18.
- SSL modes: `disable`, `prefer`, `require`, `verify-ca`, and `verify-full`.
- In-memory server sessions with independent, on-demand clients for each database.
- pgAdmin-style server navigation:

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

- Loading, empty, error, retry, and object-count states throughout the tree.
- English and Simplified Chinese UI catalogs.
- Light and dark appearance foundations.

## Roadmap

| Area | Status |
|---|---|
| Direct connection and SSL | Available |
| Multi-database object navigation | Available |
| System credential storage | Planned for MVP |
| SSH Tunnel | Planned for MVP |
| SQL editor, execution, cancellation | Planned for MVP |
| Query results and export | Planned for MVP |
| Table data browsing and safe editing | Planned for MVP |
| `EXPLAIN` visualization | Planned after the core workflow |
| Cloud IAM authentication and Linux releases | Later candidates |

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

React never connects to PostgreSQL directly. Rust owns database sessions, TLS, metadata queries, future query cancellation, credential access, and file-system capabilities. Stable, serializable command errors form the contract between both sides.

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
- Connection profiles and active sessions are currently memory-only and disappear when Plume exits.

Please report security issues through [GitHub Security Advisories](https://github.com/byteweap/plume/security/advisories/new) rather than a public issue.

## Contributing

Plume is at an early architectural stage, so focused changes are easier to review than broad rewrites. Before opening a pull request:

1. Check the [development task breakdown](docs/开发任务分解.md) and existing [issues](https://github.com/byteweap/plume/issues).
2. Keep React, Tauri commands, and PostgreSQL services within their documented boundaries.
3. Add or update tests for behavior changes.
4. Run the frontend and Rust quality checks shown above.
5. Keep English and Simplified Chinese user-facing text in sync.

## License

Plume is available under the [MIT License](LICENSE).
See [third-party software notices](THIRD_PARTY_NOTICES.md) for the dependency
inventory and release-reporting policy.
