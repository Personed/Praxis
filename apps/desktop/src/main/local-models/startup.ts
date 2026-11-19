import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runToolFilterBench } from "./tool-filter-bench";
import { createToolFilterController, type ToolFilterController } from "./tool-filter-controller";
import { spawnBinaryModelProcess, spawnUtilityModelProcess } from "./tool-filter-host";
import { setTurnToolFilter } from "./turn-tool-filter";

/**
 * App startup for local-models/. Creating the controller only reads a small
 * JSON preference and checks the platform: no onnxruntime-node, no tokenizer,
 * no model process in main, ever. tool_filter.enabled is ON by default: on an
 * available machine the model process (Electron utilityProcess) probes
 * onnxruntime, then the weights are verified/downloaded in the background and
 * loaded there. With it off (an explicit user choice) or on an unavailable
 * platform nothing else happens.
 */
let controller: ToolFilterController | null = null;

export function workerModulePath(): string {
  return fileURLToPath(new URL("./tool-filter-worker.js", import.meta.url));
}

/**
 * The Rust modus-tool-filter binary replaces the JS worker when present:
 * MODUS_TOOL_FILTER_BIN, then <resources>/bin (packaged), then target/release
 * (a developer cargo build). The JS worker stays as the fallback path.
 */
export function toolFilterBinPath(): string | null {
  // "off"/"none" opts out of the Rust worker and forces the JS fallback.
  const env = process.env.MODUS_TOOL_FILTER_BIN;
  if (env === "off" || env === "none") return null;
  const exe = process.platform === "win32" ? "modus-tool-filter.exe" : "modus-tool-filter";
  const candidates = [
    env,
    ...(process.resourcesPath ? [join(process.resourcesPath, "bin", exe)] : []),
    // Bundled (out/sidecar): 3 ups is the repo root; source/tests (src/main/local-models): 5.
    join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "target", "release", exe),
    join(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "..",
      "target",
      "release",
      exe,
    ),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return null;
}

export function getToolFilterController(userDataDir: string): ToolFilterController {
  if (!controller) {
    const bin = toolFilterBinPath();
    controller = createToolFilterController({
      userDataDir,
      spawn: () =>
        bin ? spawnBinaryModelProcess(bin) : spawnUtilityModelProcess(workerModulePath()),
    });
    setTurnToolFilter(controller.turnFilter);
  }
  return controller;
}

export function startLocalModels(userDataDir: string): void {
  const tool = getToolFilterController(userDataDir);
  tool.start();
  const bench = Number(process.env.MODUS_TOOL_FILTER_BENCH ?? 0);
  if (bench > 0) void runToolFilterBench(tool, bench);
}

export function stopLocalModels(): void {
  controller?.dispose();
}
