/**
 * Node sidecar entry — runs src/main services on plain Node via electron-shim.
 * Mirrors main/index.ts's whenReady chain minus window/menu/update-service.
 * Env: MODUS_RPC_PORT (default 0), MODUS_RPC_TOKEN (required by Tauri spawn).
 */
import { join } from "node:path";
import {
  shutdownProviderAuthOperations,
  startRemoteModelCatalog,
  stopRemoteModelCatalog,
} from "../main/agent/model-service";
import { shutdownAgentRuntime } from "../main/agent/runtime-registry";
import { disposeAllReaSessions } from "../main/agent/tools/rea-tools";
import {
  type AppearanceController,
  createAppearanceController,
} from "../main/appearance/appearance-controller";
import { createAppearanceStore } from "../main/appearance/appearance-store";
import {
  closeAutomationServiceWindow,
  startAutomationService,
  stopAutomationService,
  wakeAutomationService,
} from "../main/automations/automation-service-instance";
import {
  initializeComposioService,
  shutdownComposioService,
} from "../main/composio/composio-service-instance";
import { databasePath, getDatabase, isGroupsMigrationPendingOnDisk } from "../main/db/database";
import { openDatabaseAtStartup } from "../main/db/database-startup";
import { IPC_CHANNELS } from "../main/ipc/channels";
import { registerAppIpc } from "../main/ipc/register-app-ipc";
import { registerTrustedSender } from "../main/ipc/trusted-sender";
import { installLocalModelsLogFile } from "../main/local-models/local-models-log-file";
import {
  getToolFilterController,
  startLocalModels,
  stopLocalModels,
} from "../main/local-models/startup";
import {
  createUiLanguageController,
  setCurrentUiLanguageSource,
  type UiLanguageController,
} from "../main/locale/ui-language-controller";
import { createUiLanguageStore } from "../main/locale/ui-language-store";
import { disposeAllMcp } from "../main/mcp/mcp-service";
import { createStartupTimeline } from "../main/startup/startup-timeline";
import { shutdownTerminals } from "../main/terminal/terminal-service";
import {
  saveRestoreSnapshotOnQuit,
  takeRestoreSnapshotAtStartup,
} from "../main/updater/update-service";
import { resolveWindowAppearance } from "../shared/window-appearance";
import { app, BrowserWindow, mainWebContents, nativeTheme, powerMonitor } from "./electron-shim";
import { startRpcServer } from "./rpc";

const startupTimeline = createStartupTimeline();
const SHUTDOWN_DRAIN_TIMEOUT_MS = 5_000;

function drainShutdown(tasks: Promise<unknown>[]): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS);
    timeout.unref?.();
    void Promise.allSettled(tasks).then(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

let appearance: AppearanceController | null = null;
let uiLanguage: UiLanguageController | null = null;

function getAppearance(): AppearanceController {
  appearance ??= createAppearanceController({
    nativeTheme,
    store: createAppearanceStore(app.getPath("userData")),
    windowAppearance: resolveWindowAppearance(process.platform, process.getSystemVersion?.() ?? ""),
  });
  return appearance;
}

function getUiLanguage(): UiLanguageController {
  if (!uiLanguage) {
    const controller = createUiLanguageController({
      store: createUiLanguageStore(app.getPath("userData")),
      systemLocales: () => {
        const preferred = app.getPreferredSystemLanguages?.() ?? [];
        return preferred.length > 0 ? preferred : [app.getLocale()];
      },
    });
    setCurrentUiLanguageSource(() => controller.getState());
    uiLanguage = controller;
  }
  return uiLanguage;
}

async function main(): Promise<void> {
  startupTimeline.mark("sidecar.entry");
  const token = process.env.MODUS_RPC_TOKEN;
  if (!token) {
    throw new Error("MODUS_RPC_TOKEN is required");
  }
  const rpc = await startRpcServer(Number(process.env.MODUS_RPC_PORT ?? 0), token);
  // stdout handshake line consumed by the Tauri spawn code.
  console.log(`MODUS_RPC_READY ${rpc.port}`);
  // The RPC boundary replaces the real webContents: mark the shared shim
  // webContents trusted so assertTrustedSender accepts dispatches.
  registerTrustedSender(mainWebContents, mainWebContents.mainFrame.url);
  startupTimeline.mark("sidecar.rpc-ready");

  if (isGroupsMigrationPendingOnDisk(databasePath())) {
    console.warn("Groups migration pending on disk; running without splash.");
  }
  const opened = openDatabaseAtStartup({
    open: (options) => getDatabase(options),
    showErrorBox: (title, content) => console.error(`[startup] ${title}: ${content}`),
    quit: () => process.exit(1),
    showMigrationError: (error) => {
      console.error(`[startup] groups migration failed:`, error);
      return "quit";
    },
    showBackup: () => {},
  });
  if (!opened) return;
  startupTimeline.mark("sidecar.db-open");

  registerAppIpc({
    startupTimeline,
    appearance: getAppearance(),
    uiLanguage: getUiLanguage(),
    toolFilter: getToolFilterController(app.getPath("userData")),
  });
  startupTimeline.mark("sidecar.ipc-registered");

  takeRestoreSnapshotAtStartup();
  const notifyModelCatalogChanged = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.modelCatalogChanged);
    }
  };
  startRemoteModelCatalog(notifyModelCatalogChanged);
  powerMonitor.on("resume", wakeAutomationService);
  installLocalModelsLogFile(join(app.getPath("userData"), "logs"));

  // A virtual window object exists so services that fan events out through
  // BrowserWindow.getAllWindows() keep working; send() broadcasts over RPC.
  const virtualWindow = new BrowserWindow();
  startAutomationService(virtualWindow as unknown as import("electron").BrowserWindow);
  startLocalModels(app.getPath("userData"));
  void initializeComposioService().catch(() => undefined);

  let shutdownStarted = false;
  async function shutdown(): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;
    saveRestoreSnapshotOnQuit();
    stopLocalModels();
    stopRemoteModelCatalog();
    shutdownTerminals();
    closeAutomationServiceWindow();
    rpc.close();
    await drainShutdown([
      (async () => {
        await stopAutomationService();
        await shutdownAgentRuntime();
      })(),
      disposeAllReaSessions(),
      shutdownProviderAuthOperations(),
      (async () => {
        try {
          await shutdownComposioService();
        } finally {
          await disposeAllMcp();
        }
      })(),
    ]);
    process.exit(0);
  }
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  startupTimeline.mark("sidecar.ready");
  console.log("MODUS_SIDECAR_READY");
}

void main().catch((error: unknown) => {
  console.error("Sidecar failed to boot.", error);
  process.exit(1);
});
