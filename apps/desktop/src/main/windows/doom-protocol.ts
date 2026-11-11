import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol } from "electron";
import { resolveDoomAsset } from "./doom-protocol-path";

export function declareDoomProtocol(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "modus-game",
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

export function registerDoomProtocol(rendererRoot: string): void {
  let dev: URL | undefined;
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    try {
      const url = new URL(process.env.ELECTRON_RENDERER_URL);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.username &&
        !url.password
      )
        dev = url;
    } catch {
      // Invalid development configuration falls back to packaged assets.
    }
  }
  protocol.handle("modus-game", async (request) => {
    const url = new URL(request.url);
    const devModule =
      dev &&
      url.protocol === "modus-game:" &&
      url.host === "home" &&
      !url.username &&
      !url.password &&
      (/^\/src\/features\/doom\/(game-entry\.ts|input-controller(?:\.ts)?|runtime(?:\.ts)?|wide-protocol\.ts|game-frame\.css)$/.test(
        url.pathname,
      ) ||
        ["/@vite/client", "/@vite/env", "/node_modules/vite/dist/client/env.mjs"].includes(
          url.pathname,
        ));
    const file =
      resolveDoomAsset(request.url, rendererRoot) || (devModule ? url.pathname : undefined);
    if (!file || request.method !== "GET") return new Response(null, { status: 404 });
    try {
      if (!dev) {
        const [root, asset] = await Promise.all([realpath(rendererRoot), realpath(file)]);
        const inside = relative(root, asset);
        if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
          return new Response(null, { status: 404 });
        if (!(await stat(asset)).isFile()) return new Response(null, { status: 404 });
      }
      const target = dev ? new URL(url.pathname + url.search, dev).href : pathToFileURL(file).href;
      const response = await net.fetch(target);
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=()",
      );
      if (file.endsWith(".wasm")) headers.set("Content-Type", "application/wasm");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
