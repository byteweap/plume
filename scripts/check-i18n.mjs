import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = path.join(root, "src/i18n/catalog.ts");
const source = readFileSync(catalogPath, "utf8");
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function parseCatalog(locale) {
  const section = source.match(
    new RegExp(`  "${locale}": \\{([\\s\\S]*?)\\n  \\},`),
  )?.[1];
  check(Boolean(section), `Catalog is missing locale ${locale}.`);
  if (!section) return new Map();

  const entries = new Map();
  for (const line of section.split("\n")) {
    const match = line.match(/^    "([^"]+)": "((?:[^"\\]|\\.)*)",?$/);
    if (!match) continue;
    const [, key, value] = match;
    check(!entries.has(key), `${locale} contains duplicate key ${key}.`);
    entries.set(key, value);
  }
  return entries;
}

const catalogs = {
  "zh-CN": parseCatalog("zh-CN"),
  "en-US": parseCatalog("en-US"),
};
const chineseKeys = catalogs["zh-CN"];
const englishKeys = catalogs["en-US"];

for (const key of chineseKeys.keys()) {
  check(englishKeys.has(key), `en-US is missing translation key ${key}.`);
}
for (const key of englishKeys.keys()) {
  check(chineseKeys.has(key), `zh-CN is missing translation key ${key}.`);
}

const placeholderPattern = /\{[^{}]+\}/g;
const warningPattern = /(?:TODO|FIXME|TRANSLATION[_ -]?MISSING|UNTRANSLATED|\?{3,})/i;
for (const [locale, entries] of Object.entries(catalogs)) {
  check(entries.size > 0, `${locale} catalog is empty.`);
  for (const [key, value] of entries) {
    check(value.trim().length > 0, `${locale}.${key} has an empty translation.`);
    check(!warningPattern.test(value), `${locale}.${key} contains a translation placeholder.`);
    warningPattern.lastIndex = 0;
  }
}

for (const key of chineseKeys.keys()) {
  const zhPlaceholders = [...(chineseKeys.get(key)?.matchAll(placeholderPattern) ?? [])]
    .map((match) => match[0])
    .sort();
  const enPlaceholders = [...(englishKeys.get(key)?.matchAll(placeholderPattern) ?? [])]
    .map((match) => match[0])
    .sort();
  check(
    JSON.stringify(zhPlaceholders) === JSON.stringify(enPlaceholders),
    `${key} must use the same interpolation placeholders in both locales.`,
  );
}

const englishText = [...englishKeys.values()].join("\n");
check(!/[\u3400-\u9fff]/u.test(englishText), "en-US contains unlocalized CJK text.");

const intentionallySharedValues = new Set([
  "app.name",
  "app.version",
  "tree.catalogAnsi",
  "tree.schemas",
  "safety.confirm.host",
  "safety.confirm.database",
  "safety.confirm.schema",
  "query.export.encoding.utf8",
  "query.export.encoding.utf8Bom",
  "query.export.encoding.utf16Le",
  "tableData.editor.null",
  "tableData.editor.default",
  "query.error.sqlState",
  "connection.minimumVersion",
  "connection.url",
  "connection.urlPlaceholder",
  "connection.rootCertificatePlaceholder",
  "connection.clientCertificatePlaceholder",
  "connection.clientKeyPlaceholder",
  "connection.sshPrivateKeyPlaceholder",
  "connection.knownHostsPlaceholder",
]);
for (const key of chineseKeys.keys()) {
  if (chineseKeys.get(key) !== englishKeys.get(key)) continue;
  check(
    intentionallySharedValues.has(key),
    `${key} is identical in both locales without being an approved technical term.`,
  );
}

const provider = readFileSync(path.join(root, "src/i18n/I18nProvider.tsx"), "utf8");
const app = readFileSync(path.join(root, "src/app/App.tsx"), "utf8");
check(provider.includes('"plume.locale"'), "I18nProvider must persist the selected locale.");
check(provider.includes("navigator.language"), "I18nProvider must provide a browser-language fallback.");
check(app.includes("setLocale(locale === \"zh-CN\" ? \"en-US\" : \"zh-CN\")"), "App must expose a locale toggle.");

const forbiddenHardcodedStrings = [
  ["src/app/App.tsx", "Plume 0.1.0"],
  ["src/features/connections/ConnectionDialog.tsx", "postgresql://user@host/database"],
  ["src/features/connections/ConnectionDialog.tsx", "Local development"],
  ["src/features/connections/ConnectionDialog.tsx", "/path/to/root.crt"],
  ["src/features/connections/ConnectionDialog.tsx", "/path/to/client.crt"],
  ["src/features/connections/ConnectionDialog.tsx", "/path/to/client.key"],
  ["src/features/connections/ConnectionDialog.tsx", "~/.ssh/id_ed25519"],
  ["src/features/connections/ConnectionDialog.tsx", "~/.ssh/known_hosts"],
  ["src/features/query-results/QueryResultCellEditor.tsx", ">NULL</option>"],
  ["src/features/query-results/QueryResultCellEditor.tsx", ">DEFAULT</option>"],
  ["src/features/query-results/ResultExportDialog.tsx", ">UTF-8</option>"],
];
for (const [relativePath, literal] of forbiddenHardcodedStrings) {
  const text = readFileSync(path.join(root, relativePath), "utf8");
  check(!text.includes(literal), `${relativePath} contains hardcoded visible text: ${literal}`);
}

if (failures.length > 0) {
  console.error("i18n checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`i18n checks passed (${chineseKeys.size} keys in zh-CN and en-US).`);
}
