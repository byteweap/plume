import { spawnSync } from "node:child_process";

const environment = {
  ...process.env,
  PLUME_TEST_DATABASE_CONFIG:
    process.env.PLUME_TEST_DATABASE_CONFIG ??
    "postgresql://plume:plume@localhost:55432/plume?sslmode=disable",
  PLUME_TEST_SECONDARY_DATABASE:
    process.env.PLUME_TEST_SECONDARY_DATABASE ?? "plume_secondary",
};

const result = spawnSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--",
    "--ignored",
    "--test-threads=1",
  ],
  { env: environment, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
