import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const configOnly = argumentsList.includes("--config-only");
const allowUnsigned = argumentsList.includes("--allow-unsigned");
const bundleRootIndex = argumentsList.indexOf("--bundle-root");
const bundleRoot =
  bundleRootIndex === -1
    ? undefined
    : path.resolve(repositoryRoot, argumentsList[bundleRootIndex + 1] ?? "");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed${output ? `:\n${output}` : "."}`);
  }
  return output;
}

function plistValue(plistPath, key) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Print:${key}`, plistPath]);
}

function findFiles(directory, suffix) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, suffix));
    else if (entry.name.endsWith(suffix)) matches.push(entryPath);
  }
  return matches;
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const macConfig = tauriConfig.bundle?.macOS;

if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+){2,}$/.test(tauriConfig.identifier ?? "")) {
  fail("Tauri identifier must be a stable reverse-domain identifier.");
}
if (tauriConfig.productName !== "Plume") fail("The macOS product name must be Plume.");
if (tauriConfig.version !== packageJson.version) {
  fail("package.json and tauri.conf.json versions must match.");
}
if (macConfig?.minimumSystemVersion !== "13.0") {
  fail("The macOS deployment target must be 13.0.");
}
if (macConfig?.hardenedRuntime !== true) {
  fail("The macOS bundle must enable hardened runtime.");
}

for (const icon of ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns"]) {
  const iconPath = path.join(repositoryRoot, "src-tauri", icon);
  if (!existsSync(iconPath) || statSync(iconPath).size === 0) {
    fail(`Required macOS icon is missing or empty: src-tauri/${icon}`);
  }
}

if (configOnly) {
  console.log("macOS release configuration passed (identity, version, icons, deployment target, hardened runtime).");
  process.exit(0);
}

if (process.platform !== "darwin") fail("macOS bundles can only be verified on macOS.");
if (!bundleRoot || !existsSync(bundleRoot)) {
  fail("Pass an existing macOS bundle directory with --bundle-root.");
}

const appPath = path.join(bundleRoot, "macos", `${tauriConfig.productName}.app`);
if (!existsSync(appPath)) fail(`Application bundle not found: ${appPath}`);

const diskImages = findFiles(bundleRoot, ".dmg");
if (diskImages.length !== 1) {
  fail(`Expected exactly one DMG below ${bundleRoot}, found ${diskImages.length}.`);
}
const diskImagePath = diskImages[0];
const infoPlistPath = path.join(appPath, "Contents", "Info.plist");

const identifier = plistValue(infoPlistPath, "CFBundleIdentifier");
const version = plistValue(infoPlistPath, "CFBundleShortVersionString");
const minimumSystemVersion = plistValue(infoPlistPath, "LSMinimumSystemVersion");
const executableName = plistValue(infoPlistPath, "CFBundleExecutable");

if (identifier !== tauriConfig.identifier) fail(`Unexpected bundle identifier: ${identifier}`);
if (version !== tauriConfig.version) fail(`Unexpected bundle version: ${version}`);
if (minimumSystemVersion !== macConfig.minimumSystemVersion) {
  fail(`Unexpected minimum macOS version: ${minimumSystemVersion}`);
}

const executablePath = path.join(appPath, "Contents", "MacOS", executableName);
const architectures = new Set(run("lipo", ["-archs", executablePath]).split(/\s+/));
for (const architecture of ["arm64", "x86_64"]) {
  if (!architectures.has(architecture)) fail(`Universal app is missing ${architecture}.`);
}

if (allowUnsigned) {
  run("hdiutil", ["verify", diskImagePath]);
  console.log(`Verified unsigned universal macOS candidate:\n- ${appPath}\n- ${diskImagePath}`);
  process.exit(0);
}

run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
const signature = run("codesign", ["-dv", "--verbose=4", appPath]);
if (!signature.includes("Authority=Developer ID Application:")) {
  fail("The app is not signed by a Developer ID Application certificate.");
}
if (!/TeamIdentifier=(?!not set)[A-Z0-9]+/.test(signature)) {
  fail("The app signature does not contain an Apple Team ID.");
}
if (!/flags=.*\(runtime\)/.test(signature)) {
  fail("The app signature does not enable hardened runtime.");
}

run("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);
run("xcrun", ["stapler", "validate", appPath]);
run("hdiutil", ["verify", diskImagePath]);
run("codesign", ["--verify", "--strict", "--verbose=2", diskImagePath]);
run("xcrun", ["stapler", "validate", diskImagePath]);
run("spctl", [
  "--assess",
  "--type",
  "open",
  "--context",
  "context:primary-signature",
  "--verbose=2",
  diskImagePath,
]);

console.log(`Verified signed and notarized universal macOS release:\n- ${appPath}\n- ${diskImagePath}`);
