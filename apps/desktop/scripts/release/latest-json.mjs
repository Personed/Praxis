/**
 * Stages release assets and generates the Tauri updater manifest (latest.json)
 * from the bundles produced by `tauri build` and uploaded as `bundles-*`
 * workflow artifacts.
 *
 * Each bundles-<matrix-name> artifact preserves the tree under target/…/bundle/,
 * so this walks them recursively, copies the installer files flat into
 * <artifacts-dir>/release-assets/ (disambiguating the macOS updater archive,
 * which is always named Modus.app.tar.gz), and writes
 * release-assets/latest.json.
 *
 * Usage: node scripts/release/latest-json.mjs <artifacts-dir> <tag>
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const [artifactsDir, tag] = process.argv.slice(2);
if (!artifactsDir || !tag) {
  console.error("usage: latest-json.mjs <artifacts-dir> <tag>");
  process.exit(1);
}

const version = tag.replace(/^v/, "");
const downloadBase = `https://github.com/Personed/Praxis/releases/download/${tag}`;
const outDir = join(artifactsDir, "release-assets");
mkdirSync(outDir, { recursive: true });

// bundles-<matrix.name> artifact -> updater platform key
const artifactPlatform = {
  "bundles-macos-arm64": "darwin-aarch64",
  "bundles-macos-x64": "darwin-x86_64",
  "bundles-windows-x64": "windows-x86_64",
  "bundles-linux-x64": "linux-x86_64",
};
// short arch token used to disambiguate same-named updater archives
const archToken = {
  "darwin-aarch64": "aarch64",
  "darwin-x86_64": "x86_64",
  "windows-x86_64": "x64",
  "linux-x86_64": "x64",
};

// installers worth publishing as release assets
const isBundle = (name) =>
  /\.(dmg|deb|rpm|msi|exe|appimage|nsis\.zip)$/i.test(name) || /\.app\.tar\.gz$/i.test(name);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

// pick the .sig that represents the updater archive for a platform
function pickUpdaterSig(sigNames) {
  const prefer = [
    /\.app\.tar\.gz\.sig$/i, // macOS
    /setup\.exe\.sig$/i, // Windows NSIS
    /\.nsis\.zip\.sig$/i,
    /\.msi\.sig$/i,
    /\.appimage\.sig$/i, // Linux
    /\.appimage\.tar\.gz\.sig$/i,
    /\.deb\.sig$/i,
  ];
  for (const re of prefer) {
    const hit = sigNames.find((n) => re.test(n));
    if (hit) return hit;
  }
  return sigNames[0];
}

const platforms = {};
const staged = new Set();

for (const [artifactDir, platform] of Object.entries(artifactPlatform)) {
  const root = join(artifactsDir, artifactDir);
  let files;
  try {
    files = [...walk(root)];
  } catch {
    console.log(`skipping ${artifactDir} (not found)`);
    continue;
  }
  const byBasename = new Map(files.map((f) => [basename(f), f]));

  // stage every installer file (+ its .sig) under a unique flat name
  const stagedName = (name) => {
    if (/^Modus\.app\.tar\.gz(\.sig)?$/i.test(name)) {
      const suffix = name.endsWith(".sig") ? ".sig" : "";
      return `Modus_${version}_${archToken[platform]}.app.tar.gz${suffix}`;
    }
    return name;
  };

  for (const file of files) {
    const name = basename(file);
    const isSig = name.endsWith(".sig");
    const base = isSig ? name.slice(0, -4) : name;
    if (isSig && !byBasename.has(base)) continue; // orphan signature
    if (!isSig && !isBundle(name)) continue;
    const target = join(outDir, stagedName(name));
    copyFileSync(file, target);
    staged.add(target);
  }

  const sigName = pickUpdaterSig(files.map((f) => basename(f)).filter((n) => n.endsWith(".sig")));
  if (sigName) {
    const archiveName = sigName.slice(0, -4);
    platforms[platform] = {
      signature: readFileSync(byBasename.get(sigName), "utf8").trim(),
      url: `${downloadBase}/${encodeURIComponent(stagedName(archiveName))}`,
    };
  } else {
    console.log(`warning: no updater signature in ${artifactDir}`);
  }
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
writeFileSync(join(outDir, "latest.json"), JSON.stringify(manifest, null, 2));
console.log(`latest.json: ${Object.keys(platforms).join(", ")}`);
console.log(`staged ${staged.size} release assets in ${outDir}`);
