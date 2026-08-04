import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertMsiVersionRange(version, originalVersion) {
  const parts = version.split(".").map((part) => Number(part));
  if (
    (parts.length !== 3 && parts.length !== 4) ||
    parts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    fail(`Cannot derive a valid MSI version from ${originalVersion}.`);
  }

  const [major, minor, patch, build] = parts;
  if (major > 255 || minor > 255 || patch > 65_535 || (build ?? 0) > 65_535) {
    fail(`Derived MSI version ${version} is outside Windows Installer limits.`);
  }
}

function windowsMsiVersion(version) {
  const candidate = version.match(/^1\.0\.0-rc\.([1-9][0-9]*)$/);
  if (candidate) {
    const candidateNumber = Number(candidate[1]);
    if (!Number.isInteger(candidateNumber) || candidateNumber > 65_535) {
      fail(`Release candidate number ${candidate[1]} is too large for MSI ProductVersion.`);
    }

    // MSI ProductVersion is numeric-only. Keep all 1.0.0 release candidates
    // below the final 1.0.0 installer while preserving RC ordering.
    return `0.255.${candidateNumber}`;
  }

  const stable = version.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/);
  if (stable) return stable[0];

  fail(`Unsupported Windows MSI version source: ${version}`);
}

const version = windowsMsiVersion(packageJson.version);
assertMsiVersionRange(version, packageJson.version);
console.log(version);
