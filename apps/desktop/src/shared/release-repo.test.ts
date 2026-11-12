import { describe, expect, it } from "vitest";
import builderConfig from "../../electron-builder.config";
import { RELEASE_REPO } from "./release-repo";

describe("RELEASE_REPO", () => {
  it("is the renamed GitHub owner with its canonical casing", () => {
    // The account was renamed from stoltembergg-png, which anyone can now register:
    // never point the updater back at it.
    expect(RELEASE_REPO).toEqual({ owner: "Stoltembergg", repo: "modus" });
  });

  it("is the repository electron-builder publishes to (app-update.yml)", () => {
    expect(builderConfig.publish).toMatchObject({
      provider: "github",
      owner: RELEASE_REPO.owner,
      repo: RELEASE_REPO.repo,
    });
  });

  it("edits the Windows executable resources to embed the Modus icon", () => {
    expect(builderConfig.win).toMatchObject({
      icon: "resources/icon.ico",
      signExecutable: false,
    });
    expect(builderConfig.win).not.toHaveProperty("signAndEditExecutable", false);
  });
});
