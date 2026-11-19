import type { AppearanceState } from "../shared/appearance";
import type { AutomationServiceEvent } from "../shared/automations";
import type {
  AgentEvent,
  BrowserEvent,
  FilesChangeEvent,
  GitChangeEvent,
  HarnessInsightsQuery,
  TerminalEvent,
  UpdateRestoreUiState,
  UpdateState,
} from "../shared/contracts";
import type { ToolFilterState } from "../shared/tool-filter";
import type { UiLanguageState } from "../shared/ui-language";
import { resolveWindowAppearance } from "../shared/window-appearance";
import type { ModusTransport } from "./transport";
import type { ModusApi, SecurityState } from "./types";

export function createModusApi(t: ModusTransport): ModusApi {
  const windowAppearance = resolveWindowAppearance(t.env.platform, t.env.systemVersion);
  const APPEARANCE_ARGUMENT_PREFIX = "--modus-appearance=";

  function readInitialAppearance(): AppearanceState | null {
    const raw = t.env.argv.find((arg) => arg.startsWith(APPEARANCE_ARGUMENT_PREFIX));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw.slice(APPEARANCE_ARGUMENT_PREFIX.length)) as AppearanceState;
      return typeof parsed?.glass === "boolean" ? parsed : null;
    } catch {
      return null;
    }
  }

  const initialAppearance = readInitialAppearance();

  const UI_LANGUAGE_ARGUMENT_PREFIX = "--modus-ui-language=";

  function readInitialUiLanguage(): UiLanguageState | null {
    const raw = t.env.argv.find((arg) => arg.startsWith(UI_LANGUAGE_ARGUMENT_PREFIX));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw.slice(UI_LANGUAGE_ARGUMENT_PREFIX.length)) as UiLanguageState;
      return typeof parsed?.intlLocale === "string" ? parsed : null;
    } catch {
      return null;
    }
  }

  const initialUiLanguage = readInitialUiLanguage();
  const uiLanguageListeners = new Set<(state: UiLanguageState) => void>();

  t.on("ui-language:event", (_event: unknown, state: UiLanguageState) => {
    if (typeof state?.intlLocale !== "string") return;
    for (const listener of uiLanguageListeners) listener(state);
  });

  const toolFilterListeners = new Set<(state: ToolFilterState) => void>();

  t.on("tool-filter:event", (_event: unknown, state: ToolFilterState) => {
    if (!state || typeof state !== "object") return;
    for (const listener of toolFilterListeners) listener(state);
  });
  let nativeGlassAvailable = initialAppearance?.glass ?? windowAppearance.glass === "native";
  const nativeGlassListeners = new Set<(available: boolean) => void>();
  const appearanceListeners = new Set<(state: AppearanceState) => void>();

  t.on("appearance:event", (_event: unknown, state: AppearanceState) => {
    if (typeof state?.glass !== "boolean") return;
    for (const listener of appearanceListeners) listener(state);
    if (state.glass === nativeGlassAvailable) return;
    nativeGlassAvailable = state.glass;
    for (const listener of nativeGlassListeners) listener(state.glass);
  });

  return {
    app: {
      platform: t.env.platform,
      windowChrome: windowAppearance.chrome,
      nativeGlass: windowAppearance.glass === "native",
      isNativeGlassAvailable: () => nativeGlassAvailable,
      onNativeGlassChange(handler) {
        nativeGlassListeners.add(handler);
        return () => nativeGlassListeners.delete(handler);
      },
      appearance: {
        initial: initialAppearance,
        get: () => t.invoke("appearance:get") as Promise<AppearanceState>,
        set: (input) => t.invoke("appearance:set", input) as Promise<AppearanceState>,
        onChange(handler) {
          appearanceListeners.add(handler);
          return () => appearanceListeners.delete(handler);
        },
      },
      uiLanguage: {
        initial: initialUiLanguage,
        get: () => t.invoke("ui-language:get") as Promise<UiLanguageState>,
        set: (preference) =>
          t.invoke("ui-language:set", { preference }) as Promise<UiLanguageState>,
        onChange(handler) {
          uiLanguageListeners.add(handler);
          return () => uiLanguageListeners.delete(handler);
        },
      },
      toolFilter: {
        get: () => t.invoke("tool-filter:get") as Promise<ToolFilterState>,
        enable: () => t.invoke("tool-filter:enable") as Promise<ToolFilterState>,
        disable: () => t.invoke("tool-filter:disable") as Promise<ToolFilterState>,
        cancelDownload: () => t.invoke("tool-filter:cancel-download") as Promise<ToolFilterState>,
        onChange(handler) {
          toolFilterListeners.add(handler);
          return () => toolFilterListeners.delete(handler);
        },
      },
      version: () => t.invoke("app:version") as Promise<string>,
      securityState: () => t.invoke("app:security-state") as Promise<SecurityState>,
      startupMetric: (input) => t.invoke("app:startup-metric", input),
    },
    workspace: {
      open: () => t.invoke("workspace:open"),
      list: () => t.invoke("workspace:list"),
      ensureChats: () => t.invoke("workspace:ensure-chats"),
      select: (input) => t.invoke("workspace:select", input),
      pin: (input) => t.invoke("workspace:pin", input),
      rename: (input) => t.invoke("workspace:rename", input),
      archiveChats: (id) => t.invoke("workspace:archive-chats", { id }),
      deleteChats: (id) => t.invoke("workspace:delete-chats", { id }),
      remove: (id) => t.invoke("workspace:remove", { id }),
      reveal: (id) => t.invoke("workspace:reveal", { id }),
    },
    automations: {
      list: () => t.invoke("automation:list"),
      get: (id) => t.invoke("automation:get", { id }),
      history: (id, limit) => t.invoke("automation:history", { id, limit }),
      create: (input) => t.invoke("automation:create", input),
      update: (input) => t.invoke("automation:update", input),
      setEnabled: (id, enabled) => t.invoke("automation:set-enabled", { id, enabled }),
      delete: (id) => t.invoke("automation:delete", { id }),
      runNow: (id) => t.invoke("automation:run-now", { id }),
      stop: (executionId) => t.invoke("automation:stop", { executionId }),
      onEvent(handler) {
        const listener = (_event: unknown, event: AutomationServiceEvent) => handler(event);
        t.on("automation:event", listener);
        return () => t.removeListener("automation:event", listener);
      },
    },
    groupsMigration: {
      notice: () => t.invoke("app:groups-migration-notice"),
      dismissNotice: () => t.invoke("app:groups-migration-notice-dismiss"),
    },
    agents: {
      list: () => t.invoke("agents:list"),
      create: (input) => t.invoke("agents:create", input),
      update: (input) => t.invoke("agents:update", input),
      setArchived: (input) => t.invoke("agents:archive", input),
      remove: (id) => t.invoke("agents:delete", { id }),
      openChat: (id) => t.invoke("agents:open-chat", { id }),
      migratedTranscript: (sessionId) => t.invoke("agent:migrated-group-transcript", sessionId),
      generateProfile: (input) => t.invoke("agents:generate-profile", input),
    },
    file: {
      open: (input) => t.invoke("file:open", input),
    },
    agent: {
      create: (input) => t.invoke("agent:create", input),
      list: (input) => t.invoke("agent:list", input),
      listArchived: (workspaceId) => t.invoke("agent:list-archived", workspaceId),
      listEventPage: (sessionId, options) =>
        t.invoke("agent:list-event-page", { sessionId, options }),
      listRuns: (sessionId) => t.invoke("agent:list-runs", sessionId),
      runWorkspaceRevision: (input) => t.invoke("agent:run-workspace-revision", input),
      ensure: (sessionId) => t.invoke("agent:ensure", sessionId),
      releaseRuntime: (sessionId) => t.invoke("agent:release-runtime", sessionId),
      prompt: (input) => t.invoke("agent:prompt", input),
      branchState: (sessionId) => t.invoke("agent:branch-state", sessionId),
      setBranch: (input) => t.invoke("agent:set-branch", input),
      startPlanBuild: (input) => t.invoke("agent:start-plan-build", input),
      compact: (sessionId) => t.invoke("agent:compact", sessionId),
      abort: (sessionId) => t.invoke("agent:abort", sessionId),
      listQueue: (sessionId) => t.invoke("agent:queue-list", sessionId),
      removeQueued: (input) => t.invoke("agent:queue-remove", input),
      rollback: (input) => t.invoke("agent:rollback", input),
      move: (input) => t.invoke("agent:move", input),
      pin: (input) => t.invoke("agent:pin", input),
      rename: (input) => t.invoke("agent:rename", input),
      archive: (sessionId) => t.invoke("agent:archive", sessionId),
      restore: (sessionId) => t.invoke("agent:restore", sessionId),
      delete: (sessionId) => t.invoke("agent:delete", sessionId),
      applySubagentWorktree: (sessionId) => t.invoke("agent:apply-subagent-worktree", sessionId),
      abortSubagentWorktreeApply: (sessionId) =>
        t.invoke("agent:abort-subagent-worktree-apply", sessionId),
      cleanupSubagentWorktree: (sessionId) =>
        t.invoke("agent:cleanup-subagent-worktree", sessionId),
      setModel: (input) => t.invoke("agent:set-model", input),
      cycleModel: (input) => t.invoke("agent:cycle-model", input),
      onEvent: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as AgentEvent);
        t.on("agent:event", listener);
        return () => t.removeListener("agent:event", listener);
      },
      onFocusSession: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as string);
        t.on("agent:focus-session", listener);
        return () => t.removeListener("agent:focus-session", listener);
      },
    },
    terminal: {
      create: (input) => t.invoke("terminal:create", input),
      write: (input) => t.invoke("terminal:write", input),
      resize: (input) => t.invoke("terminal:resize", input),
      kill: (terminalId) => t.invoke("terminal:kill", terminalId),
      remove: (terminalId) => t.invoke("terminal:remove", terminalId),
      list: () => t.invoke("terminal:list"),
      onEvent: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as TerminalEvent);
        t.on("terminal:event", listener);
        return () => t.removeListener("terminal:event", listener);
      },
    },
    process: {
      list: (input) => t.invoke("process:list", input),
      kill: (id) => t.invoke("process:kill", { id }),
      onChanged: (callback) => {
        const listener = () => callback();
        t.on("process:changed", listener);
        return () => t.removeListener("process:changed", listener);
      },
    },
    browser: {
      listTabs: (input) => t.invoke("browser:list-tabs", input),
      createTab: (input) => t.invoke("browser:create-tab", input),
      selectTab: (input) => t.invoke("browser:select-tab", input),
      closeTab: (input) => t.invoke("browser:close-tab", input),
      navigate: (input) => t.invoke("browser:navigate", input),
      back: (input) => t.invoke("browser:back", input),
      forward: (input) => t.invoke("browser:forward", input),
      reload: (input) => t.invoke("browser:reload", input),
      setBounds: (input) => t.invoke("browser:set-bounds", input),
      show: (input) => t.invoke("browser:show", input),
      hide: (input) => t.invoke("browser:hide", input),
      toggleDevtools: (input) => t.invoke("browser:toggle-devtools", input),
      openExternal: (input) => t.invoke("browser:open-external", input),
      setDesignMode: (input) => t.invoke("browser:design-mode", input),
      find: (input) => t.invoke("browser:find", input),
      findStop: (input) => t.invoke("browser:find-stop", input),
      listRecents: (input) => t.invoke("browser:list-recents", input),
      deleteRecent: (input) => t.invoke("browser:delete-recent", input),
      onEvent: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as BrowserEvent);
        t.on("browser:event", listener);
        return () => t.removeListener("browser:event", listener);
      },
    },
    diff: {
      review: (input) => t.invoke("diff:review", input),
      read: (input) => t.invoke("diff:read", input),
      filePatch: (input) => t.invoke("diff:file-patch", input),
      stage: (input) => t.invoke("diff:stage", input),
      unstage: (input) => t.invoke("diff:unstage", input),
      discardUnstaged: (input) => t.invoke("diff:discard-unstaged", input),
      status: (cwd) => t.invoke("diff:status", cwd),
      stats: (cwd) => t.invoke("diff:stats", cwd),
      statsSince: (input) => t.invoke("diff:stats-since", input),
      sessionStats: (sessionId) => t.invoke("diff:session-stats", sessionId),
      commitOrPush: (input) => t.invoke("diff:commit-or-push", input),
    },
    files: {
      list: (input) => t.invoke("files:list", input),
      read: (input) => t.invoke("files:read", input),
      write: (input) => t.invoke("files:write", input),
      watch: (cwd) => t.invoke("files:watch", cwd),
      isWatching: (cwd) => t.invoke("files:watch-status", cwd),
      unwatch: (cwd) => t.invoke("files:unwatch", cwd),
      onChanged: (callback) => {
        const listener = (_event: unknown, payload: unknown) =>
          callback(payload as FilesChangeEvent);
        t.on("files:event", listener);
        return () => t.removeListener("files:event", listener);
      },
    },
    preview: {
      read: (input) => t.invoke("preview:read", input),
    },
    git: {
      branches: (cwd) => t.invoke("git:branches", cwd),
      checkout: (input) => t.invoke("git:checkout", input),
      isRepository: (cwd) => t.invoke("git:is-repository", cwd),
      init: (cwd) => t.invoke("git:init", cwd),
      log: (input) => t.invoke("git:log", input),
      watch: (cwd) => t.invoke("git:watch", cwd),
      unwatch: (cwd) => t.invoke("git:unwatch", cwd),
      onChanged: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as GitChangeEvent);
        t.on("git:event", listener);
        return () => t.removeListener("git:event", listener);
      },
    },
    permission: {
      decide: (input) => t.invoke("permission:decide", input),
      list: () => t.invoke("permission:list"),
      getMode: (input) => t.invoke("permission:get-mode", input ?? {}),
      setMode: (input) => t.invoke("permission:set-mode", input),
      clearProjectMode: (input) => t.invoke("permission:clear-project-mode", input),
      getAskMissingTarget: () => t.invoke("permission:get-ask-missing-target"),
      setAskMissingTarget: (input) => t.invoke("permission:set-ask-missing-target", input),
    },
    questions: {
      respond: (input) => t.invoke("questions:respond", input),
    },
    context: {
      search: (input) => t.invoke("context:search", input),
      resolve: (input) => t.invoke("context:resolve", input),
    },
    docs: {
      list: (workspaceId) => t.invoke("docs:list", workspaceId),
      add: (input) => t.invoke("docs:add", input),
      search: (input) => t.invoke("docs:search", input),
    },
    projectMemory: {
      snapshot: (input) => t.invoke("project-memory:snapshot", input),
      setEnabled: (input) => t.invoke("project-memory:set-enabled", input),
      verify: (input) => t.invoke("project-memory:verify", input),
      markObsolete: (input) => t.invoke("project-memory:mark-obsolete", input),
      delete: (input) => t.invoke("project-memory:delete", input),
    },
    harnessInsights: {
      get: (input: HarnessInsightsQuery) => t.invoke("harness-insights:get", input),
      listPromotions: (input) => t.invoke("harness-promotions:list", input ?? {}),
      promote: (input) => t.invoke("harness-promotions:promote", input),
      rejectPromotion: (input) => t.invoke("harness-promotions:reject", input),
      listFailureBlacklist: (input) => t.invoke("harness-failure-blacklist:list", input ?? {}),
      clearFailureBlacklist: (input) => t.invoke("harness-failure-blacklist:clear", input ?? {}),
    },
    model: {
      list: () => t.invoke("model:list"),
      setDefault: (model) => t.invoke("model:set-default", model),
      settings: () => t.invoke("model:settings"),
      limits: () => t.invoke("model:limits"),
      refreshLimits: () => t.invoke("model:limits-refresh"),
      setCodexLimitsEnabled: (enabled) => t.invoke("model:limits-set-codex-enabled", { enabled }),
      refreshCatalog: () => t.invoke("model:refresh-catalog"),
      onCatalogChanged: (callback) => {
        const listener = () => callback();
        t.on("model:catalog-changed", listener);
        return () => t.removeListener("model:catalog-changed", listener);
      },
      providerDetail: (provider) => t.invoke("model:provider-detail", provider),
      connectionMethods: (provider) => t.invoke("model:provider-connection-methods", provider),
      startProviderAuth: (input) => t.invoke("model:provider-auth-start", input),
      providerAuthState: (input) => t.invoke("model:provider-auth-state", input),
      respondProviderAuth: (input) => t.invoke("model:provider-auth-respond", input),
      cancelProviderAuth: (input) => t.invoke("model:provider-auth-cancel", input),
      disconnectProvider: (provider) => t.invoke("model:disconnect-provider", provider),
      customProviderConfig: (provider) => t.invoke("model:custom-provider-config", provider),
      deleteCustomProvider: (provider) => t.invoke("model:delete-custom-provider", provider),
      configureProvider: (input) => t.invoke("model:configure-provider", input),
      upsertCustomProvider: (input) => t.invoke("model:upsert-custom-provider", input),
      testCustomProvider: (input) => t.invoke("model:test-custom-provider", input),
      updateConfig: (input) => t.invoke("model:update-config", input),
      setProviderModelsEnabled: (input) => t.invoke("model:set-provider-models-enabled", input),
    },
    review: {
      start: (input) => t.invoke("review:start", input),
      list: (cwd) => t.invoke("review:list", cwd),
    },
    checkpoint: {
      list: (sessionId) => t.invoke("checkpoint:list", sessionId),
      restore: (input) => t.invoke("checkpoint:restore", input),
    },
    mcp: {
      list: () => t.invoke("mcp:list"),
      sync: (cwd) => t.invoke("mcp:sync", cwd),
      approve: (input) => t.invoke("mcp:approve", input),
      openConfig: (cwd) => t.invoke("mcp:open-config", cwd),
      upsert: (input) => t.invoke("mcp:upsert", input),
      delete: (input) => t.invoke("mcp:delete", input),
      setEnabled: (input) => t.invoke("mcp:set-enabled", input),
      entry: (input) => t.invoke("mcp:entry", input),
    },
    rea: {
      getStatus: () => t.invoke("rea:get-status"),
      setEnabled: (enabled) => t.invoke("rea:set-enabled", { enabled }),
      retry: () => t.invoke("rea:retry"),
    },
    composio: {
      getState: () => t.invoke("composio:get-state"),
      diagnose: () => t.invoke("composio:diagnose"),
      setApiKey: (input) => t.invoke("composio:set-api-key", input),
      removeApiKey: () => t.invoke("composio:remove-api-key"),
      refreshCatalog: () => t.invoke("composio:refresh-catalog"),
      listTools: (input) => t.invoke("composio:list-tools", input),
      startConnection: (input) => t.invoke("composio:start-connection", input),
      getConnectionOperation: (input) => t.invoke("composio:get-connection-operation", input),
      setToolkitPolicy: (input) => t.invoke("composio:set-toolkit-policy", input),
      renameAccount: (input) => t.invoke("composio:rename-account", input),
      disconnectAccount: (input) => t.invoke("composio:disconnect-account", input),
    },
    rules: {
      list: (cwd) => t.invoke("rules:list", cwd),
      getAgents: (cwd) => t.invoke("rules:get-agents", cwd),
      saveAgents: (input) => t.invoke("rules:save-agents", input),
    },
    personalization: {
      get: () => t.invoke("personalization:get"),
      save: (input) => t.invoke("personalization:save", input),
      open: () => t.invoke("personalization:open"),
    },
    skills: {
      list: (cwd) => t.invoke("skills:list", cwd),
      get: (input) => t.invoke("skills:get", input),
      create: (input) => t.invoke("skills:create", input),
      openDir: (cwd) => t.invoke("skills:open-dir", cwd),
    },
    subagents: {
      list: (cwd) => t.invoke("subagents:list", cwd),
      get: (input) => t.invoke("subagents:get", input),
      create: (input) => t.invoke("subagents:create", input),
      update: (input) => t.invoke("subagents:update", input),
      delete: (input) => t.invoke("subagents:delete", input),
      openDir: (input) => t.invoke("subagents:open-dir", input),
    },
    window: {
      minimize: () => t.invoke("window:minimize") as Promise<void>,
      toggleMaximize: () => t.invoke("window:toggle-maximize") as Promise<void>,
      close: () => t.invoke("window:close") as Promise<void>,
      getState: () => t.invoke("window:state") as Promise<{ maximized: boolean }>,
      onStateChange: (callback) => {
        const listener = (_event: unknown, payload: unknown) =>
          callback(payload as { maximized: boolean });
        t.on("window:state-event", listener);
        return () => t.removeListener("window:state-event", listener);
      },
    },
    update: {
      getState: () => t.invoke("update:get-state") as Promise<UpdateState>,
      install: () => t.invoke("update:install") as Promise<void>,
      retry: () => t.invoke("update:retry") as Promise<void>,
      restartNow: () => t.invoke("update:restart-now") as Promise<void>,
      dismiss: () => t.invoke("update:dismiss") as Promise<void>,
      openReleasePage: () => t.invoke("update:open-release-page") as Promise<void>,
      saveUiState: (state) => t.invoke("update:save-ui-state", state) as Promise<void>,
      takeRestoredUiState: () =>
        t.invoke("update:take-restored-ui-state") as Promise<UpdateRestoreUiState | null>,
      onStateChange: (callback) => {
        const listener = (_event: unknown, payload: unknown) => callback(payload as UpdateState);
        t.on("update:state-event", listener);
        return () => t.removeListener("update:state-event", listener);
      },
    },
    clipboard: {
      writeImage: (input) => t.invoke("clipboard:write-image", input) as Promise<void>,
    },
    dialog: {
      saveImage: (input) =>
        t.invoke("dialog:save-image", input) as Promise<
          { saved: false } | { saved: true; path: string }
        >,
    },
  };
}
