import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_REPO } from "./release-repo";

describe("RELEASE_REPO", () => {
  it("is the repository this fork ships updates from", () => {
    expect(RELEASE_REPO).toEqual({ owner: "Personed", repo: "Praxis" });
  });

  it("matches the Tauri updater endpoint", () => {
    const tauriConfig = JSON.parse(
      readFileSync(join(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
    ) as { plugins: { updater: { endpoints: string[] } } };
    for (const endpoint of tauriConfig.plugins.updater.endpoints) {
      expect(endpoint).toContain(`github.com/${RELEASE_REPO.owner}/${RELEASE_REPO.repo}/`);
    }
  });
});
