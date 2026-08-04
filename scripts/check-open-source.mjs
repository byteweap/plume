import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "README.zh-CN.md",
  "BUILDING.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
];
const ignoredDirectories = new Set([".git", "dist", "node_modules", "target"]);
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function normalizeLineEndings(text) {
  return text.replace(/\r\n?/g, "\n");
}

function markdownFiles(directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(entryPath));
    else if (entry.name.endsWith(".md")) files.push(entryPath);
  }
  return files;
}

for (const requiredFile of requiredFiles) {
  const absolutePath = path.join(root, requiredFile);
  check(existsSync(absolutePath) && statSync(absolutePath).size > 0, `Required file is missing or empty: ${requiredFile}`);
}

const packageJson = JSON.parse(read("package.json"));
const cargoManifest = read("src-tauri/Cargo.toml");
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const normalizedCargoManifest = normalizeLineEndings(cargoManifest);
const license = normalizeLineEndings(read("LICENSE"));
const thirdPartyNotices = read("THIRD_PARTY_NOTICES.md");
const englishReadme = read("README.md");
const chineseReadme = read("README.zh-CN.md");

check(packageJson.license === "MIT", "package.json must declare the MIT license.");
check(/^license = "MIT"$/m.test(cargoManifest), "Cargo.toml must declare the MIT license.");
check(license.startsWith("MIT License\n"), "LICENSE must contain the standard MIT license text.");
check(license.includes("Copyright (c) 2026 Plume contributors"), "LICENSE must identify the project copyright holder.");
check(packageJson.repository?.url === "git+https://github.com/byteweap/plume.git", "package.json repository metadata is missing.");
check(tauriConfig.bundle?.homepage === "https://github.com/byteweap/plume", "Desktop bundle homepage metadata is missing.");

const runtimeDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const cargoDependencySection = normalizedCargoManifest.match(/^\[dependencies\]\n([\s\S]*?)(?=^\[)/m)?.[1] ?? "";
for (const match of cargoDependencySection.matchAll(/^([a-zA-Z0-9_-]+)\s*=/gm)) {
  runtimeDependencies.add(match[1]);
}
runtimeDependencies.add("keyring");

for (const dependency of runtimeDependencies) {
  check(
    thirdPartyNotices.includes(`\`${dependency}\``),
    `THIRD_PARTY_NOTICES.md must list direct runtime dependency ${dependency}.`,
  );
}

for (const [name, readme] of [
  ["README.md", englishReadme],
  ["README.zh-CN.md", chineseReadme],
]) {
  for (const requiredLink of [
    "BUILDING.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    check(readme.includes(`](${requiredLink})`), `${name} must link to ${requiredLink}.`);
  }
}

const placeholderPattern = /(?:INSERT CONTACT|TODO:.*(?:policy|contact)|YOUR[_ -](?:EMAIL|NAME))/i;
for (const requiredFile of requiredFiles.filter((file) => file.endsWith(".md"))) {
  check(!placeholderPattern.test(read(requiredFile)), `${requiredFile} contains an unresolved policy placeholder.`);
}

for (const markdownPath of markdownFiles()) {
  const markdown = readFileSync(markdownPath, "utf8");
  const relativeMarkdownPath = path.relative(root, markdownPath);
  const links = markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);

  for (const match of links) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (!target || target.startsWith("#") || /^(?:https?:|mailto:)/i.test(target)) continue;

    const pathPart = target.split("#", 1)[0].split("?", 1)[0];
    if (!pathPart) continue;

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathPart);
    } catch {
      failures.push(`${relativeMarkdownPath} contains an invalid encoded link: ${target}`);
      continue;
    }

    const resolvedPath = path.resolve(path.dirname(markdownPath), decodedPath);
    check(existsSync(resolvedPath), `${relativeMarkdownPath} links to a missing local path: ${target}`);
  }
}

if (failures.length > 0) {
  console.error("Open-source documentation checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Open-source documentation checks passed (required files, metadata, licenses, dependencies, local links).",
  );
}
