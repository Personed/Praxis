import assert from "node:assert/strict";
import { test } from "vitest";

const { createDoomInputController } = await import("./input-controller.ts").catch(() => ({}));
test("input controller exists", () => assert.equal(typeof createDoomInputController, "function"));
function setup() {
  const doc = new EventTarget();
  doc.pointerLockElement = null;
  doc.hidden = false;
  const win = new EventTarget();
  const host = new EventTarget();
  host.clientWidth = 1000;
  host.clientHeight = 600;
  let requests = 0,
    focus = 0,
    paused = 0,
    resumed = 0,
    released = 0,
    disposed = 0;
  host.requestPointerLock = () => {
    requests++;
    return Promise.resolve();
  };
  doc.exitPointerLock = () => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event("pointerlockchange"));
  };
  const errors = [],
    states = [],
    keys = [],
    moves = [];
  const runtime = {
    pause() {
      paused++;
    },
    resume() {
      resumed++;
    },
    releaseInputs() {
      released++;
    },
    keyEvent: (...a) => keys.push(a),
    mouseMotion: (...a) => moves.push(a),
    mouseButton() {},
    async dispose() {
      disposed++;
    },
  };
  const c = createDoomInputController({
    host,
    returnFocus: () => {
      focus++;
    },
    onStatus: (s) => states.push(s),
    onError: (e) => errors.push(e),
    environment: { document: doc, window: win },
  });
  const lock = () => {
    doc.pointerLockElement = host;
    doc.dispatchEvent(new Event("pointerlockchange"));
  };
  const key = (code, ctrlKey = false) => {
    const e = new Event("keydown", { cancelable: true });
    Object.assign(e, { code, ctrlKey, repeat: false });
    doc.dispatchEvent(e);
    return e;
  };
  return {
    c,
    doc,
    win,
    host,
    runtime,
    lock,
    key,
    keys,
    moves,
    errors,
    states,
    get stats() {
      return { requests, focus, paused, resumed, released, disposed };
    },
  };
}
test("captures in the gesture then resumes only once lock and runtime exist", () => {
  const f = setup();
  f.c.activateFromGesture();
  assert.equal(f.stats.requests, 1);
  f.c.attachRuntime(f.runtime);
  assert.equal(f.stats.resumed, 0);
  f.lock();
  assert.equal(f.stats.resumed, 1);
  f.c.dispose();
});
test("native Escape unlock pauses and restores composer focus without intercepting Escape", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  f.key("KeyW");
  assert.equal(f.key("Escape").defaultPrevented, false);
  f.doc.exitPointerLock();
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.stats.focus, 1);
  assert.ok(f.stats.released > 0);
  assert.deepEqual(f.keys, [[87, true]]);
  f.c.dispose();
});
test("native unlock during boot cancels pending resume; next click continues same runtime", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.doc.exitPointerLock();
  f.c.attachRuntime(f.runtime);
  assert.equal(f.stats.resumed, 0);
  f.c.activateFromGesture();
  f.lock();
  assert.equal(f.stats.resumed, 1);
  f.c.dispose();
});
test("blur pauses, disposes listeners and ignores late runtime after cleanup", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  f.win.dispatchEvent(new Event("blur"));
  assert.equal(f.doc.pointerLockElement, null);
  f.c.dispose();
  f.lock();
  assert.equal(f.key("KeyX", true).defaultPrevented, false);
  f.c.attachRuntime(f.runtime);
  assert.equal(f.stats.resumed, 1);
});
test("denied pointer lock reports a recoverable error", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.doc.dispatchEvent(new Event("pointerlockerror"));
  assert.equal(f.errors.length, 1);
  f.c.activateFromGesture();
  assert.equal(f.stats.requests, 2);
  f.c.dispose();
});
test("WebView events with empty code still move and preserve native Escape", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  const e = new Event("keydown", { cancelable: true });
  Object.assign(e, { code: "", key: "w", ctrlKey: false, repeat: false });
  f.doc.dispatchEvent(e);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(f.keys, [[87, true]]);
  f.doc.exitPointerLock();
  assert.equal(f.stats.focus, 1);
  f.c.dispose();
});
test("Ctrl+X is no longer an unlock shortcut and preserves cut outside the game", () => {
  const f = setup();
  assert.equal(f.key("KeyX", true).defaultPrevented, false);
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  f.key("KeyX", true);
  assert.equal(f.doc.pointerLockElement, f.host);
  assert.equal(f.stats.focus, 0);
  f.c.dispose();
});
test("mouse aim forwards both relative axes independent of viewport", () => {
  const f = setup();
  const move = () => {
    const e = new Event("mousemove");
    Object.assign(e, { movementX: 24, movementY: 40 });
    f.doc.dispatchEvent(e);
  };
  move();
  assert.equal(f.moves.length, 0);
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  move();
  f.host.clientWidth = 1600;
  move();
  assert.deepEqual(f.moves, [
    [24, 40],
    [24, 40],
  ]);
  f.c.dispose();
  move();
  assert.equal(f.moves.length, 2);
});
test("left and right arrows strafe instead of turning the aim", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  f.key("ArrowLeft");
  f.key("ArrowRight");
  assert.deepEqual(f.keys, [
    [65, true],
    [68, true],
  ]);
  f.c.dispose();
});

test("Escape explicitly releases capture without cancelling its browser default", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  assert.equal(f.key("Escape").defaultPrevented, false);
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.stats.focus, 1);
  f.c.dispose();
});

test("a replacement runtime resumes even when capture was reacquired after a fatal error", () => {
  const f = setup();
  f.c.activateFromGesture();
  f.lock();
  f.c.attachRuntime(f.runtime);
  f.c.suspend();
  f.c.activateFromGesture();
  f.lock();
  let resumed = 0;
  const replacement = {
    ...f.runtime,
    resume() {
      resumed++;
    },
  };
  f.c.attachRuntime(replacement);
  assert.equal(resumed, 1);
  f.c.dispose();
});
