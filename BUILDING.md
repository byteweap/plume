# Building Plume

This guide covers development, testing, and unsigned packaging from a clean checkout. Signed distribution is documented separately for [macOS](docs/macos-release.md) and [Windows](docs/windows-release.md).

## Supported Hosts

Plume targets macOS 13+ and Windows 10/11. Build on the operating system you intend to package; Tauri desktop installers are not cross-platform bundles.

Common requirements:

- Git
- Node.js 20 or newer and npm 10 or newer
- Current stable Rust with Cargo
- PostgreSQL 14+ for integration work
- Docker Desktop or another Compose-compatible Docker environment for the repeatable integration suite

macOS also requires Xcode Command Line Tools. Windows requires Microsoft C++ Build Tools and the WebView2 development prerequisites. Follow the official [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for current host packages.

## Clean Checkout

```bash
git clone https://github.com/byteweap/plume.git
cd plume
npm ci
```

`npm ci` consumes the committed lockfile and installs the repository-local pre-commit hook. Cargo uses `src-tauri/Cargo.lock`; do not regenerate either lockfile unless dependency changes are intentional.

## Development

Run the desktop application:

```bash
npm run tauri dev
```

Run only the Vite UI for layout work:

```bash
npm run dev
```

Browser mode deliberately rejects privileged database operations. Connection, credential, export, and operating-system behavior must be tested through the Tauri application.

## Quality Gates

Run the complete local gate:

```bash
npm run check:all
```

This checks repository documentation and release configuration, security boundaries, TypeScript, ESLint, frontend tests, acceptance flows, the production frontend build, rustfmt, Clippy with warnings denied, and Rust tests.

Run the disposable PostgreSQL 14/16/18-compatible integration environment:

```bash
npm run postgres:up
npm run test:postgres
npm run postgres:down
```

`PLUME_POSTGRES_VERSION` selects the PostgreSQL image and defaults to 18. `PLUME_POSTGRES_PORT` can change the default host port `55432`. Always run `postgres:down` after local testing so generated TLS/SSH fixtures and containers do not outlive the test session.

Run performance regression budgets with:

```bash
npm run benchmark:regression
```

## Unsigned Packages

On macOS, use the CI environment flag to avoid Finder automation in headless terminals:

```bash
CI=true npm run tauri build -- --bundles app,dmg --no-sign
```

On Windows PowerShell:

```powershell
npm run tauri build -- --bundles msi,nsis --ci --no-sign
```

Build products are written below `src-tauri/target/release/bundle/` and are ignored by Git. Unsigned packages are development artifacts; they do not satisfy release acceptance.

## Troubleshooting

- If frontend dependencies drift, remove only `node_modules` and rerun `npm ci`; do not edit the lockfile to fix a local cache.
- If Rust compilation behaves inconsistently, verify the stable toolchain and target prerequisites before clearing build outputs.
- If database tests fail, inspect Docker service health and generated fixture logs, then run `npm run postgres:down` before retrying.
- If a browser build reports `desktop_required`, run the workflow through `npm run tauri dev`; that error is an intentional security boundary.
