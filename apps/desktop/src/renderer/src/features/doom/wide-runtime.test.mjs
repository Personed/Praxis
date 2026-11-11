import assert from "node:assert/strict";
import { test } from "vitest";

const protocol = await import("./wide-protocol.ts").catch(() => ({}));
test("render size preserves actual host aspect within the GPU budget", () => {
  assert.equal(typeof protocol.renderSize, "function");
  for (const [w, h] of [
    [1560, 835],
    [1100, 535],
    [2560, 1080],
    [800, 900],
  ]) {
    const s = protocol.renderSize(w, h);
    assert.ok(s.width <= 1600 && s.height <= 1000);
    assert.ok(Math.abs(s.width / s.height - w / h) < 0.01);
  }
});
test("GLFW input is translated into real DOM keyboard fields", () => {
  assert.equal(typeof protocol.keyboardInput, "function");
  assert.deepEqual(protocol.keyboardInput(87), {
    code: "KeyW",
    key: "w",
    keyCode: 87,
    which: 87,
    location: 0,
  });
  assert.equal(protocol.keyboardInput(340).keyCode, 16);
  assert.equal(protocol.keyboardInput(32).code, "Space");
  assert.equal(protocol.keyboardInput(999), null);
});
test("startup selects shareware level, widescreen, freelook, WASD and silence", () => {
  assert.equal(typeof protocol.startupArguments, "function");
  const args = protocol.startupArguments({ width: 1440, height: 800 });
  assert.ok(args.includes("/DOOM1.WAD"));
  assert.ok(args.includes("-nosound"));
  assert.ok(args.includes("-nomusic"));
  assert.ok(args.includes("e1m1"));
  const pair = (a, b) => args.some((v, i) => v === a && args[i + 1] === b);
  assert.ok(pair("+freelook", "1"));
  assert.ok(pair("+vid_aspect", "0"));
  assert.ok(pair("+vid_defwidth", "1440"));
  assert.ok(pair("+vid_defheight", "800"));
});

const { loadDoomRuntime } = await import("./runtime.ts");
function environment(t, { ready = true, transferError = false } = {}) {
  const originals = new Map();
  const set = (key, value) => {
    originals.set(key, globalThis[key]);
    globalThis[key] = value;
  };
  const hadJspi = Object.hasOwn(WebAssembly, "Suspending");
  const jspi = WebAssembly.Suspending;
  Object.defineProperty(WebAssembly, "Suspending", { value: class {}, configurable: true });
  t.onTestFinished(() => {
    for (const [key, value] of originals) globalThis[key] = value;
    if (hadJspi)
      Object.defineProperty(WebAssembly, "Suspending", { value: jspi, configurable: true });
    else delete WebAssembly.Suspending;
  });
  const workers = [],
    observers = [],
    urls = [];
  class FakeWorker {
    messages = [];
    terminated = 0;
    constructor() {
      workers.push(this);
    }
    postMessage(message) {
      this.messages.push(message);
      if (message.type === "boot" && ready)
        queueMicrotask(() => this.onmessage?.({ data: { type: "game-ready" } }));
    }
    terminate() {
      this.terminated++;
    }
  }
  class Observer {
    constructor(fn) {
      this.fn = fn;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  const canvas = {
    width: 0,
    height: 0,
    setAttribute() {},
    remove() {
      this.removed = true;
    },
    transferControlToOffscreen() {
      if (transferError) throw Error("transfer failed");
      return {};
    },
  };
  set("OffscreenCanvas", class {});
  set("Worker", FakeWorker);
  set("ResizeObserver", Observer);
  set("document", { createElement: () => canvas });
  set("fetch", async (url) => {
    urls.push(url);
    return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer };
  });
  const host = { clientWidth: 1440, clientHeight: 800, append() {} };
  return { host, canvas, workers, observers, urls };
}
test("wide runtime releases inputs, pauses, resizes and terminates once", async (t) => {
  const f = environment(t);
  const r = await loadDoomRuntime(f.host, new AbortController().signal);
  const w = f.workers[0];
  assert.ok(f.urls.includes("/doom/game/DOOM1.WAD"));
  assert.equal(w.messages[0].pinW, 1440);
  assert.match(new TextDecoder().decode(w.messages[0].files["/nexo.ini"]), /pause=pause/);
  r.resume();
  r.keyEvent(87, true);
  r.mouseButton(0, true);
  r.mouseMotion(24, -40);
  r.pause();
  assert.ok(
    w.messages.some((m) => m.type === "input" && m.evType === "keyup" && m.init.code === "KeyW"),
  );
  assert.ok(w.messages.some((m) => m.type === "input" && m.evType === "mouseup"));
  assert.ok(w.messages.some((m) => m.type === "input" && m.init.movementY === -40));
  assert.equal(w.messages.filter((m) => m.type === "suspend").at(-1).paused, true);
  f.host.clientWidth = 1200;
  f.observers[0].fn();
  assert.equal(w.messages.at(-1).width, 1200);
  await r.dispose();
  await r.dispose();
  const count = w.messages.length;
  r.resume();
  r.mouseMotion(1, 1);
  assert.equal(w.terminated, 1);
  assert.equal(w.messages.length, count);
  assert.ok(f.canvas.removed);
  assert.ok(f.observers[0].disconnected);
});
test("aborted startup rejects and tears down the pending worker", async (t) => {
  const f = environment(t, { ready: false });
  const controller = new AbortController();
  const pending = loadDoomRuntime(f.host, controller.signal);
  for (let i = 0; i < 10 && !f.workers.length; i++) await Promise.resolve();
  assert.equal(f.workers.length, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(f.workers[0].terminated, 1);
  assert.ok(f.canvas.removed);
});
test("Offscreen transfer failure does not leak the worker or a rejected boot promise", async (t) => {
  const f = environment(t, { transferError: true });
  await assert.rejects(loadDoomRuntime(f.host, new AbortController().signal), /transfer failed/);
  assert.equal(f.workers[0].terminated, 1);
});

test("fatal errors after ready terminate the game and notify the home once", async (t) => {
  const f = environment(t);
  const errors = [];
  await loadDoomRuntime(f.host, new AbortController().signal, (message) => errors.push(message));
  f.workers[0].onmessage({ data: { type: "abort", reason: "GL lost" } });
  f.workers[0].onerror();
  assert.equal(f.workers[0].terminated, 1);
  assert.ok(f.canvas.removed);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /GL lost/);
});

test("worker freezes engine time during a long pause and rebases it on resume", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  let now = 1000;
  const inputs = [],
    messages = [];
  const context = {
    importScripts() {},
    performance: { now: () => now },
    fg: { total: 0 },
    PIN_W: 0,
    PIN_H: 0,
    documentShim: { documentElement: {} },
    handleInput: (e) => inputs.push(e),
    self: { onmessage: (e) => messages.push(e.data), postMessage() {} },
  };
  runInNewContext(
    await readFile(new URL("../../../public/doom/gzdoom/nexo.worker.js", import.meta.url), "utf8"),
    context,
  );
  context.self.postMessage({ type: "log", msg: "E1M1: Hangar" });
  context.fg.total = 3;
  context.self.postMessage({ type: "frame-stats", totalFrames: 3 });
  context.fg.total = 5;
  const sleeping = context.self.nexoWaitForResume();
  now = 61000;
  assert.equal(context.self.nexoNow(), 1000);
  context.self.onmessage({ data: { type: "suspend", paused: false } });
  await sleeping;
  assert.equal(context.self.nexoNow(), 1000);
  now += 20;
  assert.equal(context.self.nexoNow(), 1020);
  assert.deepEqual(
    inputs.map((e) => e.evType),
    ["keydown", "keyup", "keydown", "keyup"],
  );
  context.self.onmessage({ data: { type: "suspend", paused: true } });
  context.fg.total += 2;
  const pausedAgain = context.self.nexoWaitForResume();
  now += 5000;
  context.self.onmessage({ data: { type: "resize", width: 1200, height: 700 } });
  await pausedAgain;
  assert.equal(context.self.nexoNow(), 1020);
  assert.equal(context.PIN_W, 1200);
  assert.equal(messages.at(-1).height, 700);
});

test("a later pause cancels a deferred resume before the frame boundary", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const inputs = [];
  const context = {
    importScripts() {},
    performance: { now: () => 1000 },
    fg: { total: 0 },
    handleInput: (e) => inputs.push(e),
    self: { onmessage() {}, postMessage() {} },
  };
  runInNewContext(
    await readFile(new URL("../../../public/doom/gzdoom/nexo.worker.js", import.meta.url), "utf8"),
    context,
  );
  context.self.postMessage({ type: "log", msg: "E1M1: Hangar" });
  context.fg.total = 3;
  context.self.postMessage({ type: "frame-stats", totalFrames: 3 });
  context.self.onmessage({ data: { type: "suspend", paused: false } });
  context.self.onmessage({ data: { type: "suspend", paused: true } });
  const before = inputs.length;
  context.fg.total = 5;
  context.self.nexoWaitForResume();
  assert.equal(inputs.length, before, "the latest pause must not synthesize an unpause key");
});
