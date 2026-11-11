import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { isPackaged: false },
  handle: vi.fn(),
  fetch: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("electron", () => ({
  app: mocks.app,
  net: { fetch: mocks.fetch },
  protocol: { handle: mocks.handle },
}));
vi.mock("node:fs/promises", () => ({ realpath: mocks.realpath, stat: mocks.stat }));

import { registerDoomProtocol } from "./doom-protocol";

describe("DOOM protocol handler", () => {
  const root = join(process.cwd(), "out", "renderer");
  let handler: (request: Request) => Promise<Response>;
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.app.isPackaged = false;
    vi.stubEnv("ELECTRON_RENDERER_URL", "");
    mocks.realpath.mockImplementation(async (path: string) => path);
    mocks.stat.mockResolvedValue({ isFile: () => true });
    mocks.fetch.mockResolvedValue(new Response("asset"));
    registerDoomProtocol(root);
    const registration = mocks.handle.mock.calls[0];
    if (!registration) throw new Error("DOOM protocol handler was not registered");
    handler = registration[1];
  });

  it("serves WASM with the correct MIME and nosniff", async () => {
    const response = await handler(new Request("modus-game://home/doom/game.wasm"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/wasm");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Permissions-Policy")).toContain("microphone=()");
    expect(await response.text()).toBe("asset");
  });

  it.each([
    "https://evil.example",
    "file:///tmp/dev",
    "http://user@localhost:5173",
    "invalid",
  ])("rejects unsafe dev URL %s", async (url) => {
    vi.stubEnv("ELECTRON_RENDERER_URL", url);
    registerDoomProtocol(root);
    await mocks.handle.mock.calls.at(-1)![1](new Request("modus-game://home/doom.html"));
    expect(mocks.fetch.mock.calls[0]?.[0]).toMatch(/^file:/);
  });

  it("ignores dev configuration when packaged", async () => {
    mocks.app.isPackaged = true;
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
    registerDoomProtocol(root);
    await mocks.handle.mock.calls.at(-1)![1](new Request("modus-game://home/doom.html"));
    expect(mocks.fetch.mock.calls[0]?.[0]).toMatch(/^file:/);
  });

  it("proxies isolated dev HTML, modules and assets with query strings", async () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://localhost:5173");
    registerDoomProtocol(root);
    const serve = mocks.handle.mock.calls.at(-1)![1];
    for (const path of [
      "/doom.html",
      "/src/features/doom/game-entry.ts?t=1",
      "/src/features/doom/runtime",
      "/src/features/doom/game-frame.css",
      "/@vite/client",
      "/node_modules/vite/dist/client/env.mjs",
      "/doom/game/game.wasm",
    ]) {
      mocks.fetch.mockResolvedValueOnce(new Response("asset"));
      expect((await serve(new Request(`modus-game://home${path}`))).status).toBe(200);
      expect(mocks.fetch).toHaveBeenLastCalledWith(`http://localhost:5173${path}`);
    }
    expect((await serve(new Request("modus-game://home/src/main.ts"))).status).toBe(404);
    expect(mocks.realpath).not.toHaveBeenCalled();
  });

  it("rejects symlinks escaping the renderer root before fetching", async () => {
    mocks.realpath.mockImplementation(async (path: string) =>
      path === root ? root : join(root, "..", "secret.wasm"),
    );
    expect((await handler(new Request("modus-game://home/doom/game.wasm"))).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects directories", async () => {
    mocks.stat.mockResolvedValue({ isFile: () => false });
    expect((await handler(new Request("modus-game://home/doom/folder"))).status).toBe(404);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("hides filesystem and fetch errors", async () => {
    mocks.realpath.mockRejectedValueOnce(new Error("private filesystem details"));
    expect((await handler(new Request("modus-game://home/doom.html"))).status).toBe(404);
    mocks.fetch.mockRejectedValueOnce(new Error("private network details"));
    const response = await handler(new Request("modus-game://home/doom.html"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("rejects writes and unrelated paths without filesystem or network access", async () => {
    expect(
      (await handler(new Request("modus-game://home/doom.html", { method: "POST" }))).status,
    ).toBe(404);
    expect((await handler(new Request("modus-game://home/index.html"))).status).toBe(404);
    expect(mocks.realpath).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
