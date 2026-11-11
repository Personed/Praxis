import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("announces readiness only after the initial pause has settled", () => {
  const messages: { type: string }[] = [];
  const context = {
    importScripts() {},
    performance: { now: () => 1000 },
    fg: { total: 0 },
    handleInput() {},
    self: { onmessage() {}, postMessage: (message: { type: string }) => messages.push(message) },
  };
  runInNewContext(
    readFileSync(new URL("../../../public/doom/gzdoom/nexo.worker.js", import.meta.url), "utf8"),
    context,
  );
  context.self.postMessage({ type: "log", msg: "E1M1: Hangar" } as never);
  context.fg.total = 3;
  context.self.postMessage({ type: "frame-stats", totalFrames: 3 } as never);
  expect(messages.some(({ type }) => type === "game-ready")).toBe(false);
  context.fg.total = 5;
  context.self.postMessage({ type: "frame-stats", totalFrames: 5 } as never);
  expect(messages.filter(({ type }) => type === "game-ready")).toHaveLength(1);
});
