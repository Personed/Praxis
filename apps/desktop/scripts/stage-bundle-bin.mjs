/**
 * Stages out/bundle-bin/: the Node runtime plus every native/service binary the
 * sidecar resolves under <resources>/bin in packaged builds (pty host, REA and
 * plugin supervisors, codegraph). tauri.conf.json maps it to resources "bin".
 */
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(DESKTOP_DIR, "../..");
const OUT = join(DESKTOP_DIR, "out", "bundle-bin");
const TARGET_RELEASE = join(REPO_ROOT, "target", "release");
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);

mkdirSync(OUT, { recursive: true });

const copies = [
  { from: process.execPath, to: exe("node"), required: true },
  ...[
    "modus-pty-host",
    "modus-rea-process-supervisor",
    "modus-plugin-execution-supervisor",
    "modus-plugin-worker",
    "modus-tool-filter",
  ].map((name) => ({
    from: join(TARGET_RELEASE, exe(name)),
    to: exe(name),
    // plugin supervisor/worker only build on Linux
    required: name !== "modus-plugin-execution-supervisor" && name !== "modus-plugin-worker",
  })),
];

for (const { from, to, required } of copies) {
  if (!existsSync(from)) {
    if (required) {
      console.error(`missing ${from} — run npm --workspace @modus/desktop run build first`);
      process.exit(1);
    }
    continue;
  }
  copyFileSync(from, join(OUT, to));
  console.log(`staged ${to}`);
}

// codegraph ships as an npm package directory; resolve the platform bundle like
// fast-codebase-service does and copy it so <resources>/bin/codegraph exists.
const codegraphRoot = join(REPO_ROOT, "node_modules", "@colbymchenry");
if (existsSync(codegraphRoot)) {
  const platformKey = `${process.platform}-${process.arch}`;
  for (const name of [`codegraph-${platformKey}`, "codegraph"]) {
    const dir = join(codegraphRoot, name);
    if (existsSync(dir)) {
      cpSync(dir, join(OUT, "codegraph"), { recursive: true });
      console.log(`staged codegraph (${name})`);
      break;
    }
  }
}

// onnxruntime-node is external to the sidecar bundle (native). Stage the
// package under <resources>/sidecar/node_modules so Node's upward lookup finds
// it — but only the current platform's binaries (~100 MB per platform).
const nm = join(REPO_ROOT, "node_modules");
const ort = join(nm, "onnxruntime-node");
const sidecarNm = join(DESKTOP_DIR, "out", "sidecar", "node_modules");
if (existsSync(ort)) {
  const ortOut = join(sidecarNm, "onnxruntime-node");
  for (const entry of ["package.json", "dist", "types", "lib", "VERSION_NUMBER"]) {
    const src = join(ort, entry);
    if (existsSync(src)) cpSync(src, join(ortOut, entry), { recursive: true });
  }
  const binSrc = join(ort, "bin", "napi-v6", process.platform, process.arch);
  if (existsSync(binSrc)) {
    cpSync(binSrc, join(ortOut, "bin", "napi-v6", process.platform, process.arch), {
      recursive: true,
    });
  }
  // libonnxruntime also serves the Rust modus-tool-filter binary (load-dynamic).
  for (const dep of ["onnxruntime-common", "adm-zip", "global-agent"]) {
    const depSrc = join(nm, dep);
    if (existsSync(depSrc)) cpSync(depSrc, join(sidecarNm, dep), { recursive: true });
  }
  console.log(`staged onnxruntime-node (${process.platform}/${process.arch})`);
}

// chrome-headless-shell: ship a Chrome for Testing build so packaged installs
// don't need a system Chrome. Flattened into <resources>/bin/chrome-headless-shell/.
// Skip with MODUS_SKIP_CHROMIUM_DOWNLOAD=1 (offline/dev runs).
if (process.env.MODUS_SKIP_CHROMIUM_DOWNLOAD !== "1") {
  const cftPlatforms = {
    "linux-x64": "linux64",
    "win32-x64": "win64",
    "darwin-arm64": "mac-arm64",
    "darwin-x64": "mac-x64",
  };
  const cftPlatform =
    process.env.MODUS_CFT_PLATFORM ?? cftPlatforms[`${process.platform}-${process.arch}`];
  if (cftPlatform) {
    try {
      const versions = await (
        await fetch(
          "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json",
        )
      ).json();
      const download = versions.channels.Stable.downloads["chrome-headless-shell"].find(
        (d) => d.platform === cftPlatform,
      );
      if (!download) throw new Error(`no chrome-headless-shell for ${cftPlatform}`);
      console.log(
        `downloading chrome-headless-shell ${versions.channels.Stable.version} (${cftPlatform})`,
      );
      const zipPath = join(OUT, ".chrome-headless-shell.zip");
      const buf = Buffer.from(await (await fetch(download.url)).arrayBuffer());
      const { writeFileSync, rmSync, chmodSync } = await import("node:fs");
      writeFileSync(zipPath, buf);
      const { createRequire } = await import("node:module");
      const AdmZip = createRequire(import.meta.url)("adm-zip");
      const tmp = join(OUT, ".chs-tmp");
      new AdmZip(zipPath).extractAllTo(tmp, true);
      const inner = join(tmp, `chrome-headless-shell-${cftPlatform}`);
      cpSync(inner, join(OUT, "chrome-headless-shell"), { recursive: true });
      if (process.platform !== "win32") {
        chmodSync(join(OUT, "chrome-headless-shell", "chrome-headless-shell"), 0o755);
      }
      rmSync(zipPath, { force: true });
      rmSync(tmp, { recursive: true, force: true });
      console.log("staged chrome-headless-shell");
    } catch (error) {
      console.error(`chrome-headless-shell staging failed: ${error}`);
      console.error(
        "set MODUS_SKIP_CHROMIUM_DOWNLOAD=1 to skip, or MODUS_CHROMIUM_PATH at runtime",
      );
      process.exit(1);
    }
  }
}
