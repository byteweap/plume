import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve("dist");
const assets = resolve(dist, "assets");
const startupAssets = readdirSync(assets).filter((name) =>
  /^index-[^.]+\.js$/.test(name),
);

if (startupAssets.length !== 1) {
  throw new Error(
    `Expected one production startup JavaScript asset, found ${startupAssets.length}.`,
  );
}

function directorySize(path) {
  return readdirSync(path, { withFileTypes: true }).reduce(
    (total, entry) => {
      const entryPath = resolve(path, entry.name);
      return total + (entry.isDirectory() ? directorySize(entryPath) : statSync(entryPath).size);
    },
    0,
  );
}

const startupPath = resolve(assets, startupAssets[0]);
const startupSource = readFileSync(startupPath);
const result = {
  startupAsset: startupAssets[0],
  startupBytes: startupSource.length,
  startupGzipBytes: gzipSync(startupSource).length,
  distBytes: directorySize(dist),
};

console.log(JSON.stringify(result, null, 2));

if (
  result.startupBytes > 1_000_000 ||
  result.startupGzipBytes > 320_000 ||
  result.distBytes > 2_500_000
) {
  throw new Error("Production bundle exceeded its performance budget.");
}
