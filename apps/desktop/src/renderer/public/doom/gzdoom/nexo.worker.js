// Nexo integration for pinned tomb-engine. See LOCAL-CHANGES.md.
importScripts("engine.worker.js");
const upstreamMessage = self.onmessage;
const upstreamPost = self.postMessage.bind(self);
let gameReady = false;
let readyNotified = false;
let resumeRequested = false;
let levelFrame = null;
let paused = false;
let freezeAt = Infinity;
let wake = null;
let frozenAt = null;
let frozenDuration = 0;
self.nexoNow = () => (frozenAt === null ? performance.now() : frozenAt) - frozenDuration;
function thaw() {
  if (frozenAt !== null) {
    frozenDuration += performance.now() - frozenAt;
    frozenAt = null;
  }
  if (wake) {
    const resolve = wake;
    wake = null;
    resolve();
  }
}
function pauseKey() {
  for (const evType of ["keydown", "keyup"])
    handleInput({
      type: "input",
      target: "window",
      evType,
      init: {
        code: "Pause",
        key: "Pause",
        keyCode: 19,
        which: 19,
        bubbles: true,
        cancelable: true,
      },
    });
}
function setPaused(next) {
  resumeRequested = false;
  if (!gameReady || paused === next) return;
  paused = next;
  pauseKey();
  freezeAt = next ? fg.total + 2 : Infinity;
  if (!next) thaw();
}
self.nexoWaitForResume = () => {
  if (resumeRequested && fg.total >= freezeAt) setPaused(false);
  if (!paused || fg.total < freezeAt) return Promise.resolve();
  frozenAt = performance.now();
  return new Promise((resolve) => {
    wake = resolve;
  });
};
self.postMessage = (message, transfers) => {
  if (message.type === "log" && /E1M1\s*[:-]/i.test(message.msg || "")) levelFrame = fg.total;
  if (
    !gameReady &&
    levelFrame !== null &&
    message.type === "frame-stats" &&
    message.totalFrames >= levelFrame + 3
  ) {
    gameReady = true;
    setPaused(true);
  }
  // Acknowledge after both pause frames; otherwise a fast resume coalesces
  // both Pause key presses in one engine tic and leaves the game paused.
  if (
    gameReady &&
    !readyNotified &&
    message.type === "frame-stats" &&
    message.totalFrames >= freezeAt
  ) {
    readyNotified = true;
    upstreamPost({ type: "game-ready" });
  }
  // Diagnostics stay in the worker; no continuous telemetry allocations on the UI thread.
  if (message.type !== "frame-stats") upstreamPost(message, transfers || []);
};
self.onmessage = (event) => {
  const m = event.data;
  if (m.type === "suspend") {
    if (!m.paused && paused && fg.total < freezeAt) resumeRequested = true;
    else setPaused(m.paused);
    return;
  }
  if (m.type === "resize") {
    PIN_W = m.width;
    PIN_H = m.height;
    documentShim.documentElement.clientWidth = PIN_W;
    documentShim.documentElement.clientHeight = PIN_H;
    // Redraw the resized buffer while keeping the game simulation paused.
    if (paused) {
      freezeAt = fg.total + 2;
      thaw();
    }
  }
  upstreamMessage(event);
};
