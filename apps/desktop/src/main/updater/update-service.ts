import { join } from "node:path";
import { app, shell } from "electron";
import type { UpdateRestoreUiState } from "../../shared/contracts";
import { hasPendingDownloadedUpdate } from "../../shared/update-restore";
import type { UpdateIpcService } from "../ipc/update-ipc";
import {
  createRestoreSnapshotKeeper,
  type RestoreSnapshotKeeper,
  takeRestoreSnapshot,
} from "./restore-snapshot";
import type { UpdateLogger } from "./update-controller";
import { releasePageUrl } from "./update-policy";
import { IDLE } from "./update-state-machine";

const updaterLogger: UpdateLogger = {
  debug(message) {
    if (process.env.MODUS_UPDATER_DEBUG === "1") console.info(`[modus-updater] ${message}`);
  },
  info(message) {
    console.info(`[modus-updater] ${message}`);
  },
  warn(message) {
    console.warn(`[modus-updater] ${message}`);
  },
};

let restoreKeeper: RestoreSnapshotKeeper | null = null;
let restoredUiState: UpdateRestoreUiState | null = null;

function updaterWorkDir(): string {
  return join(app.getPath("userData"), "updater");
}

function getRestoreKeeper(): RestoreSnapshotKeeper {
  restoreKeeper ??= createRestoreSnapshotKeeper({
    workDir: updaterWorkDir(),
    currentVersion: app.getVersion(),
    // The Tauri shell owns the update engine; a pending download is reported
    // through update:state-event, so the sidecar never sees one here.
    hasPendingUpdate: () => hasPendingDownloadedUpdate(IDLE),
    now: () => Date.now(),
    logger: updaterLogger,
  });
  return restoreKeeper;
}

/**
 * Takes the UI snapshot left by the previous version (read + delete). Call once at
 * startup, before the window loads.
 */
export function takeRestoreSnapshotAtStartup(): void {
  restoredUiState = takeRestoreSnapshot({
    workDir: updaterWorkDir(),
    currentVersion: app.getVersion(),
    now: () => Date.now(),
    logger: updaterLogger,
  });
}

/** Synchronous; call from `before-quit`. Writes the latest UI state. */
export function saveRestoreSnapshotOnQuit(): void {
  restoreKeeper?.writeOnQuit();
}

/**
 * IPC facade kept for the update:* channel surface. The real engine lives in the
 * Tauri shell (tauri-plugin-updater); the ws-transport routes update:* channels
 * to it, so this sidecar facade is an idle fallback.
 */
export function getUpdateService(): UpdateIpcService {
  return {
    getState: () => IDLE,
    install: async () => {},
    retry: async () => {},
    restartNow: async () => {},
    dismiss: () => {},
    openReleasePage: async () => {
      await shell.openExternal(releasePageUrl());
    },
    saveUiState: (state) => getRestoreKeeper().remember(state),
    takeRestoredUiState: () => {
      const state = restoredUiState;
      restoredUiState = null;
      return state;
    },
  };
}
