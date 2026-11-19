/**
 * Tauri migration shim: installs a stub `window.modus` when the renderer runs
 * inside a Tauri webview (no Electron preload), so the UI can boot before the
 * real Tauri command bridge exists. Methods return inert values; scalar reads
 * needed at startup live in `appBacking`.
 *
 * Replace per-namespace with real `invoke()` wiring as services are ported.
 */

import { createModusApi } from "../../../preload/api";
import { createWsTransport } from "./ws-transport";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function stubFor(path: string): unknown {
  const fn = () => {};
  return new Proxy(fn, {
    get(_target, prop) {
      // Keep the proxy non-thenable so `await`/`Promise.all` treat it as a value.
      if (prop === "then") return undefined;
      if (prop === Symbol.toPrimitive) return () => "";
      return stubFor(`${path}.${String(prop)}`);
    },
    apply() {
      const leaf = path.split(".").pop() ?? "";
      // Event subscriptions return an unsubscribe function.
      if (leaf.startsWith("on")) {
        return () => () => {};
      }
      // Collection getters resolve to empty lists to keep reducers safe.
      if (/^(list|getAll|enumerate|search|query|recent)/i.test(leaf)) {
        return Promise.resolve([]);
      }
      // Everything else resolves to an empty object so field reads don't throw.
      return Promise.resolve({});
    },
  });
}

// Scalar/object state the renderer reads synchronously during first paint.
const noopUnsub = () => () => {};
const appBacking: Record<string, unknown> = {
  windowChrome: "system",
  nativeGlass: false,
  isNativeGlassAvailable: () => false,
  onNativeGlassChange: noopUnsub,
  // Object-valued bridges the renderer treats as { initial, get, set, onChange }.
  uiLanguage: {
    initial: { preference: "system", intlLocale: "en", language: "en" },
    get: () => Promise.resolve({ preference: "system", intlLocale: "en", language: "en" }),
    set: () => Promise.resolve(undefined),
    onChange: noopUnsub,
  },
  appearance: {
    initial: null,
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(null),
    onChange: noopUnsub,
  },
};

// Dev-only: surface webview errors on-page since release builds have no devtools.
function installErrorOverlay(): void {
  const box = document.createElement("pre");
  box.id = "tauri-error-overlay";
  box.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:99999;max-width:70%;max-height:40%;" +
    "overflow:auto;background:rgba(0,0,0,.85);color:#f66;font:11px/1.4 monospace;" +
    "padding:8px;border-radius:6px;white-space:pre-wrap;";
  const add = (msg: string) => {
    box.textContent += `${msg}\n`;
    if (!box.parentElement) document.body?.appendChild(box);
  };
  window.addEventListener("error", (e) => add(`[error] ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) =>
    add(`[rejection] ${e.reason instanceof Error ? e.reason.stack : String(e.reason)}`),
  );
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    add(
      `[console.error] ${args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}\n${a.stack ?? ""}` : String(a)))
        .join(" ")}`,
    );
    orig.apply(console, args);
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (box.textContent) document.body?.appendChild(box);
  });
}

// WebKitGTK lacks requestIdleCallback (also missing in Safari/Firefox).
function installIdleCallbackPolyfill(): void {
  if (typeof window.requestIdleCallback === "function") return;
  window.requestIdleCallback = ((cb: IdleRequestCallback) =>
    window.setTimeout(
      () => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
      0,
    )) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = ((id: number) =>
    window.clearTimeout(id)) as typeof window.cancelIdleCallback;
}

export function installModusShim(): void {
  if (!inTauri() || "modus" in window) {
    return;
  }
  installIdleCallbackPolyfill();
  installErrorOverlay();

  // When the Tauri shell injected sidecar connection info, install the real API
  // (synchronously, so first paint reads the real bridges).
  const transport = createWsTransport();
  if (transport) {
    Object.defineProperty(window, "modus", {
      value: createModusApi(transport),
      configurable: true,
    });
    return;
  }

  // A namespace = concrete overrides + stub fallback for everything else.
  const namespace = (name: string, backing: Record<string, unknown>) =>
    new Proxy(backing, {
      get(target, prop) {
        if (prop in target) return target[prop as keyof typeof target];
        return stubFor(`${name}.${String(prop)}`);
      },
    });

  const modelSettings = { providers: [], models: [] };
  const api = new Proxy(
    {
      app: namespace("app", appBacking),
      model: namespace("model", {
        settings: () => Promise.resolve(modelSettings),
        refreshCatalog: () => Promise.resolve(modelSettings),
      }),
    } as Record<string, unknown>,
    {
      get(target, prop) {
        if (prop in target) return target[String(prop)];
        return stubFor(String(prop));
      },
    },
  );

  Object.defineProperty(window, "modus", { value: api, configurable: true });
}

installModusShim();
