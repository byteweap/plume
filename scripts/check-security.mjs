import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function check(condition, message) {
  if (!condition) failures.push(message);
}

function sameValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value) => actual.includes(value))
  );
}

function parseCsp(value) {
  return new Map(
    value
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  );
}

function dependabotEcosystems(value) {
  const ecosystems = new Map();
  let current;

  for (const line of value.split("\n")) {
    const ecosystem = line.match(/^\s*- package-ecosystem:\s*(\S+)\s*$/);
    if (ecosystem) {
      current = ecosystem[1];
      ecosystems.set(current, {});
      continue;
    }

    if (!current) continue;
    const field = line.match(/^\s+(directory|interval):\s*(\S+)\s*$/);
    if (field) ecosystems.get(current)[field[1]] = field[2];
  }

  return ecosystems;
}

const packageJson = readJson("package.json");
const capability = readJson("src-tauri/capabilities/default.json");
const tauriConfig = readJson("src-tauri/tauri.conf.json");
const packageLock = readJson("package-lock.json");
const cargoManifest = read("src-tauri/Cargo.toml");
const cargoLock = read("src-tauri/Cargo.lock");
const tauriBuilder = read("src-tauri/src/lib.rs");
const dependabot = dependabotEcosystems(read(".github/dependabot.yml"));

check(
  sameValues(capability.windows, ["main"]),
  "The default capability must be scoped only to the main window.",
);
check(
  sameValues(capability.permissions, ["core:default"]),
  "The main window must receive only the core:default capability.",
);

const allNpmDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
  ...packageJson.optionalDependencies,
};
check(
  !("@tauri-apps/plugin-opener" in allNpmDependencies),
  "The unused JavaScript opener plugin must not be installed.",
);
check(
  !cargoManifest.includes("tauri-plugin-opener"),
  "The unused Rust opener plugin must not be installed.",
);
check(
  !tauriBuilder.includes("tauri_plugin_opener"),
  "The Tauri builder must not register the opener plugin.",
);

const security = tauriConfig.app?.security;
check(
  security?.freezePrototype === true,
  "Tauri must freeze the webview Object.prototype before application code runs.",
);
check(typeof security?.csp === "string", "A production CSP must be configured.");

if (typeof security?.csp === "string") {
  const csp = parseCsp(security.csp);
  check(
    sameValues(csp.get("default-src"), ["'self'"]),
    "The production CSP default-src must be restricted to 'self'.",
  );
  check(
    sameValues(csp.get("connect-src"), ["ipc:", "http://ipc.localhost"]),
    "The production CSP connect-src must be restricted to Tauri IPC.",
  );

  const allowedNetworkSources = new Set([
    "http://asset.localhost",
    "http://ipc.localhost",
  ]);
  const sources = [...csp.values()].flat();
  const arbitraryNetworkSources = sources.filter(
    (source) =>
      (source === "*" || /^(?:https?|wss?):/i.test(source)) &&
      !allowedNetworkSources.has(source),
  );
  check(
    arbitraryNetworkSources.length === 0,
    `The production CSP contains arbitrary network sources: ${arbitraryNetworkSources.join(", ")}`,
  );
  check(
    !sources.includes("'unsafe-eval'"),
    "The production CSP must not allow unsafe-eval.",
  );
}

check(packageLock.lockfileVersion >= 2, "package-lock.json must use a modern lockfile format.");
check(
  packageLock.packages && typeof packageLock.packages === "object",
  "package-lock.json must contain the resolved package inventory.",
);

if (packageLock.packages) {
  const missingIntegrity = Object.entries(packageLock.packages)
    .filter(([location]) => location)
    .filter(([, metadata]) => !metadata.integrity)
    .map(([location]) => location);
  check(
    missingIntegrity.length === 0,
    `npm packages are missing integrity hashes: ${missingIntegrity.join(", ")}`,
  );
  check(
    !Object.keys(packageLock.packages).some((location) => location.includes("plugin-opener")),
    "package-lock.json still contains the opener plugin.",
  );
}

const cargoPackages = cargoLock.split(/^\[\[package\]\]\s*$/m).slice(1);
const registryPackagesWithoutChecksum = cargoPackages
  .filter((entry) => /^source = "registry\+/m.test(entry))
  .filter((entry) => !/^checksum = "[0-9a-f]{64}"$/m.test(entry))
  .map((entry) => entry.match(/^name = "([^"]+)"$/m)?.[1] ?? "unknown");
check(cargoPackages.length > 0, "Cargo.lock must contain resolved packages.");
check(
  registryPackagesWithoutChecksum.length === 0,
  `Cargo registry packages are missing checksums: ${registryPackagesWithoutChecksum.join(", ")}`,
);
check(!cargoLock.includes('name = "tauri-plugin-opener"'), "Cargo.lock still contains the opener plugin.");

for (const [ecosystem, directory] of [
  ["npm", "/"],
  ["cargo", "/src-tauri"],
]) {
  const update = dependabot.get(ecosystem);
  check(update?.directory === directory, `Dependabot must cover ${ecosystem} in ${directory}.`);
  check(update?.interval === "weekly", `Dependabot ${ecosystem} updates must run weekly.`);
}

if (failures.length > 0) {
  console.error("Security boundary checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Security boundary checks passed (capabilities, CSP, dependencies, lockfiles, updates).");
}
