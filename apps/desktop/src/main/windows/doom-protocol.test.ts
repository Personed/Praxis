import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDoomAsset } from "./doom-protocol-path";

describe("isolated DOOM asset protocol", () => {
  const root = join(process.cwd(), "out", "renderer");
  it("serves the game entry and its local bundled assets", () => {
    expect(resolveDoomAsset("modus-game://home/doom.html", root)).toBe(join(root, "doom.html"));
    expect(resolveDoomAsset("modus-game://home/doom/gzdoom/gzdoom.wasm", root)).toBe(
      join(root, "doom", "gzdoom", "gzdoom.wasm"),
    );
  });
  it.each([
    "modus-game://other/doom.html",
    "https://home/doom.html",
    "modus-game://home/index.html",
    "modus-game://home/doom/%2e%2e/%2e%2e/package.json",
    "modus-game://home/doom/%5c..%5c..%5cpackage.json",
    "modus-game://home/doom/%00.wasm",
    "modus-game://home/doom/..%2findex.html",
    "modus-game://home/assets/..%2findex.html",
    "modus-game://home/doom/file.wasm:secret",
    "modus-game://user:password@home/doom.html",
    "modus-game://home:123/doom.html",
    "modus-game://home/doom/%zz",
  ])("rejects unrelated origins and paths: %s", (url) => {
    expect(resolveDoomAsset(url, root)).toBeUndefined();
  });
});
