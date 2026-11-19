/**
 * Chromium process manager for the Tauri-mode browser.
 * Spawns one headless Chromium per sidecar; each "tab" (WebContentsView in
 * the shim) is a CDP target in a per-workspace browser context.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpConnection } from "./cdp-client";

const dataRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "modus");

const CANDIDATES = [
  process.env.MODUS_CHROMIUM_PATH,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
].filter((c): c is string => Boolean(c));

export class ChromiumManager {
  private child: ChildProcess | null = null;
  private conn: CdpConnection | null = null;
  private starting: Promise<CdpConnection> | null = null;
  private readonly contexts = new Map<string, string>();
  private readonly browserEventListeners = new Set<
    (event: { method: string; params: Record<string, unknown> }) => void
  >();

  private findBinary(): string | null {
    for (const candidate of CANDIDATES) {
      try {
        const out = execFileSync("which", [candidate], { encoding: "utf8" }).trim();
        if (out) return out;
      } catch {
        // try next
      }
    }
    return null;
  }

  /** Connect to an already-running Chromium whose DevToolsActivePort file is fresh. */
  private adoptRunningBrowser(profileDir: string): Promise<CdpConnection> | null {
    try {
      const [port, wsPath] = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8")
        .split("\n")
        .map((l) => l.trim());
      if (!port || !wsPath) return null;
      return CdpConnection.connect(`ws://127.0.0.1:${port}${wsPath}`).then(
        (conn) => {
          conn.onClose(() => {
            this.conn = null;
            this.contexts.clear();
          });
          conn.onEvent((event) => this.emitBrowserEvent(event));
          void conn.send("Target.setDiscoverTargets", { discover: true }).catch(() => undefined);
          return conn;
        },
        () => {
          throw new Error("unreachable");
        },
      );
    } catch {
      return null;
    }
  }

  /** Remove Singleton* lock files left behind by a crashed/killed Chromium. */
  private clearStaleProfileLock(profileDir: string): void {
    try {
      const lock = join(profileDir, "SingletonLock");
      const target = readlinkSync(lock); // "<hostname>-<pid>"
      const pid = Number(target.split("-").pop());
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          return; // a live Chromium owns this profile
        } catch {
          // dead owner: drop the locks
        }
      }
      for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        rmSync(join(profileDir, name), { force: true });
      }
    } catch {
      // no lock present
    }
  }

  /** Connect (spawn if needed) to the browser-level CDP endpoint. */
  async ensureBrowser(): Promise<CdpConnection> {
    if (this.conn && !this.conn.isClosed) {
      return this.conn;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.start();
    try {
      this.conn = await this.starting;
      return this.conn;
    } finally {
      this.starting = null;
    }
  }

  private start(): Promise<CdpConnection> {
    const profileDir = join(dataRoot, "remote-browser");
    mkdirSync(profileDir, { recursive: true });

    // A Chromium that outlived its sidecar still owns the profile: adopt it via
    // the DevToolsActivePort file instead of fighting the singleton lock.
    const adopted = this.adoptRunningBrowser(profileDir)?.catch(() => null);
    if (adopted) {
      return adopted.then((conn) => conn ?? this.spawnBrowser(profileDir));
    }

    this.clearStaleProfileLock(profileDir);
    return this.spawnBrowser(profileDir);
  }

  private spawnBrowser(profileDir: string): Promise<CdpConnection> {
    const binary = this.findBinary();
    if (!binary) {
      return Promise.reject(
        new Error(
          "No Chromium/Chrome binary found. Set MODUS_CHROMIUM_PATH or install google-chrome.",
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "--headless=new",
          "--remote-debugging-port=0",
          "--remote-debugging-address=127.0.0.1",
          `--user-data-dir=${profileDir}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--hide-crash-restore-bubble",
          "--mute-audio",
          "--disable-features=Translate",
          "--force-device-scale-factor=1",
          "--disable-background-networking",
          "--disable-component-update",
          "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      this.child = child;

      let stderrBuf = "";
      const onExit = (code: number | null) => {
        this.child = null;
        this.conn = null;
        this.contexts.clear();
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `Chromium exited (code ${code ?? "?"}) before DevTools endpoint: ${stderrBuf.slice(-500)}`,
            ),
          );
        }
      };
      child.on("exit", onExit);

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("Timed out waiting for Chromium DevTools endpoint."));
        }
      }, 20_000);

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
        const match = stderrBuf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match && !settled) {
          settled = true;
          clearTimeout(timer);
          const wsUrl = match[1] ?? "";
          CdpConnection.connect(wsUrl).then(
            (conn) => {
              conn.onClose(() => onExit(null));
              conn.onEvent((event) => this.emitBrowserEvent(event));
              void conn
                .send("Target.setDiscoverTargets", { discover: true })
                .catch(() => undefined);
              resolve(conn);
            },
            (error) => reject(error instanceof Error ? error : new Error(String(error))),
          );
        }
      });
    });
  }

  /** BrowserContext per workspace partition (mirrors Electron `persist:` sessions). */
  async browserContextFor(partition: string): Promise<string | undefined> {
    const existing = this.contexts.get(partition);
    if (existing) {
      return existing;
    }
    const conn = await this.ensureBrowser();
    const { browserContextId } = await conn.send<{ browserContextId?: string }>(
      "Target.createBrowserContext",
      {},
    );
    if (browserContextId) {
      this.contexts.set(partition, browserContextId);
      void conn
        .send("Browser.setDownloadBehavior", {
          behavior: "deny",
          ...(browserContextId ? { browserContextId } : {}),
        })
        .catch(() => undefined);
      return browserContextId;
    }
    return undefined;
  }

  onBrowserEvent(
    listener: (event: { method: string; params: Record<string, unknown> }) => void,
  ): () => void {
    this.browserEventListeners.add(listener);
    return () => this.browserEventListeners.delete(listener);
  }

  emitBrowserEvent(event: { method: string; params: Record<string, unknown> }): void {
    for (const listener of this.browserEventListeners) {
      try {
        listener(event);
      } catch {
        // A throwing consumer (e.g. recents FK) must not kill the CDP pump.
      }
    }
  }

  async createTarget(partition: string, url: string): Promise<{ targetId: string }> {
    const conn = await this.ensureBrowser();
    const browserContextId = await this.browserContextFor(partition);
    const { targetId } = await conn.send<{ targetId: string }>("Target.createTarget", {
      url,
      ...(browserContextId ? { browserContextId } : {}),
    });
    return { targetId };
  }

  async attachTarget(targetId: string): Promise<string> {
    const conn = await this.ensureBrowser();
    const { sessionId } = await conn.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    return sessionId;
  }

  async closeTarget(targetId: string): Promise<void> {
    if (!this.conn || this.conn.isClosed) {
      return;
    }
    await this.conn.send("Target.closeTarget", { targetId }).catch(() => undefined);
  }

  connection(): CdpConnection | null {
    return this.conn;
  }

  dispose(): void {
    this.conn?.close();
    try {
      this.child?.kill("SIGKILL");
    } catch {
      // ignore
    }
    this.child = null;
    this.conn = null;
    this.contexts.clear();
  }
}

export const chromiumManager = new ChromiumManager();
