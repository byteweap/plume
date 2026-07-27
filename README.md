# Plume

Plume is a clean, lightweight PostgreSQL desktop workspace. It connects directly from the desktop application to PostgreSQL; there is no remote Plume service between the user and the database.

> Status: early development. The current slice includes the desktop shell, Chinese and English UI foundations, validated connection forms, typed Tauri IPC, retained multi-database PostgreSQL sessions, SSL modes, and pgAdmin-style lazy object navigation.

## Technology

- Tauri 2
- React 19 and TypeScript
- Rust 2024 edition
- `tokio-postgres` with native TLS
- Vitest and Testing Library
- ESLint and rustfmt

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- Current stable Rust toolchain
- Tauri platform prerequisites for macOS or Windows

## Development

```bash
npm install
npm run tauri dev
```

Run the frontend alone when working on layout or styling:

```bash
npm run dev
```

Database commands intentionally return a `desktop_required` error in a browser-only session. They must never be replaced with fake success responses.

## Quality checks

```bash
npm run check
cd src-tauri && cargo fmt --check && cargo test
```

Build the frontend and desktop application:

```bash
npm run build
npm run tauri build
```

## Source boundaries

```text
src/
├── app/                 Application shell and composition
├── features/            Product capabilities grouped by domain
├── i18n/                Typed localization catalog and context
├── platform/            Tauri and operating-system adapters
├── shared/              Small reusable UI primitives
└── styles/              Global design tokens and base styles

src-tauri/src/
├── commands/            Stable Tauri command boundary
├── database/            PostgreSQL infrastructure and protocols
└── error.rs             Safe, structured errors for the UI
```

Feature UI must call platform capabilities through feature APIs. React components do not call Tauri directly, and command handlers do not contain database protocol details.

See [Architecture](docs/architecture.md), [Product Requirements](docs/产品需求文档.md), and [Development Tasks](docs/开发任务分解.md) for the current decisions and delivery scope.

## Privacy baseline

- No account or remote application service is required.
- Passwords must not be written to normal configuration files.
- SQL, query results, connection addresses, and database metadata are not collected by default.
- Logs and UI errors must not contain passwords, private keys, or credential-bearing URLs.

## License

[MIT](LICENSE)
