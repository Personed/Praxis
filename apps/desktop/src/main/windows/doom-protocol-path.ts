import { isAbsolute, relative, resolve, sep } from "node:path";

/** Only the isolated game page, its Vite chunks and its runtime assets are public. */
export function resolveDoomAsset(raw: string, root: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "modus-game:" || url.host !== "home" || url.username || url.password)
      return;
    const path = decodeURIComponent(url.pathname);
    if (/[\\\0:]/.test(path)) return;
    if (path.split("/").some((part) => part === "." || part === "..")) return;
    if (path !== "/doom.html" && !path.startsWith("/doom/") && !path.startsWith("/assets/")) return;
    const file = resolve(root, `.${path}`);
    const inside = relative(root, file);
    if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) return;
    return file;
  } catch {
    return;
  }
}
