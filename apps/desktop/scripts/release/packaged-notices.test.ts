import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Tauri resolves bundle.resources paths against src-tauri (its cwd), three
// levels up from this test file.
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tauriDir = join(desktopDir, "src-tauri");
const repoRoot = resolve(desktopDir, "../..");

const bundleResources = (
  JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8")) as {
    bundle: { resources: Record<string, string> };
  }
).bundle.resources;

function resourceFrom(to: string): string | undefined {
  return Object.entries(bundleResources).find(([, target]) => target === to)?.[0];
}

describe("packaged license notices", () => {
  // MIT (Agent Elements) requires the notice in every copy, so the packaged app ships
  // the repo-root files next to resources/licenses.
  it.each([
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
  ])("ships the repo-root %s at the top of the app resources", (file) => {
    const from = resourceFrom(file);
    expect(from).toBeDefined();
    const resolved = resolve(tauriDir, from ?? "");
    expect(resolved).toBe(join(repoRoot, file));
    expect(readFileSync(resolved, "utf8").length).toBeGreaterThan(0);
  });

  it("keeps shipping the vendored MIT licenses directory", () => {
    expect(resourceFrom("licenses")).toBe("../resources/licenses");
  });
});
