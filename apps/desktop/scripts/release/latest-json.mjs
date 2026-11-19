/**
 * Generates the Tauri updater manifest (latest.json) from the signed updater
 * artifacts produced by `tauri build` (*.sig next to each update archive).
 *
 * Usage: node scripts/release/latest-json.mjs <artifacts-dir> <tag>
 * Writes <artifacts-dir>/latest.json.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [artifactsDir, tag] = process.argv.slice(2);
if (!artifactsDir || !tag) {
  console.error("usage: latest-json.mjs <artifacts-dir> <tag>");
  process.exit(1);
}

const version = tag.replace(/^v/, "");
const downloadBase = `https://github.com/Personed/Praxis/releases/download/${tag}`;

function platformOf(archiveName) {
  const n = archiveName.toLowerCase();
  if (n.includes("app.tar.gz")) {
    return n.includes("aarch64") ? "darwin-aarch64" : "darwin-x86_64";
  }
  if (n.includes("appimage")) return "linux-x86_64";
  if (n.includes("nsis") || n.includes("msi")) return "windows-x86_64";
  return null;
}

const platforms = {};
for (const file of readdirSync(artifactsDir)) {
  if (!file.endsWith(".sig")) continue;
  const archive = file.slice(0, -4);
  const platform = platformOf(archive);
  if (!platform) {
    console.log(`skipping ${file} (no updater platform matched)`);
    continue;
  }
  platforms[platform] = {
    signature: readFileSync(join(artifactsDir, file), "utf8").trim(),
    url: `${downloadBase}/${encodeURIComponent(archive)}`,
  };
}

if (Object.keys(platforms).length === 0) {
  console.error("no updater artifacts (*.sig) found — was TAURI_SIGNING_PRIVATE_KEY set?");
  process.exit(1);
}

const manifest = {
  version,
  notes: `Modus ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(artifactsDir, "latest.json"), JSON.stringify(manifest, null, 2));
console.log(`latest.json: ${Object.keys(platforms).join(", ")}`);
