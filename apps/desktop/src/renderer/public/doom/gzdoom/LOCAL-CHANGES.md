# Nexo integration

Upstream tomb-engine commit 6c735315b8ac1b1dd6646ac78c46bbbdbb775a5c, wrapping GZDoom g4.11.3. GPL-3.0; see UPSTREAM-LICENSE and UPSTREAM-README.md. Original sources/build patch recipe: https://github.com/mungus43/tomb-engine/tree/6c735315b8ac1b1dd6646ac78c46bbbdbb775a5c and https://github.com/ZDoom/gzdoom/tree/g4.11.3 .

- gzdoom.wasm and support PK3s are unchanged upstream binaries.
- gzdoom.js: emscripten_sleep awaits self.nexoWaitForResume before its original timer. This lets the worker suspend at a JSPI yield without spinning while paused. emscripten_get_now uses nexoNow, rebased by frozenDuration so paused wall-clock time never becomes catch-up game tics.
- engine.worker.js: telemetry pump reduced to a frame count for startup readiness; renderer, input shims and resize protocol remain upstream.
- nexo.worker.js is our wrapper: waits for E1M1 and presented frames; pauses simulation through the engine Pause key and then suspends yields; resumes explicitly; updates the backbuffer pin and redraws on resize while simulation stays paused.
- Main adapter and bindings are in src/features/doom/runtime.ts and wide-protocol.ts. Audio/multiplayer are disabled. No user config, URL, remote WAD or arbitrary command comes from the UI.

The original shareware DOOM1.WAD is unchanged and its distribution notices are preserved in ../game. Registered DOOM/DOOM2 files and FreeDM are not included by this integration.

## Modus home integration (2026-11-08)

The wrapper now announces game-ready after both initial pause frames have completed.
A resume arriving before those frames is deferred until the pause boundary, preventing
coalesced Pause key presses from leaving the engine paused. Engine WASM is unchanged.

A later pause also cancels any resume deferred at the pause boundary.
