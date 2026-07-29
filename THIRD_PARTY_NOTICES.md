# Third-Party Software

Plume is distributed under the MIT License and uses third-party software under
compatible open-source licenses. The dependency lockfiles are the authoritative
inventory for a particular source revision:

- `package-lock.json` contains the complete JavaScript dependency graph.
- `src-tauri/Cargo.lock` contains the complete Rust dependency graph.

## Direct Runtime Dependencies

| Package | Purpose | License |
|---|---|---|
| `@tauri-apps/api`, `@tauri-apps/plugin-opener` | Desktop IPC and platform integration | Apache-2.0 OR MIT |
| `react`, `react-dom` | User interface | MIT |
| `codemirror`, `@codemirror/lang-sql` | SQL editing and PostgreSQL language support; includes CodeMirror modules and Lezer parser packages | MIT |
| `lucide-react` | Interface icons | ISC |
| `zod` | Runtime validation | MIT |
| `tauri`, `tauri-plugin-opener` | Desktop application runtime | Apache-2.0 OR MIT |
| `serde`, `serde_json` | IPC serialization | Apache-2.0 OR MIT |
| `thiserror` | Rust error definitions | Apache-2.0 OR MIT |
| `tokio` | Asynchronous runtime | MIT |
| `tokio-postgres` | PostgreSQL protocol driver | Apache-2.0 OR MIT |
| `native-tls`, `postgres-native-tls` | TLS support for PostgreSQL | Apache-2.0 OR MIT |
| `rusqlite` | Versioned local SQLite storage | MIT |
| `keyring` | macOS Keychain and Windows Credential Manager integration | Apache-2.0 OR MIT |
| `uuid` | Opaque session identifiers | Apache-2.0 OR MIT |

## Direct Development and Build Dependencies

The direct development toolchain includes Tauri CLI/build tooling, TypeScript,
Vite, Vitest, ESLint and its React/TypeScript integrations, Testing Library,
jsdom, and React type definitions. These packages are used under their
respective Apache-2.0, BSD, ISC, or MIT-compatible licenses as recorded in the
installed package metadata and lockfiles.

This file is an orientation document, not a replacement for upstream license
texts. Before distributing a release, CI must generate and archive a complete
license report from both lockfiles and fail on unreviewed or incompatible
licenses.
