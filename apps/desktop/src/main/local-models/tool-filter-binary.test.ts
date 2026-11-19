import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { toolFilterBinPath } from "./startup";
import { spawnBinaryModelProcess, ToolFilterHost } from "./tool-filter-host";

/**
 * Integration test for the Rust modus-tool-filter worker (crates/modus-tool-filter):
 * the same protocol as the JS worker, over stdio JSON lines. Skipped when no
 * binary is built (`cargo build --release -p modus-tool-filter`).
 */

const bin =
  process.env.MODUS_TOOL_FILTER_BIN ??
  join(
    fileURLToPath(new URL(".", import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "..",
    "target",
    "release",
    process.platform === "win32" ? "modus-tool-filter.exe" : "modus-tool-filter",
  );

const itWithBinary = existsSync(bin) ? it : it.skip;

describe("modus-tool-filter Rust worker", () => {
  itWithBinary(
    "answers probe, ping and stats over stdio JSON",
    async () => {
      const host = new ToolFilterHost({
        spawn: () => spawnBinaryModelProcess(bin),
        idleMs: 60_000,
      });
      try {
        await host.probe();
        await host.ping();
        expect(await host.stats()).toBeGreaterThan(0);
      } finally {
        host.release();
      }
    },
    60_000,
  );

  itWithBinary("toolFilterBinPath finds the dev cargo build", () => {
    expect(toolFilterBinPath()).toBe(bin);
  });
});
