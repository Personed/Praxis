import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Linux worker packaging contract", () => {
  it("builds and bundles the fixed supervisor and worker binaries together", () => {
    const workspace = source("../../../Cargo.toml");
    const buildScript = source("./build-plugin-supervisor.mjs");
    const stageScript = source("./stage-bundle-bin.mjs");
    const ciWorkflow = source("../../../.github/workflows/ci.yml");
    const releaseWorkflow = source("../../../.github/workflows/release.yml");

    expect(workspace).toContain('"crates/plugin-execution-worker"');
    expect(buildScript).toContain('"modus-plugin-execution-worker"');
    expect(buildScript).toContain('"modus-plugin-worker"');
    expect(stageScript).toContain("modus-plugin-execution-supervisor");
    expect(stageScript).toContain("modus-plugin-worker");
    expect(ciWorkflow).toContain("cargo test --locked -p modus-plugin-execution-worker");
    expect(ciWorkflow).toContain(
      "-p modus-plugin-execution-supervisor -p modus-plugin-execution-worker",
    );
    expect(releaseWorkflow).toContain("@modus/desktop run build");
    expect(releaseWorkflow).toContain("stage-bundle-bin.mjs");
  });
});
