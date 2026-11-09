import { join } from "node:path";
import {
  app,
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  dialog,
  nativeTheme,
  powerMonitor,
  shell,
} from "electron";
import { resolveWindowAppearance } from "../shared/window-appearance";
import {
  shutdownProviderAuthOperations,
  startRemoteModelCatalog,
  stopRemoteModelCatalog,
} from "./agent/model-service";
import { shutdownAgentRuntime } from "./agent/runtime-registry";
import { disposeAllReaSessions } from "./agent/tools/rea-tools";
import {
  type AppearanceController,
  createAppearanceController,
} from "./appearance/appearance-controller";
import { createAppearanceStore } from "./appearance/appearance-store";
import {
  closeAutomationServiceWindow,
  startAutomationService,
  stopAutomationService,
  wakeAutomationService,
} from "./automations/automation-service-instance";
import { resolveBrowserLocale } from "./browser/browser-locale";
import {
  initializeComposioService,
  shutdownComposioService,
} from "./composio/composio-service-instance";
import { databasePath, getDatabase, isGroupsMigrationPendingOnDisk } from "./db/database";
import {
  GROUPS_MIGRATION_ERROR_TITLE,
  groupsMigrationErrorMessage,
  openDatabaseAtStartup,
} from "./db/database-startup";
import { showMigrationSplash } from "./db/migration-splash";
import { IPC_CHANNELS } from "./ipc/channels";
import { registerAppIpc } from "./ipc/register-app-ipc";
import { installLocalModelsLogFile } from "./local-models/local-models-log-file";
import { getToolFilterController, startLocalModels, stopLocalModels } from "./local-models/startup";
import {
  createUiLanguageController,
  setCurrentUiLanguageSource,
  type UiLanguageController,
} from "./locale/ui-language-controller";
import { createUiLanguageStore } from "./locale/ui-language-store";
import { disposeAllMcp } from "./mcp/mcp-service";
import { createStartupTimeline } from "./startup/startup-timeline";
import { shutdownTerminals } from "./terminal/terminal-service";
import {
  saveRestoreSnapshotOnQuit,
  startUpdateServiceInBackground,
  stopUpdateService,
  takeRestoreSnapshotAtStartup,
} from "./updater/update-service";
import { installApplicationMenu } from "./windows/application-menu";
import { createMainWindow } from "./windows/main-window";

// Chromium UI strings / Intl follow the OS language for the embedded browser
// and any WebContents that inherit the process locale. Must run before ready.
try {
  app.commandLine.appendSwitch("lang", resolveBrowserLocale());
} catch {
  // Locale helpers need Electron; ignore in non-Electron unit contexts.
}

let mainWindow: BrowserWindowType | null = null;
let ipcRegistered = false;
let appearance: AppearanceController | null = null;
let uiLanguage: UiLanguageController | null = null;
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

startupTimeline.mark("main.entry");

/** Created after `ready`: reads userData/appearance.json and syncs nativeTheme once. */
function getAppearance(): AppearanceController {
  appearance ??= createAppearanceController({
    nativeTheme,
    store: createAppearanceStore(app.getPath("userData")),
    windowAppearance: resolveWindowAppearance(process.platform, process.getSystemVersion?.() ?? ""),
  });
  return appearance;
}

/**
 * App language (Settings > General > Language). Created after `ready`
 * (app.getPreferredSystemLanguages needs it); every change rebuilds the native
 * menu and is pushed to the windows.
 */
function getUiLanguage(): UiLanguageController {
  if (!uiLanguage) {
    const controller = createUiLanguageController({
      store: createUiLanguageStore(app.getPath("userData")),
      systemLocales: () => {
        const preferred = app.getPreferredSystemLanguages?.() ?? [];
        return preferred.length > 0 ? preferred : [app.getLocale()];
      },
    });
    controller.onChange((state) => installApplicationMenu(state.intlLocale));
    setCurrentUiLanguageSource(() => controller.getState());
    uiLanguage = controller;
  }
  return uiLanguage;
}

function ensureAppIpcRegistered(): void {
  if (ipcRegistered) {
    return;
  }

  registerAppIpc({
    startupTimeline,
    appearance: getAppearance(),
    uiLanguage: getUiLanguage(),
    toolFilter: getToolFilterController(app.getPath("userData")),
  });
  ipcRegistered = true;
}

function openMainWindow(): void {
  ensureAppIpcRegistered();

  mainWindow = createMainWindow({
    startupTimeline,
    appearance: getAppearance(),
    uiLanguage: getUiLanguage(),
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    closeAutomationServiceWindow();
  });
  startAutomationService(mainWindow);
}

function focusMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    focusMainWindow();
  });

  app
    .whenReady()
    .then(async () => {
      startupTimeline.mark("main.electron-ready");
      // Groups → Projects (PR 4): if the one-time migration is pending, paint a
      // splash first, because the migration runs synchronously inside getDatabase().
      const splash = isGroupsMigrationPendingOnDisk(databasePath())
        ? await showMigrationSplash().catch(() => null)
        : null;
      // The first DB open happens here, before any window (and so any IPC call)
      // exists: a file from a newer Modus gets a clear error box, then quit; a
      // failed groups migration gets the Try again / Show backup / Quit screen.
      const opened = openDatabaseAtStartup({
        open: (options) => getDatabase(options),
        showErrorBox: (title, content) => dialog.showErrorBox(title, content),
        quit: () => app.exit(1),
        showMigrationError: (error) => {
          const choice = dialog.showMessageBoxSync({
            type: "error",
            title: GROUPS_MIGRATION_ERROR_TITLE,
            message: GROUPS_MIGRATION_ERROR_TITLE,
            detail: groupsMigrationErrorMessage(error),
            buttons: ["Try again", "Show backup", "Quit"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
          });
          return choice === 0 ? "retry" : choice === 1 ? "backup" : "quit";
        },
        showBackup: (path) => {
          if (path) shell.showItemInFolder(path);
          else void shell.openPath(join(app.getPath("userData"), "backups"));
        },
      });
      if (!opened) {
        splash?.destroy();
        return;
      }
      installApplicationMenu(getUiLanguage().getState().intlLocale);
      // Before the window asks for it and before the update service cleans its dir.
      takeRestoreSnapshotAtStartup();
      const notifyModelCatalogChanged = () => {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send(IPC_CHANNELS.modelCatalogChanged);
        }
      };
      startRemoteModelCatalog(notifyModelCatalogChanged);
      powerMonitor.on("resume", wakeAutomationService);
      // Tool filter log lines also go to <userData>/logs/local-models.log (created on first line).
      installLocalModelsLogFile(join(app.getPath("userData"), "logs"));
      openMainWindow();
      // RERANK-03 tool filter: no-op unless tool_filter.enabled is on (the model runs in a utilityProcess).
      startLocalModels(app.getPath("userData"));
      if (splash) {
        const close = () => {
          if (!splash.isDestroyed()) splash.destroy();
        };
        if (mainWindow) mainWindow.once("ready-to-show", close);
        else close();
        setTimeout(close, 15_000);
      }
      // Restore the profile after the first renderer exists; do not block agent startup on Composio.
      void initializeComposioService().catch(() => undefined);
      // No-op in dev, beta builds and unsupported platforms; first check runs after a delay.
      startUpdateServiceInBackground();

      // Register after ready so the first launch does not race activate → boot.
      // Recreate the window only — IPC stays registered for the process lifetime.
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          openMainWindow();
        }
      });
    })
    .catch((error: unknown) => {
      console.error("Failed to boot Modus desktop.", error);
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // Electron does not await async event listeners: hold the first quit until
  // owned resources have had a bounded drain.
  let shutdownStarted = false;
  let allowQuitAfterShutdown = false;
  app.on("before-quit", (event) => {
    if (allowQuitAfterShutdown) return;
    event.preventDefault();
    if (shutdownStarted) return;
    shutdownStarted = true;
    // Sync, before anything stops: the renderer already pushed its state (no IPC here).
    saveRestoreSnapshotOnQuit();
    // Close MCP transports on quit so stdio servers never outlive the app.
    // Also runs for update installs: quitAndInstall and the mac installer both go through app.quit().
    stopUpdateService();
    // The tool-filter model process (utilityProcess) never outlives the app.
    stopLocalModels();
    stopRemoteModelCatalog();
    shutdownTerminals();
    void drainShutdown([
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
    ]).then(() => {
      allowQuitAfterShutdown = true;
      app.quit();
    });
  });
}
