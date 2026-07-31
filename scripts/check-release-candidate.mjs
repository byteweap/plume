import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const cargoManifest = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const catalog = read("src/i18n/catalog.ts");
const version = packageJson.version;
const expectedTag = `v${version}`;

check(/^1\.0\.0-rc\.[1-9][0-9]*$/.test(version), "Candidate version must match 1.0.0-rc.N.");
check(packageLock.version === version, "package-lock.json top-level version must match package.json.");
check(packageLock.packages?.[""]?.version === version, "package-lock.json root package version must match package.json.");
check(tauriConfig.version === version, "tauri.conf.json version must match package.json.");
check(
  new RegExp(`^version = "${version.replaceAll(".", "\\.")}"$`, "m").test(cargoManifest),
  "Cargo.toml version must match package.json.",
);
const plumeLockEntry = cargoLock.match(/\[\[package\]\]\nname = "plume"\nversion = "([^"]+)"/);
check(plumeLockEntry?.[1] === version, "Cargo.lock Plume package version must match package.json.");

const catalogVersionCount = catalog.split(`"app.version": "Plume ${version}"`).length - 1;
check(catalogVersionCount === 2, "Both locale catalogs must display the candidate version.");

for (const requiredFile of ["RELEASE_NOTES.md", "docs/release-candidate.md"]) {
  const absolutePath = path.join(root, requiredFile);
  check(existsSync(absolutePath) && statSync(absolutePath).size > 0, `${requiredFile} is missing or empty.`);
  if (existsSync(absolutePath)) {
    check(read(requiredFile).includes(version), `${requiredFile} must identify ${version}.`);
  }
}

const macWorkflow = read(".github/workflows/release-macos.yml");
const windowsWorkflow = read(".github/workflows/release-windows.yml");
const candidateWorkflow = read(".github/workflows/release-candidate.yml");
check(macWorkflow.includes("workflow_call:"), "macOS release workflow must be reusable.");
check(windowsWorkflow.includes("workflow_call:"), "Windows release workflow must be reusable.");
check(macWorkflow.includes("npm run check:all"), "macOS release workflow must run the complete repository gate.");
check(macWorkflow.includes("universal-apple-darwin"), "macOS release workflow must build a universal candidate.");
check(macWorkflow.includes("verify:release:macos"), "macOS release workflow must verify signing and notarization.");
check(windowsWorkflow.includes("npm run check:all"), "Windows release workflow must run the complete repository gate.");
check(windowsWorkflow.includes("verify:release:windows"), "Windows release workflow must verify Authenticode signatures.");
check(windowsWorkflow.includes("test-windows-installers.ps1"), "Windows release workflow must test install and uninstall.");
check(candidateWorkflow.includes('"v1.0.0-rc.*"'), "Candidate workflow must run only for 1.0 RC tags.");
check(candidateWorkflow.includes("./.github/workflows/release-macos.yml"), "Candidate workflow must require the macOS signed build.");
check(candidateWorkflow.includes("./.github/workflows/release-windows.yml"), "Candidate workflow must require the Windows signed build.");
check(candidateWorkflow.includes("SHA256SUMS"), "Candidate workflow must publish artifact checksums.");
check(candidateWorkflow.includes("needs: [macos, windows]"), "Publishing must wait for both signed platform jobs.");
check(candidateWorkflow.includes("--prerelease"), "Candidate workflow must mark the GitHub release as a pre-release.");
check(candidateWorkflow.includes("--verify-tag"), "Candidate workflow must verify the release tag.");

const configuredTag = argumentValue("--tag");
if (configuredTag !== undefined) {
  check(configuredTag === expectedTag, `Release tag must be ${expectedTag}, received ${configuredTag}.`);
}

if (failures.length > 0) {
  console.error("Release candidate checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Release candidate configuration passed (${version}, expected tag ${expectedTag}).`);
}
