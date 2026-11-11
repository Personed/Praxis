import { Menu } from "@base-ui/react/menu";
import {
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconGitBranch,
  IconGridDots,
  IconLayoutList,
  IconShieldCheck,
  IconShieldX,
  IconTerminal2,
  IconWorld,
} from "@tabler/icons-react";
import { m, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import {
  lazy,
  type PointerEvent,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SecurityState } from "../../../../preload/types";
import type {
  AgentInfo,
  AgentSessionInfo,
  ContextItem,
  ContextUsageInfo,
  ModelInfo,
  PlanRef,
  WorkspaceInfo,
} from "../../../../shared/contracts";
import { ContentTransition } from "../../components/ui/ContentTransition";
import { ModusLoadingFallback } from "../../components/ui/ModusLoadingMark";
import { PanelHeader } from "../../components/ui/Panel";
import { TOOLBAR_ICON } from "../../components/ui/ToolbarButton";
import { cn } from "../../lib/cn";
import {
  animatePanelWidth,
  MOTION_DURATION,
  MOTION_EASE,
  panelWidthMotion,
  tween,
} from "../../lib/motion";
import { beginResizeGesture, endResizeGesture } from "../../lib/resizeGesture";
import type { AgentEventHub } from "../agent/agentEventHub";
import { DiffPanel } from "../diff/DiffPanel";
import { FilesPanel } from "../files/FilesPanel";
import { PlanPanel } from "../plan/PlanPanel";
import { INSPECTOR_MIN_WIDTH } from "./inspector-layout";
import { SubagentsPanel } from "./SubagentsPanel";

type InspectorProps = {
  assistantAgent?: AgentInfo | undefined;
  assistantAgentId?: string | undefined;
  activeWorkspace: WorkspaceInfo | null;
  cwd?: string | undefined;
  sessionCwd?: string | undefined;
  sessionId?: string | undefined;
  securityState: SecurityState | null;
  open: boolean;
  width: number;
  /** Upper bound from App so the panel can't crush the main column's min width. */
  maxWidth: number;
  /** Controlled active tab (App drives it so events can switch to Files). */
  tab?: string | undefined;
  onTabChange?(tab: string): void;
  /** The session's active plan, shown in the Plan tab (not the file tree). */
  plan?: PlanRef | undefined;
  sessions: AgentSessionInfo[];
  selectedSubagentId?: string | undefined;
  hub: AgentEventHub;
  models: ModelInfo[];
  defaultModel: string;
  contextUsageBySession: Record<string, ContextUsageInfo>;
  onSelectSubagent(id: string | undefined): void;
  onSessionsChanged(): void;
  onModelChange(model: string): void;
  onModelConfigChange(model: string, thinkingVariant: string): Promise<void> | void;
  onOpenReview(cwd?: string): void;
  onOpenSubagent(childSessionId: string): void;
  onOpenFile?(path: string, line?: number): void;
  onOpenPlan?(plan: PlanRef): void;
  onPlanUpdated(plan: PlanRef): void;
  onOpenChange(open: boolean): void;
  onWidthChange(width: number): void;
  onAddToChat?(item: ContextItem): void;
  revealPath?: string | undefined;
  /** Line to open `revealPath` at (C2.1); `key` changes per request. */
  revealLine?: { line: number; key: number } | undefined;
  onRevealConsumed?(): void;
  /** Select this terminal when the Terminal tab opens (composer rail click). */
  revealTerminalId?: string | undefined;
  onRevealTerminalConsumed?(): void;
};

const INSPECTOR_MAX_WIDTH = 1040;
const INSPECTOR_BROWSER_PREFERRED_WIDTH = 760;
const INSPECTOR_COLLAPSED_WIDTH = 0;
const INSPECTOR_TRANSITION = { duration: MOTION_DURATION.slow, ease: MOTION_EASE.gentle };
/** Width tween; content fades in once the width lands (reduced: snap + 120ms fade). */
const INSPECTOR_MOTION = { width: INSPECTOR_TRANSITION, content: tween("instant", "linear") };
const INSPECTOR_TAB_PANEL_CLASS =
  "inspector-tab-panel flex min-h-0 flex-1 flex-col overflow-hidden outline-none";
const loadBrowserPanel = () => import("../browser/BrowserPanel");
const loadTerminalPanel = () => import("../terminal/TerminalPanel");
const BrowserPanel = lazy(() =>
  loadBrowserPanel().then(({ BrowserPanel: Component }) => ({ default: Component })),
);
const TerminalPanel = lazy(() =>
  loadTerminalPanel().then(({ TerminalPanel: Component }) => ({
    default: Component,
  })),
);

const TOOL_GROUPS = [
  {
    label: "Workspace",
    tools: [
      { value: "changes", label: "Changes", Icon: IconGitBranch },
      { value: "plan", label: "Plan", Icon: IconLayoutList },
      { value: "files", label: "Files", Icon: IconFileText },
      { value: "subagents", label: "Subagents", Icon: IconGridDots },
    ],
  },
  {
    label: "Tools",
    tools: [
      { value: "browser", label: "Browser", Icon: IconWorld },
      { value: "terminal", label: "Terminal", Icon: IconTerminal2 },
      { value: "security", label: "Security", Icon: IconShieldCheck },
    ],
  },
] as const;

const INSPECTOR_TOOLS = TOOL_GROUPS.flatMap((group) => [...group.tools]);
type InspectorTool = (typeof INSPECTOR_TOOLS)[number];

function InspectorToolbar({
  tool,
  onSelect,
}: {
  tool: InspectorTool;
  onSelect(value: string): void;
}) {
  const { Icon } = tool;
  return (
    <div className="toolbar-row flex shrink-0 items-center border-b border-hairline bg-transparent px-2">
      <Menu.Root modal={false}>
        <Menu.Trigger
          className="inspector-tool-trigger"
          aria-label={`Inspector tool: ${tool.label}`}
        >
          <Icon aria-hidden="true" size={TOOLBAR_ICON.size} stroke={TOOLBAR_ICON.stroke} />
          <span>{tool.label}</span>
          <IconChevronDown aria-hidden="true" size={12} stroke={1.8} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start" side="bottom" sideOffset={4} className="z-50">
            <Menu.Popup className="inspector-tool-menu" aria-label="Inspector tools">
              <Menu.RadioGroup value={tool.value} onValueChange={onSelect}>
                {TOOL_GROUPS.map(({ label, tools }) => (
                  <Menu.Group className="inspector-tool-group" key={label}>
                    <Menu.GroupLabel className="inspector-tool-group-label">
                      {label}
                    </Menu.GroupLabel>
                    {tools.map(({ Icon: ToolIcon, label: toolLabel, value }) => (
                      <Menu.RadioItem
                        className="inspector-tool-option"
                        closeOnClick
                        key={value}
                        label={toolLabel}
                        value={value}
                      >
                        <ToolIcon aria-hidden="true" size={15} stroke={1.7} />
                        <span className="flex-1">{toolLabel}</span>
                        <Menu.RadioItemIndicator>
                          <IconCheck aria-hidden="true" size={15} stroke={2} />
                        </Menu.RadioItemIndicator>
                      </Menu.RadioItem>
                    ))}
                  </Menu.Group>
                ))}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

function InspectorPanel({
  active,
  children,
  label,
  keepMounted = false,
  className,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  keepMounted?: boolean;
  className?: string;
}) {
  if (!active && !keepMounted) return null;
  return (
    <section
      aria-label={label}
      className={cn(INSPECTOR_TAB_PANEL_CLASS, className)}
      hidden={!active}
    >
      {children}
    </section>
  );
}

export function Inspector({
  assistantAgent,
  assistantAgentId,
  activeWorkspace,
  cwd,
  sessionCwd,
  sessionId,
  securityState,
  open,
  width,
  maxWidth,
  tab: controlledTab,
  onTabChange,
  plan,
  sessions,
  selectedSubagentId,
  hub,
  models,
  defaultModel,
  contextUsageBySession,
  onSelectSubagent,
  onSessionsChanged,
  onModelChange,
  onModelConfigChange,
  onOpenReview,
  onOpenSubagent,
  onOpenFile,
  onOpenPlan,
  onPlanUpdated,
  onOpenChange,
  onWidthChange,
  onAddToChat,
  revealPath,
  revealLine,
  onRevealConsumed,
  revealTerminalId,
  onRevealTerminalConsumed,
}: InspectorProps) {
  const dragStartRef = useRef<{ x: number; width: number } | null>(null);
  const latestWidthRef = useRef(width);
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null);
  const [contentVisible, setContentVisible] = useState(open);
  const [internalTab, setInternalTab] = useState("changes");
  const tool =
    INSPECTOR_TOOLS.find(({ value }) => value === (controlledTab ?? internalTab)) ??
    TOOL_GROUPS[0].tools[0];
  const tab = tool.value;
  const [browserVisited, setBrowserVisited] = useState(tab === "browser");
  const [terminalVisited, setTerminalVisited] = useState(tab === "terminal");
  const shouldRenderBrowser = browserVisited || tab === "browser";
  const shouldRenderTerminal = terminalVisited || tab === "terminal";
  const setTab = (value: string): void => {
    onTabChange?.(value);
    if (controlledTab === undefined) {
      setInternalTab(value);
    }
  };
  // Width is a motion value, not React state: dragging calls `.set()` which
  // writes straight to the DOM (batched to a frame) WITHOUT re-rendering App and
  // its heavy Timeline on every pointermove. open/close still animates smoothly;
  // the drag tracks the cursor 1:1 with no layout-property tween fighting it.
  const panelWidth = useMotionValue(INSPECTOR_COLLAPSED_WIDTH);
  // A zero-width flex item would still leave the workspace gap and panel border.
  const panelDisplay = useTransform(panelWidth, (value) => (value > 0 ? "flex" : "none"));
  // Starts transparent: the content fades in once the first open settles, as it
  // did when it mounted with `initial={{ opacity: 0 }}`.
  const contentOpacity = useMotionValue(0);
  const reducedMotion = useReducedMotion() ?? false;
  const panelMotion = useMemo(
    () => panelWidthMotion(INSPECTOR_MOTION, reducedMotion),
    [reducedMotion],
  );

  // Never strand the body cursor/selection if the panel unmounts mid-drag.
  useEffect(
    () => () => {
      if (dragStartRef.current) {
        endResizeGesture(document.body, resizeHandleRef.current);
        dragStartRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    const idleCallback = window.requestIdleCallback(() => {
      void Promise.allSettled([loadBrowserPanel(), loadTerminalPanel()]);
    });
    return () => window.cancelIdleCallback(idleCallback);
  }, []);

  useEffect(() => {
    if (open && tab === "browser" && width < INSPECTOR_BROWSER_PREFERRED_WIDTH) {
      onWidthChange(Math.min(INSPECTOR_MAX_WIDTH, maxWidth, INSPECTOR_BROWSER_PREFERRED_WIDTH));
    }
  }, [open, onWidthChange, tab, width, maxWidth]);

  useEffect(() => {
    if (tab === "browser") {
      setBrowserVisited(true);
    }
    if (tab === "terminal") {
      setTerminalVisited(true);
    }
  }, [tab]);

  // Drive the open/close animation and keep the motion value in sync when `width`
  // changes from a committed drag or an external update. We never re-animate while
  // a drag is in flight (the pointer owns the value then).
  useEffect(() => {
    if (dragStartRef.current) {
      return;
    }
    latestWidthRef.current = width;
    // Full motion hides the content at once on close; reduced motion fades it
    // out first and hides it once the width has snapped shut.
    if (!open && !panelMotion.reduced) {
      setContentVisible(false);
    }
    const controls = animatePanelWidth(panelWidth, contentOpacity, {
      open,
      openWidth: width,
      closedWidth: INSPECTOR_COLLAPSED_WIDTH,
      motion: panelMotion,
      onSettled: setContentVisible,
    });
    return () => controls.stop();
  }, [open, width, panelWidth, contentOpacity, panelMotion]);

  function startResize(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    dragStartRef.current = { x: event.clientX, width };
    latestWidthRef.current = width;
    resizeHandleRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Keep the resize cursor + kill text selection for the whole gesture without
    // a React state flip.
    beginResizeGesture(document.body, event.currentTarget);
  }

  function resize(event: PointerEvent<HTMLButtonElement>): void {
    if (!dragStartRef.current) {
      return;
    }
    const nextWidth = Math.min(
      INSPECTOR_MAX_WIDTH,
      maxWidth,
      Math.max(
        INSPECTOR_MIN_WIDTH,
        dragStartRef.current.width + dragStartRef.current.x - event.clientX,
      ),
    );
    latestWidthRef.current = nextWidth;
    panelWidth.set(nextWidth);
  }

  function stopResize(): void {
    if (!dragStartRef.current) {
      return;
    }
    dragStartRef.current = null;
    endResizeGesture(document.body, resizeHandleRef.current);
    resizeHandleRef.current = null;
    const finalWidth = latestWidthRef.current;
    // Drag-to-collapse: snapping below the floor closes the panel and keeps the
    // last good width (so reopening doesn't land on a sliver). Otherwise commit
    // once — the single App re-render for the entire drag.
    if (finalWidth < INSPECTOR_MIN_WIDTH + 24) {
      // Don't commit the sliver width; the effect animates the live value → 0 and
      // the last good `width` is restored on reopen.
      onOpenChange(false);
    } else {
      onWidthChange(finalWidth);
    }
  }

  return (
    <m.aside
      aria-label="Right panel"
      className="inspector-surface relative flex min-w-0 shrink-0 flex-col overflow-hidden rounded-b-lg border border-hairline-strong border-t-0"
      data-ui-surface="sidebar"
      style={{ width: panelWidth, display: panelDisplay }}
    >
      {open ? (
        <>
          <button
            aria-label="Resize right panel"
            className="app-no-drag absolute top-0 bottom-0 left-0 z-20 w-3 cursor-col-resize before:absolute before:top-0 before:bottom-0 before:left-0 before:w-px before:bg-transparent hover:before:bg-chip-strong data-[resizing]:before:bg-fg-subtle"
            onBlur={stopResize}
            onLostPointerCapture={stopResize}
            onPointerCancel={stopResize}
            onPointerDown={startResize}
            onPointerMove={resize}
            onPointerUp={stopResize}
            type="button"
          />
          {contentVisible ? (
            <m.div
              className="flex min-h-0 flex-1 flex-col"
              data-panel-content=""
              style={{ width: panelWidth, opacity: contentOpacity }}
            >
              <InspectorToolbar tool={tool} onSelect={setTab} />
              <InspectorPanel active={tab === "changes"} label="Changes">
                <ContentTransition className="flex min-h-0 flex-1 flex-col" transitionKey="changes">
                  <DiffPanel cwd={cwd} sessionId={sessionId} workspaceId={activeWorkspace?.id} />
                </ContentTransition>
              </InspectorPanel>
              <InspectorPanel active={tab === "plan"} label="Plan">
                <ContentTransition className="flex min-h-0 flex-1 flex-col" transitionKey="plan">
                  <PlanPanel active={open && tab === "plan"} sessionCwd={sessionCwd} plan={plan} />
                </ContentTransition>
              </InspectorPanel>
              <InspectorPanel active={tab === "files"} label="Files">
                <ContentTransition className="flex min-h-0 flex-1 flex-col" transitionKey="files">
                  <FilesPanel
                    cwd={cwd}
                    onAddToChat={onAddToChat}
                    onRevealConsumed={onRevealConsumed}
                    revealLine={revealLine}
                    revealPath={revealPath}
                  />
                </ContentTransition>
              </InspectorPanel>
              <InspectorPanel active={tab === "subagents"} label="Subagents">
                <ContentTransition
                  className="flex min-h-0 flex-1 flex-col"
                  transitionKey="subagents"
                >
                  <SubagentsPanel
                    contextUsageBySession={contextUsageBySession}
                    defaultModel={defaultModel}
                    hub={hub}
                    models={models}
                    onModelChange={onModelChange}
                    onModelConfigChange={onModelConfigChange}
                    onOpenReview={onOpenReview}
                    onOpenPlan={(nextPlan) => {
                      onPlanUpdated(nextPlan);
                      onTabChange?.("plan");
                    }}
                    onOpenSubagent={onOpenSubagent}
                    onPlanUpdated={onPlanUpdated}
                    onSelect={onSelectSubagent}
                    onSessionsChanged={onSessionsChanged}
                    parentSessionId={sessionId}
                    selectedId={selectedSubagentId}
                    sessions={sessions}
                    workspace={activeWorkspace}
                  />
                </ContentTransition>
              </InspectorPanel>
              <InspectorPanel active={tab === "browser"} label="Browser" keepMounted>
                {shouldRenderBrowser ? (
                  <Suspense fallback={<ModusLoadingFallback />}>
                    <BrowserPanel active={tab === "browser"} workspaceId={activeWorkspace?.id} />
                  </Suspense>
                ) : null}
              </InspectorPanel>
              <InspectorPanel active={tab === "terminal"} label="Terminal" keepMounted>
                {shouldRenderTerminal ? (
                  <Suspense fallback={<ModusLoadingFallback />}>
                    <TerminalPanel
                      active={tab === "terminal"}
                      key={activeWorkspace?.id ?? "none"}
                      {...(cwd ? { cwd } : {})}
                      {...(onRevealTerminalConsumed ? { onRevealTerminalConsumed } : {})}
                      {...(revealTerminalId ? { revealTerminalId } : {})}
                      {...(sessionId ? { sessionId } : {})}
                      {...(activeWorkspace?.id ? { workspaceId: activeWorkspace.id } : {})}
                    />
                  </Suspense>
                ) : null}
              </InspectorPanel>
              <InspectorPanel
                active={tab === "security"}
                className="scroll-thin overflow-y-auto"
                label="Security"
              >
                <ContentTransition transitionKey="security">
                  <SecurityPanel securityState={securityState} />
                </ContentTransition>
              </InspectorPanel>
            </m.div>
          ) : null}
        </>
      ) : null}
    </m.aside>
  );
}

function SecurityPanel({ securityState }: { securityState: SecurityState | null }) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Security" />
      <div className="space-y-0.5 px-2 py-1">
        {securityState ? (
          Object.entries(securityState).map(([key, value]) => (
            <div
              className="flex items-center justify-between rounded-lg px-2.5 py-2 transition-colors hover:bg-hover"
              key={key}
            >
              <span className="font-mono text-xs text-fg-muted">{key}</span>
              <span
                className={cn(
                  "flex items-center gap-1.5 text-2xs",
                  value ? "text-fg-subtle" : "text-danger",
                )}
              >
                {value ? (
                  <IconShieldCheck size={14} stroke={1.6} />
                ) : (
                  <IconShieldX size={14} stroke={1.6} />
                )}
                {value ? "enforced" : "off"}
              </span>
            </div>
          ))
        ) : (
          <div className="px-2.5 py-2 text-sm text-fg-subtle">Loading preload IPC state…</div>
        )}
      </div>
    </div>
  );
}
