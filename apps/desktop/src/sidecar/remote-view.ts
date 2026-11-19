/**
 * RemoteWebContentsView: the Electron `WebContentsView` surface backed by a
 * CDP target in the sidecar-managed headless Chromium. Rendering reaches the
 * renderer as `browser:frame` screencast JPEGs; input returns via the
 * `browser:input` IPC channel.
 */
import { EventEmitter } from "node:events";
import { broadcastEvent } from "./bus";
import type { CdpConnection } from "./cdp-client";
import { chromiumManager } from "./chromium";
// eslint-disable-next-line import/no-cycle -- shim imports this module too;
// NativeImage is only touched inside async methods, after both modules init.
import { NativeImage } from "./electron-shim";

type CdpParams = Record<string, unknown>;

const FRAME_CHANNEL = "browser:frame";

export class RemoteSession extends EventEmitter {
  /** Accept-Language captured from onBeforeSendHeaders-style hooks. */
  acceptLanguage = "";
  private userAgent = "";

  constructor(public readonly partition: string) {
    super();
  }
  getUserAgent(): string {
    return this.userAgent;
  }
  setUserAgent(ua: string): void {
    this.userAgent = ua;
  }
  setPermissionRequestHandler(_h: unknown): void {
    // Headless Chromium denies permissions by default — matches the
    // default-deny policy applySessionSecurity installs on Electron.
  }
  setPermissionCheckHandler(_h: unknown): void {
    // same
  }
  setSpellCheckerLanguages(_langs: string[]): void {}
  get availableSpellCheckerLanguages(): string[] {
    return [];
  }
  setDownloadPath(_p: string): void {}
  /** webRequest shim: the locale module installs an Accept-Language hook. */
  webRequest = {
    onBeforeSendHeaders: (
      filterOrFn:
        | { urls: string[] }
        | ((
            details: { requestHeaders?: Record<string, string> },
            cb: (r: { requestHeaders?: Record<string, string> }) => void,
          ) => void),
      listener?: (
        details: { requestHeaders?: Record<string, string> },
        cb: (r: { requestHeaders?: Record<string, string> }) => void,
      ) => void,
    ) => {
      const fn = typeof filterOrFn === "function" ? filterOrFn : listener;
      if (!fn) return;
      // The hook shape used by applySessionLocale only rewrites
      // Accept-Language; intercept and capture the desired header value.
      const fakeRequestHeaders = { "User-Agent": "", "Accept-Language": "" };
      fn({ requestHeaders: fakeRequestHeaders }, (res: unknown) => {
        const headers = (res as { requestHeaders?: Record<string, string> })?.requestHeaders;
        if (headers?.["Accept-Language"]) {
          this.acceptLanguage = headers["Accept-Language"];
        }
      });
    },
    onHeadersReceived(_fn: unknown, _f?: unknown) {},
  };
  clearCache(): Promise<void> {
    return Promise.resolve();
  }
}

export class RemoteDebugger extends EventEmitter {
  private attachedFlag = false;

  constructor(private readonly view: RemoteWebContentsView) {
    super();
  }

  attach(_version?: string): void {
    this.attachedFlag = true;
    void this.view.ensureAttached();
  }

  isAttached(): boolean {
    return this.attachedFlag && this.view.sessionId !== null;
  }

  detach(): void {
    this.attachedFlag = false;
    this.emit("detach");
  }

  async sendCommand(method: string, params: CdpParams = {}, sessionId?: string): Promise<unknown> {
    const conn = this.view.conn();
    const sid = sessionId ?? this.view.sessionId;
    if (!conn || !sid) {
      throw new Error(`CDP not attached for ${method}`);
    }
    return await conn.send(method, params, sid);
  }
}

export class RemoteWebContents extends EventEmitter {
  private static nextId = 1;
  readonly id = RemoteWebContents.nextId++;
  readonly debugger: RemoteDebugger;
  readonly session: RemoteSession;
  private currentUrl = "about:blank";
  private currentTitle = "";
  private loading = false;
  private destroyedFlag = false;
  private devtoolsOpen = false;
  private windowOpenHandler: ((info: { url: string }) => { action: string }) | null = null;
  private navEntries: { url: string; title: string }[] = [];
  private navIndex = -1;
  private isolatedWorlds = new Map<number, number>();

  get mainFrame(): { url: string } {
    return { url: this.currentUrl };
  }

  readonly navigationHistory = {
    getAllEntries: () => this.navEntries,
    canGoBack: () => this.navIndex > 0,
    canGoForward: () => this.navIndex >= 0 && this.navIndex < this.navEntries.length - 1,
    goBack: () => void this.navigateHistory(-1),
    goForward: () => void this.navigateHistory(1),
    clear: () => {
      this.navEntries = [];
      this.navIndex = -1;
    },
    restore: (_e: unknown) => {},
    getActiveIndex: () => this.navIndex,
  };

  constructor(private readonly view: RemoteWebContentsView) {
    super();
    this.session = new RemoteSession(view.partition);
    this.debugger = new RemoteDebugger(view);
  }

  conn(): CdpConnection | null {
    return this.view.conn();
  }

  setWindowOpenHandler(handler: (info: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler;
  }

  /** Called by the view when a popup target opened from this page appears. */
  handleWindowOpen(url: string): "deny" | "allow" {
    const result = this.windowOpenHandler?.({ url }) ?? { action: "deny" };
    return result.action === "allow" ? "allow" : "deny";
  }

  getURL(): string {
    return this.currentUrl;
  }
  getTitle(): string {
    return this.currentTitle;
  }
  isLoading(): boolean {
    return this.loading;
  }
  isDestroyed(): boolean {
    return this.destroyedFlag;
  }
  isDevToolsOpened(): boolean {
    return this.devtoolsOpen;
  }
  openDevTools(_o?: unknown): void {
    this.devtoolsOpen = true;
    this.emit("devtools-opened");
  }
  closeDevTools(): void {
    if (this.devtoolsOpen) {
      this.devtoolsOpen = false;
      this.emit("devtools-closed");
    }
  }
  toggleDevTools(): void {
    if (this.devtoolsOpen) this.closeDevTools();
    else this.openDevTools();
  }

  markLoading(on: boolean): void {
    if (this.loading !== on) {
      this.loading = on;
      this.emit(on ? "did-start-loading" : "did-stop-loading");
      if (!on) this.emit("did-finish-load");
    }
  }

  markNavigated(url: string, title: string, inPage: boolean): void {
    this.currentUrl = url;
    if (title) this.currentTitle = title;
    if (!inPage) {
      this.isolatedWorlds.clear();
      this.navEntries = this.navEntries.slice(0, this.navIndex + 1);
      this.navEntries.push({ url, title: this.currentTitle });
      this.navIndex = this.navEntries.length - 1;
      this.emit("did-navigate", { url });
    } else {
      const entry = this.navEntries[this.navIndex];
      if (entry) entry.url = url;
      this.emit("did-navigate-in-page", { url });
    }
    if (title) this.emit("page-title-updated", { title });
  }

  markTitle(title: string): void {
    if (title && title !== this.currentTitle) {
      this.currentTitle = title;
      this.emit("page-title-updated", { title });
    }
  }

  markFavicons(favicons: string[]): void {
    this.emit("page-favicon-updated", {}, favicons);
  }

  pushConsoleMessage(entry: {
    level: number;
    message: string;
    sourceId?: string;
    lineNumber: number;
  }): void {
    this.emit("console-message", {
      level: entry.level,
      message: entry.message,
      sourceId: entry.sourceId ?? "",
      lineNumber: entry.lineNumber,
    });
  }

  emitFindResult(result: {
    matches: number;
    activeMatchOrdinal: number;
    finalUpdate: boolean;
  }): void {
    this.emit("found-in-page", {}, result);
  }

  async loadURL(url: string): Promise<void> {
    await this.view.navigate(url);
  }
  async loadFile(_f: string): Promise<void> {
    throw new Error("loadFile unsupported for remote browser views");
  }
  reload(): void {
    void this.view.command("Page.reload", { ignoreCache: false }).catch(() => undefined);
  }
  goBack(): void {
    this.navigationHistory.goBack();
  }
  goForward(): void {
    this.navigationHistory.goForward();
  }
  insertText(text: string): void {
    void this.view.command("Input.insertText", { text }).catch(() => undefined);
  }
  copy(): void {
    void this.evaluate('document.execCommand("copy")').catch(() => undefined);
  }
  paste(): void {
    void this.evaluate('document.execCommand("paste")').catch(() => undefined);
  }
  selectAll(): void {
    void this.evaluate('document.execCommand("selectAll")').catch(() => undefined);
  }
  unselect(): void {}
  startFind(query: string, options?: unknown): number {
    return this.findInPage(query, options as { forward?: boolean } | undefined);
  }
  stopFind(action: string): void {
    this.stopFindInPage(action);
  }
  stop(): void {
    void this.view.command("Page.stopLoading").catch(() => undefined);
  }
  close(): void {
    this.destroy();
  }
  destroy(): void {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true;
    void this.view.destroy();
  }
  focus(): void {
    void this.view.command("Page.bringToFront").catch(() => undefined);
  }

  private async navigateHistory(delta: number): Promise<void> {
    const target = this.navIndex + delta;
    const entry = this.navEntries[target];
    if (!entry) return;
    const conn = this.conn();
    const sid = this.view.sessionId;
    if (!conn || !sid) return;
    try {
      const { entries, currentIndex } = await conn.send<{
        entries: { id: number; url: string }[];
        currentIndex: number;
      }>("Page.getNavigationHistory", {}, sid);
      const real = entries.find((e) => e.url === entry.url);
      const id = real?.id ?? entries[currentIndex + delta]?.id;
      if (id !== undefined) {
        this.navIndex = target;
        await conn.send("Page.navigateToHistoryEntry", { entryId: id }, sid);
      }
    } catch {
      // navigation history races are non-fatal
    }
  }

  findInPage(
    query: string,
    options: { forward?: boolean; findNext?: boolean; matchCase?: boolean } = {},
  ): number {
    const expr = `window.find(${JSON.stringify(query)}, ${options.matchCase === true}, ${options.forward !== false}, true)`;
    void this.evaluate(expr)
      .then(() => this.emitFindResult({ matches: 1, activeMatchOrdinal: 0, finalUpdate: true }))
      .catch(() => this.emitFindResult({ matches: 0, activeMatchOrdinal: 0, finalUpdate: true }));
    return 0;
  }
  stopFindInPage(_action: string): void {
    void this.evaluate("getSelection()?.removeAllRanges()").catch(() => undefined);
  }

  async evaluate(expression: string): Promise<unknown> {
    const conn = this.conn();
    const sid = this.view.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    const result = await conn.send<{ result?: { value?: unknown } }>(
      "Runtime.evaluate",
      { expression, returnByValue: true },
      sid,
    );
    return result.result?.value;
  }

  executeJavaScript<T>(code: string): Promise<T> {
    return this.evaluate(code) as Promise<T>;
  }

  async executeJavaScriptInIsolatedWorld<T>(
    worldId: number,
    scripts: string | { code: string }[],
  ): Promise<T> {
    const conn = this.conn();
    const sid = this.view.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    let contextId = this.isolatedWorlds.get(worldId);
    if (contextId === undefined) {
      const { frameTree } = await conn.send<{ frameTree: { frame: { id: string } } }>(
        "Page.getFrameTree",
        {},
        sid,
      );
      const { executionContextId } = await conn.send<{ executionContextId: number }>(
        "Page.createIsolatedWorld",
        {
          frameId: frameTree.frame.id,
          worldName: `modus-world-${worldId}`,
          grantUniveralAccess: true,
        },
        sid,
      );
      contextId = executionContextId;
      this.isolatedWorlds.set(worldId, contextId);
    }
    const list = typeof scripts === "string" ? [{ code: scripts }] : scripts;
    let result: unknown;
    for (const script of list) {
      const res = await conn.send<{ result?: { value?: unknown } }>(
        "Runtime.evaluate",
        { expression: script.code, contextId, returnByValue: true },
        sid,
      );
      result = res.result?.value;
    }
    return result as T;
  }

  async insertCSS(css: string, _options?: { cssOrigin?: string }): Promise<string> {
    const conn = this.conn();
    const sid = this.view.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    const { frameTree } = await conn.send<{ frameTree: { frame: { id: string } } }>(
      "Page.getFrameTree",
      {},
      sid,
    );
    const { styleSheetId } = await conn.send<{ styleSheetId: string }>(
      "CSS.createStyleSheet",
      { frameId: frameTree.frame.id },
      sid,
    );
    await conn.send("CSS.setStyleSheetText", { styleSheetId, text: css }, sid);
    return styleSheetId;
  }

  async capturePage(
    rect?: { x: number; y: number; width: number; height: number },
    _opts?: { stayHidden?: boolean },
  ): Promise<NativeImage> {
    const conn = this.conn();
    const sid = this.view.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    const clip = rect
      ? {
          clip: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            scale: 1,
          },
        }
      : {};
    const { data } = await conn.send<{ data: string }>(
      "Page.captureScreenshot",
      { format: "png", fromSurface: true, ...clip },
      sid,
    );
    const buf = Buffer.from(data, "base64");
    return NativeImage.createFromBuffer(buf);
  }

  setZoomFactor(_z: number): void {}
  getZoomFactor(): number {
    return 1;
  }
  setAudioMuted(_m: boolean): void {}
  send(_channel: string, ..._args: unknown[]): void {}
  postMessage(_channel: string, _payload: unknown, _t?: unknown[]): void {}
}

export class RemoteWebContentsView extends EventEmitter {
  readonly webContents: RemoteWebContents;
  targetId: string | null = null;
  sessionId: string | null = null;
  private connRef: CdpConnection | null = null;
  private bounds = { x: 0, y: 0, width: 960, height: 640 };
  private visible = false;
  private destroyedFlag = false;
  private attaching: Promise<string> | null = null;
  private screencasting = false;
  private tabId = "";
  private readonly detachListeners = new Set<() => void>();

  constructor(options?: {
    webPreferences?: {
      partition?: string;
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      sandbox?: boolean;
      webSecurity?: boolean;
      [key: string]: unknown;
    };
  }) {
    super();
    this.partition = options?.webPreferences?.partition ?? "persist:default";
    this.webContents = new RemoteWebContents(this);
  }

  readonly partition: string;

  /** tab-store assigns this so screencast frames carry the tab id. */
  setTabIdForFrames(id: string): void {
    this.tabId = id;
  }

  conn(): CdpConnection | null {
    return this.connRef;
  }

  async ensureAttached(): Promise<string> {
    if (this.sessionId && this.connRef && !this.connRef.isClosed) {
      return this.sessionId;
    }
    if (this.attaching) {
      return this.attaching;
    }
    this.attaching = this.attach();
    try {
      return await this.attaching;
    } finally {
      this.attaching = null;
    }
  }

  private async attach(): Promise<string> {
    const conn = await chromiumManager.ensureBrowser();
    this.connRef = conn;
    if (!this.targetId) {
      const { targetId } = await chromiumManager.createTarget(this.partition, "about:blank");
      this.targetId = targetId;
    }
    this.sessionId = await chromiumManager.attachTarget(this.targetId);
    this.bindEvents(conn);
    return this.sessionId;
  }

  async command(method: string, params: CdpParams = {}): Promise<unknown> {
    await this.ensureAttached();
    const conn = this.connRef;
    const sid = this.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    return await conn.send(method, params, sid);
  }

  private bound = false;
  private bindEvents(conn: CdpConnection): void {
    if (this.bound) return;
    this.bound = true;
    const sid = this.sessionId ?? undefined;
    conn.onEvent((event) => {
      if (event.sessionId && event.sessionId !== sid) return;
      try {
        this.handleEvent(event.method, event.params);
      } catch {
        // A throwing webContents listener (e.g. recents FK) must not kill the
        // CDP socket pump.
      }
    });
    conn.onClose(() => {
      this.sessionId = null;
      for (const listener of this.detachListeners) listener();
    });
    // Enable the domains this view consumes.
    const enables = [
      "Page.enable",
      "Runtime.enable",
      "Network.enable",
      "Log.enable",
      "CSS.enable",
      "Emulation.setTouchEmulationEnabled",
    ];
    for (const domain of enables) {
      const params = domain === "Emulation.setTouchEmulationEnabled" ? { enabled: false } : {};
      void conn.send(domain, params, sid).catch(() => undefined);
    }
    // Accept-Language from the session locale hook.
    const acceptLanguage = this.webContents.session.acceptLanguage;
    if (acceptLanguage) {
      void conn
        .send("Emulation.setUserAgentOverride", { userAgent: "", acceptLanguage }, sid)
        .catch(() => undefined);
    }
    // Popup policy: watch for targets opened from this page.
    chromiumManager.onBrowserEvent((event) => {
      if (event.method !== "Target.targetInfoChanged") return;
      const info = event.params.targetInfo as
        | { targetId?: string; openerId?: string; type?: string; url?: string }
        | undefined;
      if (info?.openerId === this.targetId && info.type === "page" && info.targetId) {
        const url = info.url ?? "about:blank";
        if (this.webContents.handleWindowOpen(url) === "deny") {
          void conn.send("Target.closeTarget", { targetId: info.targetId }).catch(() => undefined);
        }
      }
      if (info?.targetId === this.targetId && info.url) {
        this.webContents.markTitle((info as { title?: string }).title ?? "");
      }
    });
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    const wc = this.webContents;
    switch (method) {
      case "Page.frameStartedLoading":
      case "Page.frameStartedNavigating":
        wc.markLoading(true);
        break;
      case "Page.loadEventFired":
        wc.markLoading(false);
        this.refreshTitleAndFavicon();
        break;
      case "Page.frameStoppedLoading":
        wc.markLoading(false);
        break;
      case "Page.navigatedWithinDocument": {
        const url = typeof params.url === "string" ? params.url : "";
        wc.markNavigated(url, "", true);
        break;
      }
      case "Page.frameNavigated": {
        const frame = params.frame as { url?: string; parentId?: string } | undefined;
        if (frame && !frame.parentId) {
          wc.markNavigated(frame.url ?? "", "", false);
        }
        break;
      }
      case "Runtime.consoleAPICalled": {
        const typeMap: Record<string, number> = {
          log: 1,
          info: 1,
          warning: 2,
          error: 3,
          debug: 0,
        };
        const args = (params.args as { value?: unknown; description?: string }[]) ?? [];
        wc.pushConsoleMessage({
          level: typeMap[String(params.type)] ?? 1,
          message: args.map((a) => a.value ?? a.description ?? "").join(" "),
          lineNumber: 0,
        });
        break;
      }
      case "Log.entryAdded": {
        const entry = params.entry as
          | { level?: string; text?: string; url?: string; lineNumber?: number }
          | undefined;
        if (entry) {
          const levelMap: Record<string, number> = { verbose: 0, info: 1, warning: 2, error: 3 };
          wc.pushConsoleMessage({
            level: levelMap[entry.level ?? "info"] ?? 1,
            message: entry.text ?? "",
            ...(entry.url ? { sourceId: entry.url } : {}),
            lineNumber: entry.lineNumber ?? 0,
          });
        }
        break;
      }
      case "Page.screencastFrame": {
        const sid = this.sessionId;
        const conn = this.connRef;
        const sessionIdNum = params.sessionId;
        if (conn && sid && typeof sessionIdNum === "number") {
          void conn
            .send("Page.screencastFrameAck", { sessionId: sessionIdNum }, sid)
            .catch(() => undefined);
        }
        if (this.visible && this.tabId) {
          broadcastEvent(FRAME_CHANNEL, {
            tabId: this.tabId,
            data: params.data,
            metadata: params.metadata,
          });
        }
        break;
      }
      case "Inspector.targetCrashed":
        this.webContents.emit("render-process-gone", {}, { reason: "crashed" });
        break;
      default:
        break;
    }
    // Re-emit as debugger "message" for CdpSession consumers.
    this.webContents.debugger.emit("message", {}, method, params, this.sessionId ?? undefined);
  }

  private refreshTitleAndFavicon(): void {
    void this.webContents
      .evaluate(
        `JSON.stringify({t:document.title||"",f:(document.querySelector('link[rel~="icon"]')||document.querySelector('link[rel="shortcut icon"]'))?.href||""})`,
      )
      .then((raw) => {
        try {
          const { t, f } = JSON.parse(String(raw)) as { t?: string; f?: string };
          if (t) this.webContents.markTitle(t);
          if (f) this.webContents.markFavicons([f]);
        } catch {
          // ignore
        }
      })
      .catch(() => undefined);
  }

  async navigate(url: string): Promise<void> {
    await this.ensureAttached();
    const conn = this.connRef;
    const sid = this.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    const done = new Promise<void>((resolve) => {
      const off = conn.onEvent((event) => {
        if (event.sessionId && event.sessionId !== sid) return;
        if (event.method === "Page.loadEventFired") {
          off();
          resolve();
        }
      });
      setTimeout(() => {
        off();
        resolve();
      }, 30_000).unref?.();
    });
    const result = await conn.send<{ errorText?: string }>("Page.navigate", { url }, sid);
    if (result.errorText) {
      const error = new Error(result.errorText) as Error & { errno?: number };
      error.errno = -2;
      throw error;
    }
    await done;
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...bounds };
    if (this.sessionId && this.connRef) {
      void this.connRef
        .send(
          "Emulation.setDeviceMetricsOverride",
          {
            width: Math.max(1, Math.round(bounds.width)),
            height: Math.max(1, Math.round(bounds.height)),
            deviceScaleFactor: 1,
            mobile: false,
          },
          this.sessionId,
        )
        .catch(() => undefined);
    }
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) {
      void this.startScreencast();
    } else {
      void this.stopScreencast();
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  private async startScreencast(): Promise<void> {
    if (this.screencasting) return;
    try {
      await this.ensureAttached();
      const conn = this.connRef;
      const sid = this.sessionId;
      if (!conn || !sid) return;
      this.screencasting = true;
      await conn
        .send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 }, sid)
        .catch(() => {
          this.screencasting = false;
        });
    } catch {
      this.screencasting = false;
    }
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting) return;
    this.screencasting = false;
    const conn = this.connRef;
    const sid = this.sessionId;
    if (conn && sid) {
      await conn.send("Page.stopScreencast", {}, sid).catch(() => undefined);
    }
  }

  setBackgroundColor(_c: string): void {}

  /** Input forwarded from the renderer's canvas via the browser:input channel. */
  async dispatchInput(event: Record<string, unknown>): Promise<void> {
    const conn = this.connRef;
    const sid = this.sessionId;
    if (!conn || !sid) throw new Error("CDP not attached");
    if (event.kind === "mouse") {
      await conn.send(
        "Input.dispatchMouseEvent",
        {
          type: event.type,
          x: event.x,
          y: event.y,
          button: event.button ?? "none",
          clickCount: event.clickCount ?? 0,
          modifiers: event.modifiers ?? 0,
          ...(event.type === "mouseWheel"
            ? { deltaX: event.deltaX ?? 0, deltaY: event.deltaY ?? 0 }
            : {}),
        },
        sid,
      );
    } else if (event.kind === "key") {
      await conn.send(
        "Input.dispatchKeyEvent",
        {
          type: event.type,
          key: event.key,
          code: event.code,
          text: event.text,
          modifiers: event.modifiers ?? 0,
        },
        sid,
      );
    }
  }

  async destroy(): Promise<void> {
    if (this.destroyedFlag) return;
    this.destroyedFlag = true;
    await this.stopScreencast();
    if (this.targetId) {
      const targetId = this.targetId;
      this.targetId = null;
      await chromiumManager.closeTarget(targetId);
    }
  }

  isDestroyed(): boolean {
    return this.destroyedFlag;
  }
}
