import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argumentsList = process.argv.slice(2);
const configOnly = argumentsList.includes("--config-only");
const allowUnsigned = argumentsList.includes("--allow-unsigned");

function argumentValue(name) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
}

function findFiles(directory, suffix) {
  const matches = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, suffix));
    else if (entry.name.toLowerCase().endsWith(suffix)) matches.push(entryPath);
  }
  return matches;
}

function authenticodeSignature(filePath) {
  const escapedPath = filePath.replaceAll("'", "''");
  const script = [
    `$signature = Get-AuthenticodeSignature -LiteralPath '${escapedPath}'`,
    "[ordered]@{",
    "  Status = [string]$signature.Status",
    "  SignerThumbprint = $signature.SignerCertificate.Thumbprint",
    "  TimestampThumbprint = $signature.TimeStamperCertificate.Thumbprint",
    "} | ConvertTo-Json -Compress",
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`Authenticode inspection failed for ${filePath}: ${(result.stderr ?? "").trim()}`);
  }
  return JSON.parse(result.stdout);
}

const packageJson = readJson("package.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const windowsConfig = tauriConfig.bundle?.windows;

if (tauriConfig.productName !== "Plume") fail("The Windows product name must be Plume.");
if (tauriConfig.version !== packageJson.version) {
  fail("package.json and tauri.conf.json versions must match.");
}
if (tauriConfig.bundle?.publisher !== "Plume contributors") {
  fail("The Windows installer publisher must remain stable.");
}
if (windowsConfig?.digestAlgorithm !== "sha256") {
  fail("Windows release signatures must use SHA-256.");
}
if (windowsConfig?.timestampUrl !== "http://timestamp.digicert.com" || windowsConfig?.tsp !== true) {
  fail("Windows release signatures must use the configured RFC 3161 timestamp service.");
}
if (windowsConfig?.allowDowngrades !== false) {
  fail("Windows installers must reject downgrades.");
}
if (
  windowsConfig?.webviewInstallMode?.type !== "downloadBootstrapper" ||
  windowsConfig?.webviewInstallMode?.silent !== true
) {
  fail("Windows installers must silently bootstrap WebView2 when it is missing.");
}
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(windowsConfig?.wix?.upgradeCode ?? "")) {
  fail("The MSI UpgradeCode must be a stable UUID.");
}
if (windowsConfig?.nsis?.installMode !== "currentUser") {
  fail("The NSIS package must default to a non-elevated current-user install.");
}
if (!["English", "SimpChinese"].every((language) => windowsConfig?.nsis?.languages?.includes(language))) {
  fail("The NSIS installer must include English and Simplified Chinese.");
}

const iconPath = path.join(repositoryRoot, "src-tauri", windowsConfig?.nsis?.installerIcon ?? "");
if (!existsSync(iconPath) || statSync(iconPath).size === 0 || path.extname(iconPath) !== ".ico") {
  fail("The Windows installer icon must be a non-empty ICO file.");
}

if (configOnly) {
  console.log("Windows release configuration passed (identity, icons, signing, timestamp, MSI, NSIS).");
  process.exit(0);
}

if (process.platform !== "win32") fail("Windows bundles can only be verified on Windows.");

const bundleRootValue = argumentValue("--bundle-root");
const executableValue = argumentValue("--executable");
if (!bundleRootValue || !executableValue) {
  fail("Pass --bundle-root and --executable for the Windows build.");
}

const bundleRoot = path.resolve(repositoryRoot, bundleRootValue);
const executablePath = path.resolve(repositoryRoot, executableValue);
if (!existsSync(bundleRoot) || !existsSync(executablePath)) {
  fail("The Windows bundle directory or application executable does not exist.");
}

const nsisInstallers = findFiles(bundleRoot, ".exe");
const msiInstallers = findFiles(bundleRoot, ".msi");
if (nsisInstallers.length !== 1 || msiInstallers.length !== 1) {
  fail(`Expected one NSIS and one MSI installer, found ${nsisInstallers.length} EXE and ${msiInstallers.length} MSI.`);
}

if (allowUnsigned) {
  console.log(
    `Verified unsigned Windows candidate bundle inventory:\n- ${nsisInstallers[0]}\n- ${msiInstallers[0]}`,
  );
  process.exit(0);
}

for (const artifact of [executablePath, ...nsisInstallers, ...msiInstallers]) {
  const signature = authenticodeSignature(artifact);
  if (signature.Status !== "Valid" || !signature.SignerThumbprint) {
    fail(`Authenticode signature is not valid: ${artifact}`);
  }
  if (!signature.TimestampThumbprint) {
    fail(`Authenticode signature is missing a trusted timestamp: ${artifact}`);
  }
}

console.log(
  `Verified signed and timestamped Windows release:\n- ${executablePath}\n- ${nsisInstallers[0]}\n- ${msiInstallers[0]}`,
);
