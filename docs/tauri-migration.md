# Electron → Tauri 3 Migration — Status & Architecture

Decision (2026-11-19): migrate Electron → **Tauri 3** (3.0.0-alpha.6, dist-tag `next`). Keep the React renderer. Branch: `devin/tauri3-migration`.

## Target architecture

```
Tauri 3 shell (Rust)          Node sidecar (TS, Electron-free)
  window + webview     <-->   services currently in src/main/*
        |   ws/json-rpc  (invoke = ipcMain.handle channel, events = webContents.send)
        |
  renderer (React) — window.modus = createModusApi(wsTransport)
```

- `src/preload/index.ts` exports `createModusApi(t: ModusTransport)` — transport-agnostic. Electron entry keeps working unchanged.
- `src/preload/transport.ts` defines `ModusTransport {invoke, on, removeListener, env}`.
- Sidecar gets an `electron` shim module (alias at bundle time) implementing the real used surface: `app`, `BrowserWindow`, `WebContents`/`WebContentsView`, `ipcMain`, `dialog`, `shell`, `safeStorage`, `nativeTheme`, `powerMonitor`, `net`, `protocol`, `screen`, `clipboard`, `Menu`, `Notification`, `utilityProcess`, `Debugger`, `nativeImage`, `Session`.
- Renderer shim: `src/renderer/src/tauri/modus-shim.ts` installs real `createModusApi(wsTransport)` when `window.__MODUS_RPC__` is injected; falls back to stubs otherwise.
- Tauri spawn: Rust spawns sidecar with MODUS_RPC_PORT+TOKEN; renderer discovers via injected `window.__MODUS_RPC__`.

## Done

- Tauri 3 scaffold: `apps/desktop/src-tauri/` (member of root Cargo workspace), `tauri.conf.json` identifier `dev.modus.desktop`.
- Standalone renderer build: `vite.renderer.config.ts` → `out/renderer-web`; scripts `build:renderer-web`, `dev:renderer-web`, `dev:tauri`, `build:tauri`.
- Renderer boots inside Tauri/WebKitGTK (Doom easter egg renders). Needed: `requestIdleCallback` polyfill (WebKitGTK lacks it) + `window.modus` stub.
- `createModusApi` transport refactor (typecheck+biome clean); split into `src/preload/api.ts` (Electron-free) + `src/preload/index.ts` (Electron entry).
- `src/sidecar/`: `electron-shim.ts` (~640 lines: app/BrowserWindow/WebContents/ipcMain/dialog/shell/safeStorage/nativeTheme/powerMonitor/net/protocol/screen/clipboard/Menu/Notification/utilityProcess→spawn), `rpc.ts` (RFC6455 WS server, `?token=` auth, invoke/event messages), `index.ts` (boot mirroring main/index.ts: registerTrustedSender, openDatabaseAtStartup, registerAppIpc, automation service; prints `MODUS_RPC_READY <port>`).
- `src/renderer/src/tauri/ws-transport.ts`: `createWsTransport()` — WebSocket JSON-RPC client with reconnect; `__modus_undefined` sentinel preserves `undefined` args across JSON.
- Tauri `lib.rs`: `spawn_sidecar()` (reads `MODUS_RPC_READY`, drains stdout to `[sidecar]` log), `serve_frontend()` (tiny_http static server on `127.0.0.1:0` — required because `tauri://` is opaque in WebKitGTK and CSP/`dangerous_use_http_scheme` doesn't cover Linux), window `WebviewUrl::External(http://127.0.0.1:<port>/)`, init script injects `__MODUS_RPC__`+`__MODUS_ENV__`.
- **End-to-end working**: renderer → ws://127.0.0.1/?token → sidecar → real services (agent:list, workspaces, model settings all resolve).
- **Remote browser working**: `src/sidecar/chromium.ts` (ChromiumManager: finds chrome/chromium binary or `MODUS_CHROMIUM_PATH`, spawns `--headless=new --remote-debugging-port=0`, one `Target.createBrowserContext` per workspace partition); `src/sidecar/remote-view.ts` (`RemoteWebContentsView`/`RemoteWebContents`/`RemoteDebugger`/`RemoteSession` over `src/sidecar/cdp-client.ts`); shim `WebContentsView` = the remote view. Pixels: `Page.startScreencast` → `browser:frame` WS events → `RemoteBrowserSurface` canvas in `BrowserPanel`. Input: `browser:input` channel → `dispatchBrowserInput` → `Input.dispatchMouseEvent/dispatchKeyEvent`. Verified end-to-end via `/tmp/smoke-browser.mjs` (create-tab → show → JPEG frames arrive).

## Remaining (order)
4. Replace Electron-only features: `electron-updater` → tauri-plugin-updater, `safeStorage` → keychain/keyring, `utilityProcess` (tool-filter-worker) → child_process.fork, `protocol.handle` (doom scheme) → tauri custom protocol, dialogs → tauri-plugin-dialog, `nativeTheme`, `powerMonitor`, app menu (`application-menu`), `shell.open*`, notifications.
5. Port-to-Rust candidates (later, flag by flag): PTY (crates/pty-host exists), SQLite, ONNX tool filter, codegraph.
6. Remove Electron: drop electron/electron-vite/electron-builder deps, `src/main/index.ts`+preload electron entry, electron.vite.config.ts, electron-builder.config.ts, workflows packaging.

## Gotchas discovered

- **CSP meta blocks the WS transport**: `index.html` `connect-src` allowed only `ws://localhost:*` — `ws://127.0.0.1` threw `SecurityError: The operation is insecure` at `new WebSocket` (pre-network, silent). Fix: added `http://127.0.0.1:* ws://127.0.0.1:* http://[::1]:* ws://[::1]:*` to `connect-src`. Init-script probes bypass the page CSP, so test in page context.
- **JSON drops `undefined`**: `invoke(channel, undefined)` arrives as `null` and fails Zod schemas that accept `undefined` but not `null` (e.g. `agent:list` → "expected object, received null"). Wire format uses `{__modus_undefined:true}` sentinel mapped back server-side.
- `pkill -f 'release/app'` matches the shell's own cmdline — kill by PID from `pgrep -f 'release/app$'` (or bracket trick `'release/ap[p]$'`).
- WebKitGTK: no `requestIdleCallback`; inspector env `WEBKIT_INSPECTOR_SERVER` listens but doesn't serve HTTP in release; use `tauri dev` for devtools.
- Root Cargo workspace required adding `apps/desktop/src-tauri` to `members`.
- Bundle identifier must not end in `.app`.
- `window.modus.app.appearance`/`uiLanguage` are objects `{initial,get,set,onChange}`, not scalars; `model.settings()` must return `{providers:[],models:[]}`.
