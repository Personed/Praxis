/**
 * Electron API shim for the Node sidecar (Tauri migration).
 * Implements the subset of `electron` that src/main uses, on plain Node.
 * Window/webContents send() broadcasts events over the sidecar RPC.
 */

import { type ChildProcess, execFile, type Serializable, spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// ---- broadcast hook: rpc.ts registers the socket broadcast via bus.ts ----
import { broadcastEvent } from "./bus";

export { setEventBroadcaster as __setEventBroadcaster } from "./bus";

// ---- app ----
const dataRoot = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "modus");
mkdirSync(dataRoot, { recursive: true });

// Packaged runs get MODUS_RESOURCES_PATH from the shell; main code resolves
// bundled binaries via process.resourcesPath like it did under Electron.
if (process.env.MODUS_RESOURCES_PATH) {
  (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath =
    process.env.MODUS_RESOURCES_PATH;
}

class AppShim extends EventEmitter {
  private readyResolve!: () => void;
  private readonly ready = new Promise<void>((r) => (this.readyResolve = r));

  constructor() {
    super();
    queueMicrotask(() => this.readyResolve());
  }
  whenReady(): Promise<void> {
    return this.ready;
  }
  isReady(): boolean {
    return true;
  }
  quit(): void {
    process.exit(0);
  }
  exit(code = 0): void {
    process.exit(code);
  }
  getPath(name: string): string {
    switch (name) {
      case "userData":
        return dataRoot;
      case "home":
        return homedir();
      case "temp":
        return tmpdir();
      case "appData":
        return join(homedir(), ".config");
      case "documents":
        return join(homedir(), "Documents");
      case "downloads":
        return join(homedir(), "Downloads");
      case "desktop":
        return join(homedir(), "Desktop");
      case "logs":
        return join(dataRoot, "logs");
      default:
        return join(dataRoot, name);
    }
  }
  setPath(_name: string, _path: string): void {}
  getVersion(): string {
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
      return pkg.version ?? "0.0.0";
    } catch {
      return "0.0.0";
    }
  }
  getName(): string {
    return "Modus";
  }
  setName(_name: string): void {}
  getAppPath(): string {
    return process.cwd();
  }
  isPackaged = Boolean(process.env.MODUS_RESOURCES_PATH);
  getLocale(): string {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  }
  getPreferredSystemLanguages(): string[] {
    return [this.getLocale()];
  }
  getSystemLocale(): string {
    return this.getLocale();
  }
  requestSingleInstanceLock(): boolean {
    return true;
  }
  releaseSingleInstanceLock(): void {}
  hasSingleInstanceLock(): boolean {
    return true;
  }
  setAppUserModelId(_id: string): void {}
  setActivationPolicy(_p: string): void {}
  dock = { hide() {}, show() {}, setMenu() {}, setIcon() {} };
  commandLine = {
    appendSwitch(_s: string, _v?: string) {},
    appendArgument(_v: string) {},
    hasSwitch() {
      return false;
    },
    getSwitchValue() {
      return "";
    },
  };
  getAppMetrics() {
    return [];
  }
  getGPUFeatureStatus() {
    return {};
  }
  isAccessibilitySupportEnabled() {
    return false;
  }
  setAccessibilitySupportEnabled(_e: boolean) {}
  override on = super.on.bind(this);
  override once = super.once.bind(this);
}
export const app = new AppShim();

// ---- webContents ----
let wcId = 0;
export class WebContents extends EventEmitter {
  id = ++wcId;
  mainFrame = { url: "http://localhost/" };
  session = { getUserAgent: () => "", setUserAgent(_ua: string) {} };
  navigationHistory = {
    getAllEntries() {
      return [];
    },
    goBack() {},
    goForward() {},
    canGoBack() {
      return false;
    },
    canGoForward() {
      return false;
    },
    clear() {},
    restore(_e: unknown) {},
  };
  debugger = { attach() {}, detach() {}, sendCommand: async () => ({}) };
  send(channel: string, ...args: unknown[]): void {
    broadcastEvent(channel, args.length <= 1 ? args[0] : args);
  }
  postMessage(_channel: string, _payload: unknown, _t?: unknown[]): void {
    broadcastEvent(_channel, _payload);
  }
  loadURL(_url: string): Promise<void> {
    return Promise.resolve();
  }
  loadFile(_f: string): Promise<void> {
    return Promise.resolve();
  }
  getURL(): string {
    return "";
  }
  getTitle(): string {
    return "";
  }
  isDestroyed(): boolean {
    return false;
  }
  isLoading(): boolean {
    return false;
  }
  isDevToolsOpened(): boolean {
    return false;
  }
  openDevTools(_o?: unknown): void {}
  closeDevTools(): void {}
  toggleDevTools(): void {}
  executeJavaScript<T>(code: string): Promise<T> {
    return Promise.reject(
      new Error(`executeJavaScript unavailable in sidecar: ${code.slice(0, 80)}`),
    );
  }
  insertText(_t: string): void {}
  setWindowOpenHandler(_h: unknown): void {}
  capturePage(_r?: unknown): Promise<NativeImage> {
    return Promise.resolve(new NativeImage());
  }
  focus(): void {}
  reload(): void {}
  goBack(): void {}
  goForward(): void {}
  stop(): void {}
  setAudioMuted(_m: boolean): void {}
  copy(): void {}
  paste(): void {}
  selectAll(): void {}
  unselect(): void {}
  startFind(_q: string, _o?: unknown) {
    return 0;
  }
  stopFind(_a: string) {}
  setZoomFactor(_z: number): void {}
  getZoomFactor(): number {
    return 1;
  }
}

// Browser tabs run on real Chromium targets via CDP (Tauri mode).
import { RemoteWebContentsView } from "./remote-view";

export { RemoteWebContentsView as WebContentsView };

// ---- BrowserWindow ----
export class BrowserWindow extends EventEmitter {
  static instances = new Set<BrowserWindow>();
  webContents = mainWebContents;
  contentView = {
    addChildView: (_v: RemoteWebContentsView) => {},
    removeChildView: (_v: RemoteWebContentsView) => {},
    children: [] as RemoteWebContentsView[],
    setBounds(_b: unknown) {},
    getBounds() {
      return { x: 0, y: 0, width: 0, height: 0 };
    },
  };
  constructor(_o?: unknown) {
    super();
    BrowserWindow.instances.add(this);
  }
  static getAllWindows(): BrowserWindow[] {
    return [...BrowserWindow.instances];
  }
  static fromWebContents(_wc: WebContents) {
    return [...BrowserWindow.instances][0] ?? null;
  }
  loadURL(u: string) {
    return this.webContents.loadURL(u);
  }
  loadFile(f: string) {
    return this.webContents.loadFile(f);
  }
  override on = super.on.bind(this);
  isDestroyed() {
    return false;
  }
  isMinimized() {
    return false;
  }
  isMaximized() {
    return false;
  }
  isFocused() {
    return true;
  }
  isVisible() {
    return true;
  }
  isFullScreen() {
    return false;
  }
  restore() {}
  focus() {}
  blur() {}
  show() {}
  hide() {}
  close() {
    BrowserWindow.instances.delete(this);
    this.emit("closed");
  }
  destroy() {
    this.close();
  }
  minimize() {}
  maximize() {}
  unmaximize() {}
  setBounds(_b: unknown) {}
  getBounds() {
    return { x: 0, y: 0, width: 1440, height: 900 };
  }
  getContentBounds() {
    return this.getBounds();
  }
  setSize(_w: number, _h: number) {}
  getSize() {
    return [1440, 900];
  }
  setTitle(_t: string) {}
  setMenu(_m: unknown) {}
  setAutoHideMenuBar(_h: boolean) {}
  setWindowButtonVisibility(_v: boolean) {}
  setBackgroundColor(_c: string) {}
  setOpacity(_o: number) {}
  setAlwaysOnTop(_a: boolean) {}
  setContentSize(_w: number, _h: number) {}
  getContentSize() {
    return [1440, 900];
  }
  webContentsId() {
    return this.webContents.id;
  }
}

// ---- ipcMain ----
type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, IpcHandler>();
const ipcListeners = new Map<string, Set<IpcHandler>>();

export const ipcMain = {
  handle(channel: string, handler: IpcHandler): void {
    handlers.set(channel, handler);
  },
  handleOnce(channel: string, handler: IpcHandler): void {
    handlers.set(channel, handler);
  },
  removeHandler(channel: string): void {
    handlers.delete(channel);
  },
  on(channel: string, listener: IpcHandler): void {
    let set = ipcListeners.get(channel);
    if (!set) {
      set = new Set();
      ipcListeners.set(channel, set);
    }
    set.add(listener);
  },
  once(channel: string, listener: IpcHandler): void {
    this.on(channel, listener);
  },
  removeListener(channel: string, listener: IpcHandler): void {
    ipcListeners.get(channel)?.delete(listener);
  },
};

/** Shared webContents used as the event sender for RPC-dispatched invokes.
 * Registered with registerTrustedSender() at boot so assertTrustedSender passes. */
export const mainWebContents = new WebContents();

export function setTrustedRendererUrl(url: string): void {
  mainWebContents.mainFrame = { url };
}

export async function __invokeIpc(channel: string, args: unknown[]): Promise<unknown> {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No IPC handler for channel "${channel}"`);
  const event = { sender: mainWebContents, senderFrame: mainWebContents.mainFrame };
  return await handler(event, ...args);
}

export function __ipcHas(channel: string): boolean {
  return handlers.has(channel);
}

// ---- dialog ----
function execText(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

async function zenity(args: string[]): Promise<string | null> {
  return execText("zenity", args);
}

async function osa(script: string): Promise<string | null> {
  return execText("osascript", ["-e", script]);
}

export const dialog = {
  async showOpenDialog(
    opts: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      properties?: string[];
    } = {},
  ) {
    const props = opts.properties ?? ["openFile"];
    const directory = props.includes("openDirectory");
    const multi = props.includes("multiSelections");
    let out: string | null = null;
    if (process.platform === "darwin") {
      out = await osa(
        directory
          ? `POSIX path of (choose folder${opts.title ? ` with prompt ${JSON.stringify(opts.title)}` : ""})`
          : `POSIX path of (choose file${opts.title ? ` with prompt ${JSON.stringify(opts.title)}` : ""})`,
      );
    } else if (process.platform === "win32") {
      // no native picker wired; fall through to canceled
    } else {
      const args = ["--file-selection", `--title=${opts.title ?? "Open"}`];
      if (directory) args.push("--directory");
      if (multi) args.push("--multiple", "--separator=\n");
      if (opts.defaultPath) args.push(`--filename=${opts.defaultPath}`);
      for (const f of opts.filters ?? []) {
        args.push(`--file-filter=${f.name} | ${f.extensions.map((e) => `*.${e}`).join(" ")}`);
      }
      out = await zenity(args);
    }
    if (!out) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: out.split("\n").filter(Boolean) };
  },
  async showSaveDialog(
    _win: unknown,
    opts: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    } = {},
  ) {
    let out: string | null = null;
    if (process.platform === "darwin") {
      const name = opts.defaultPath ? (opts.defaultPath.split("/").pop() ?? "file") : "file";
      out = await osa(
        `POSIX path of (choose file name${opts.title ? ` with prompt ${JSON.stringify(opts.title)}` : ""} default name ${JSON.stringify(name)})`,
      );
    } else if (process.platform === "win32") {
      // canceled
    } else {
      const args = [
        "--file-selection",
        "--save",
        "--confirm-overwrite",
        `--title=${opts.title ?? "Save"}`,
      ];
      if (opts.defaultPath) args.push(`--filename=${opts.defaultPath}`);
      for (const f of opts.filters ?? []) {
        args.push(`--file-filter=${f.name} | ${f.extensions.map((e) => `*.${e}`).join(" ")}`);
      }
      out = await zenity(args);
    }
    if (!out) return { canceled: true, filePath: "" };
    return { canceled: false, filePath: out };
  },
  async showMessageBox(_opts: unknown) {
    return { response: 0 };
  },
  showMessageBoxSync(_opts: unknown) {
    return 0;
  },
  showErrorBox(title: string, content: string) {
    console.error(`[dialog.showErrorBox] ${title}: ${content}`);
  },
  showCertificateTrustDialog() {},
};

// ---- shell ----
function opener(): string {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "explorer";
  return "xdg-open";
}
export const shell = {
  async openExternal(url: string): Promise<void> {
    execFile(opener(), [url], () => {});
  },
  async openPath(path: string): Promise<string> {
    execFile(opener(), [path], () => {});
    return "";
  },
  showItemInFolder(path: string): void {
    execFile(opener(), [join(path, "..")], () => {});
  },
  async trashItem(path: string): Promise<void> {
    execFile("gio", ["trash", path], () => {});
  },
  beep() {},
  writeShortcutLink() {},
  readShortcutLink() {
    return {};
  },
};

// ---- nativeTheme ----
class NativeThemeShim extends EventEmitter {
  themeSource: "system" | "light" | "dark" = "system";
  shouldUseDarkColors = true;
  shouldUseDarkColorsForSystemIntegratedUI = true;
  shouldDifferentiateWithoutColor = false;
  shouldUseHighContrastColors = false;
  shouldUseInvertedColorScheme = false;
  prefersReducedTransparency = false;
  inForcedColorsMode = false;
}
export const nativeTheme = new NativeThemeShim();

// ---- powerMonitor ----
class PowerMonitorShim extends EventEmitter {
  getSystemIdleTime() {
    return 0;
  }
  getSystemIdleState(_t: number) {
    return "active";
  }
}
export const powerMonitor = new PowerMonitorShim();

// ---- safeStorage (AES-GCM keyed by machine-derived key in userData) ----
function storageKey(): Buffer {
  const keyFile = join(dataRoot, ".storage-key");
  if (!existsSync(keyFile)) {
    writeFileSync(keyFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return scryptSync(readFileSync(keyFile, "utf8") + hostname() + userInfo().username, "modus", 32);
}
function enc(text: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", storageKey(), iv);
  return Buffer.concat([iv, c.update(text, "utf8"), c.final(), c.getAuthTag()]);
}
function dec(buf: Buffer): string {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const d = createDecipheriv("aes-256-gcm", storageKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString("utf8");
}
export const safeStorage = {
  isEncryptionAvailable: () => true,
  isAsyncEncryptionAvailable: async () => true,
  encryptString: (t: string) => enc(t),
  decryptString: (b: Buffer) => dec(b),
  encryptStringAsync: async (t: string) => enc(t),
  decryptStringAsync: async (b: Buffer) => dec(b),
};

// ---- net ----
export const net = {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  request: (_opts: unknown) => {
    throw new Error("net.request not implemented in sidecar");
  },
  isOnline: () => true,
};

// ---- protocol / session / screen / clipboard / menu / notification ----
export const protocol = {
  handle(_scheme: string, _handler: unknown) {},
  registerSchemesAsPrivileged(_schemes: unknown[]) {},
  interceptFileProtocol() {
    return true;
  },
  registerFileProtocol() {
    return true;
  },
};

export class Session extends EventEmitter {
  static fromPartition() {
    return new Session();
  }
  getUserAgent() {
    return "";
  }
  setUserAgent(_ua: string) {}
  setDownloadPath(_p: string) {}
  clearCache() {
    return Promise.resolve();
  }
  webRequest = {
    onBeforeSendHeaders(_f: unknown, _h?: unknown) {},
    onHeadersReceived(_f: unknown, _h?: unknown) {},
  };
}
export const session = { defaultSession: new Session(), fromPartition: Session.fromPartition };

export const screen = {
  getPrimaryDisplay() {
    return {
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      scaleFactor: 1,
      size: { width: 1920, height: 1080 },
      workAreaSize: { width: 1920, height: 1040 },
    };
  },
  getAllDisplays() {
    return [this.getPrimaryDisplay()];
  },
  getCursorScreenPoint() {
    return { x: 0, y: 0 };
  },
  on: () => screen,
};

export class NativeImage {
  private buf: Buffer = Buffer.alloc(0);
  static createFromPath(_p: string) {
    return new NativeImage();
  }
  static createFromBuffer(b: Buffer) {
    const i = new NativeImage();
    i.buf = b;
    return i;
  }
  static createFromDataURL(_d: string) {
    return new NativeImage();
  }
  toPNG() {
    return this.buf;
  }
  toJPEG() {
    return this.buf;
  }
  toDataURL() {
    return "";
  }
  isEmpty() {
    return this.buf.length === 0;
  }
  getSize() {
    return { width: 0, height: 0 };
  }
}
export const nativeImage = NativeImage;

export const clipboard = {
  readText: () => "",
  writeText: (_t: string) => {},
  readImage: () => new NativeImage(),
  writeImage: (_i: NativeImage) => {},
  clear: () => {},
  availableFormats: () => [] as string[],
  has: () => false,
  write: (_items: ClipboardItem[]) => {},
  read: () => [] as ClipboardItem[],
};
export class ClipboardItem {
  items: Record<string, Buffer | string>;
  constructor(items: Record<string, Buffer | string>) {
    this.items = items;
  }
  getType(_type: string) {
    return this.items[_type];
  }
  hasType(type: string) {
    return type in this.items;
  }
  getTypes() {
    return Object.keys(this.items);
  }
}

export const Menu = {
  setApplicationMenu: (_m: unknown) => {},
  getApplicationMenu: () => null,
  buildFromTemplate: (t: unknown[]) => ({ items: t, popup: () => {} }),
  sendActionToFirstResponder: (_a: string) => {},
};
export type MenuItemConstructorOptions = Record<string, unknown>;

export class Notification extends EventEmitter {
  static isSupported() {
    return true;
  }
  constructor(private readonly options?: { title?: string; body?: string; silent?: boolean }) {
    super();
  }
  show(): void {
    const title = this.options?.title ?? "Modus";
    const body = this.options?.body ?? "";
    try {
      if (process.platform === "darwin") {
        execFile("osascript", [
          "-e",
          `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
        ]);
      } else if (process.platform === "win32") {
        const ps = `Add-Type -AssemblyName System.Windows.Forms; $n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true; $n.ShowBalloonTip(4000,${JSON.stringify(title)},${JSON.stringify(body)},'Info'); Start-Sleep 4; $n.Dispose()`;
        execFile("powershell", ["-NoProfile", "-Command", ps]);
      } else {
        execFile("notify-send", [title, body]);
      }
    } catch {
      // Notifications are best-effort.
    }
    queueMicrotask(() => this.emit("show"));
  }
  close(): void {
    this.emit("close");
  }
}

// ---- utilityProcess ----
export const utilityProcess = {
  fork(
    modulePath: string,
    args: string[] = [],
    options?: { stdio?: string; env?: NodeJS.ProcessEnv; serviceName?: string },
  ) {
    const child = spawn(process.execPath, [modulePath, ...args], {
      stdio:
        options?.stdio === "inherit"
          ? ["inherit", "inherit", "inherit", "ipc"]
          : ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, ...options?.env },
    }) as ChildProcess & { postMessage?: (m: unknown) => void };
    child.postMessage = (m: unknown) => child.send?.(m as Serializable);
    return child;
  },
};

export class Debugger extends EventEmitter {
  attach() {}
  detach() {}
  isAttached() {
    return false;
  }
  sendCommand(_c: string, _p?: unknown) {
    return Promise.resolve({});
  }
}

export type IpcMainInvokeEvent = {
  sender: WebContents;
  senderFrame: unknown;
};

export default {
  app,
  BrowserWindow,
  WebContents,
  WebContentsView: RemoteWebContentsView,
  ipcMain,
  dialog,
  shell,
  nativeTheme,
  powerMonitor,
  safeStorage,
  net,
  protocol,
  Session,
  session,
  screen,
  clipboard,
  nativeImage,
  Menu,
  Notification,
  utilityProcess,
  Debugger,
};
