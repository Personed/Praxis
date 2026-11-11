import { memo } from "react";
import type { AgentInfo, ModelInfo, PlanRef } from "../../../../shared/contracts";
import { getToolUiMeta, type ToolSummaryMeta, toolRenderKind } from "../../../../shared/tools";
import { AgentState } from "../../components/conversation/agent-state";
import {
  ThinkingState,
  type TraceNode,
} from "../../components/conversation/ai-thinking-and-tool-calls";
import { WorkingText } from "../../components/ui/WorkingText";
import { cn } from "../../lib/cn";
import { MessageBlock } from "./MessageBlock";
import { SubagentRow } from "./SubagentRow";
import { subagentActivityLabel } from "./subagentUi";
import type {
  CompactionBlockItem,
  GroupedWorkActivityItem,
  RunBlockItem,
  WorkActivityItem,
  WorkFoldItem,
} from "./Timeline";
import { TodosCard } from "./TodosCard";
import { ToolCard } from "./ToolCard";

export function formatElapsed(end: number, start: number): string {
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Single-line tool-style compaction status (WorkingText while running). */
export function CompactionRow({ status, detail }: Pick<CompactionBlockItem, "status" | "detail">) {
  const running = status === "running";
  const danger = status === "aborted" || status === "error";
  const label = running ? "Compacting context" : (detail ?? "Context compacted");
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {running ? (
        <WorkingText className="shrink-0 font-medium">{label}</WorkingText>
      ) : (
        <span className={cn("shrink-0 font-medium", danger ? "text-danger" : "text-fg-subtle")}>
          {label}
        </span>
      )}
    </div>
  );
}

function toolTarget(item: Extract<WorkActivityItem, { type: "tool" }>): string | undefined {
  const key = getToolUiMeta(item.name)?.primaryArgKey;
  if (!key || !item.args || typeof item.args !== "object" || Array.isArray(item.args))
    return undefined;
  const value = (item.args as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : undefined;
}

const thoughtText = (text: string) => text.trim().replace(/\s+/g, " ");

function isActivityActive(item: GroupedWorkActivityItem): boolean {
  if (item.type === "thought") return item.streaming === true;
  if (item.type === "tool") return item.isComplete !== true && item.isError !== true;
  return item.status === "running";
}

function activeActivityLabel(item: GroupedWorkActivityItem): string {
  if (item.type === "thought") {
    const preview = thoughtText(item.text);
    return preview ? `Thinking · ${preview}` : "Thinking";
  }
  if (item.type === "compaction") return "Compacting context";
  const meta = getToolUiMeta(item.name);
  const target = toolTarget(item);
  return `${meta?.activeVerb ?? meta?.verb ?? "Running"}${target ? ` ${target}` : ""}`;
}

function settledActivityLabel(items: GroupedWorkActivityItem[]): string {
  const buckets = new Map<string, ToolSummaryMeta & { keys: Set<string> }>();
  let unspecifiedTools = 0;
  for (const item of items) {
    if (item.type !== "tool") continue;
    const summary = getToolUiMeta(item.name)?.summary;
    if (!summary) {
      unspecifiedTools += 1;
      continue;
    }
    const bucketKey = `${summary.verb}\0${summary.noun.one}\0${summary.noun.other}`;
    const bucket = buckets.get(bucketKey) ?? { ...summary, keys: new Set<string>() };
    bucket.keys.add(summary.countBy === "target" ? (toolTarget(item) ?? item.id) : item.id);
    buckets.set(bucketKey, bucket);
  }
  const parts = Array.from(buckets.values(), ({ verb, noun, keys }) => {
    const count = keys.size;
    return `${verb} ${count} ${count === 1 ? noun.one : noun.other}`;
  });
  if (unspecifiedTools > 0) {
    parts.push(`used ${unspecifiedTools} ${unspecifiedTools === 1 ? "tool" : "tools"}`);
  }
  const thought = items.findLast((item) => item.type === "thought" && item.text.trim());
  const label =
    parts.join(", ") ||
    (thought?.type === "thought" ? `Thought · ${thoughtText(thought.text)}` : "Completed activity");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function workActivityPresentation(items: GroupedWorkActivityItem[]) {
  const activeItem = items.findLast(isActivityActive);
  const danger = items.some((item) =>
    item.type === "tool"
      ? item.isError === true
      : item.type === "compaction" && item.status === "error",
  );
  const label = activeItem ? activeActivityLabel(activeItem) : settledActivityLabel(items);
  return {
    label: danger && !activeItem ? `Failed: ${label}` : label,
    active: !!activeItem,
    streamCounts: workActivityStreamCounts(items),
  };
}

const FILE_TOOLS = new Set(["read", "edit", "write"]);
const SEARCH_TOOLS = new Set(["grep", "find", "web_search"]);

/**
 * Live counts shown next to a streaming group's label (ported from Agent
 * Elements' tool-group): distinct files touched and searches run so far,
 * e.g. "2 files, 1 search". Empty when the group has neither.
 */
export function workActivityStreamCounts(items: GroupedWorkActivityItem[]): string {
  const files = new Set<string>();
  let searches = 0;
  for (const item of items) {
    if (item.type !== "tool") continue;
    if (FILE_TOOLS.has(item.name)) files.add(toolTarget(item) ?? item.id);
    else if (SEARCH_TOOLS.has(item.name)) searches += 1;
  }
  const parts: string[] = [];
  if (files.size > 0) parts.push(`${files.size} ${files.size === 1 ? "file" : "files"}`);
  if (searches > 0) parts.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  return parts.join(", ");
}

/**
 * Short, verb-only phase label for the fold header while the turn runs.
 *
 * Derived purely from real activity events (no timer, no fabricated phases):
 * only the *running* item yields a label, so settled work never leaves a stale
 * phase on screen. Detail (tool targets, thought text) stays in the expandable
 * trace, so the header never echoes the trace.
 */
function phaseLabelForItem(item: WorkFoldItem): string | undefined {
  switch (item.type) {
    case "thought":
      return item.streaming ? "Thinking" : undefined;
    case "tool": {
      if (item.isComplete === true || item.isError === true) {
        return undefined;
      }
      // Active state must read present-tense and short. Builtins supply
      // `activeVerb`; MCP tools only carry the raw server name as their `verb`
      // (arbitrary length) and `wait`'s verb is past tense — both fall back to
      // a neutral label instead of echoing the tool's completed-state verb.
      return getToolUiMeta(item.name)?.activeVerb ?? "Working";
    }
    case "compaction":
      return item.status === "running" ? "Compacting context" : undefined;
    case "todos":
      return item.updating ? "Updating to-dos" : undefined;
    case "subagent":
      return item.status === "running" || item.status === "blocked"
        ? "Waiting on subagent"
        : undefined;
    case "message":
      return item.role === "assistant" && item.streaming ? "Writing" : undefined;
    case "work-activity-group":
      for (let i = item.items.length - 1; i >= 0; i -= 1) {
        const activity = item.items[i];
        if (!activity) continue;
        const label = phaseLabelForItem(activity);
        if (label) return label;
      }
      return undefined;
    default:
      return undefined;
  }
}

/** Current real phase for a turn's fold, or undefined when nothing is running. */
export function workFoldPhaseLabel(items: WorkFoldItem[]): string | undefined {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) continue;
    const label = phaseLabelForItem(item);
    if (label) return label;
  }
  return undefined;
}

export function WorkActivityRow({
  item,
  models,
  cwd,
  onOpenFile,
  onOpenSubagent,
  onOpenPlan,
}: {
  item: WorkActivityItem;
  models?: ModelInfo[];
  /** Session cwd: search result rows resolve and contain their paths in it. */
  cwd?: string | undefined;
  onOpenFile?(path: string, line?: number): void;
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  if (item.type === "thought") {
    if (!item.streaming && !item.text.trim()) return null;
    return (
      <ThinkingState
        autoPlay={false}
        defaultExpanded={Boolean(item.streaming)}
        nodes={[
          {
            id: item.id,
            type: "reasoning",
            sentences: [item.text],
            status: item.streaming ? "running" : "completed",
          },
        ]}
      />
    );
  }
  if (item.type === "todos") return <TodosCard {...item} />;
  if (item.type === "subagent") {
    return (
      <SubagentRow
        {...item}
        activityLabel={subagentActivityLabel(item.status, item.activity)}
        modelId={item.model}
        models={models}
        onClick={() => onOpenSubagent?.(item.childSessionId)}
      />
    );
  }
  if (item.type === "compaction") return <CompactionRow {...item} />;
  return (
    <ToolCard
      {...item}
      {...(cwd ? { cwd } : {})}
      {...(onOpenFile ? { onOpenFile } : {})}
      {...(item.plan && onOpenPlan ? { onOpenPlan, plan: item.plan } : {})}
    />
  );
}

function traceStatus(
  item: Exclude<WorkFoldItem, { type: "work-activity-group" }>,
  active: boolean,
): NonNullable<TraceNode["status"]> {
  if (item.type === "tool" && item.isError) return "failed";
  if (item.type === "subagent" && item.status === "failed") return "failed";
  if (item.type === "compaction" && item.status === "error") return "failed";
  return active && phaseLabelForItem(item) ? "running" : "completed";
}

/** Keep the execution trace in order with its messages and delivered artifacts. */
export const WorkFold = memo(function WorkFold({
  assistantAgent,
  assistantAgentId,
  run,
  items,
  models,
  cwd,
  onOpenFile,
  onOpenSubagent,
  onOpenPlan,
}: {
  assistantAgent?: AgentInfo | undefined;
  assistantAgentId?: string | undefined;
  run: RunBlockItem;
  items: WorkFoldItem[];
  models?: ModelInfo[];
  cwd?: string | undefined;
  onOpenFile?(path: string, line?: number): void;
  onOpenSubagent?(childSessionId: string): void;
  onOpenPlan?(plan: PlanRef): void;
}) {
  const active = run.status === "running" || run.status === "blocked";
  const flat = items.flatMap((item) => (item.type === "work-activity-group" ? item.items : [item]));
  const nodes: TraceNode[] = flat.map((item) => ({
    id: item.id,
    type: item.type === "thought" ? "reasoning" : item.type === "tool" ? "tool" : "step",
    primary:
      item.type === "tool"
        ? item.name
        : item.type === "thought"
          ? "Thinking"
          : item.type === "notice"
            ? item.title
            : item.type === "message"
              ? "Message"
              : item.type,
    status: traceStatus(item, active),
    alwaysVisible:
      item.type === "message" ||
      (item.type === "tool" && !item.isError && toolRenderKind(item.name) === "visual"),
    renderContent: () => {
      if (item.type === "thought")
        return <div className="whitespace-pre-wrap text-sm text-fg-muted">{item.text}</div>;
      if (item.type === "notice")
        return (
          <div>
            {item.title}
            {item.body ? ` — ${item.body}` : ""}
          </div>
        );
      if (item.type === "message")
        return (
          <MessageBlock
            assistantAgent={assistantAgent}
            assistantAgentId={assistantAgentId}
            content={item.content}
            cwd={cwd}
            messageId={item.id}
            messageRole={item.role}
            onOpenFile={onOpenFile}
            streaming={item.streaming ?? false}
            {...(item.attachments ? { attachments: item.attachments } : {})}
            {...(item.contextChips ? { contextChips: item.contextChips } : {})}
            {...(item.skills ? { skills: item.skills } : {})}
            {...(item.sources ? { sources: item.sources } : {})}
            {...(item.sourceStatus ? { sourceStatus: item.sourceStatus } : {})}
          />
        );
      return (
        <WorkActivityRow
          item={item}
          {...(models ? { models } : {})}
          {...(cwd ? { cwd } : {})}
          {...(onOpenFile ? { onOpenFile } : {})}
          {...(onOpenPlan ? { onOpenPlan } : {})}
          {...(onOpenSubagent ? { onOpenSubagent } : {})}
        />
      );
    },
  }));
  return (
    <section className="min-w-0 text-sm" aria-label="Execution activity">
      <AgentState
        size="sm"
        status={
          run.status === "blocked"
            ? "needs-input"
            : active
              ? "working"
              : run.status === "failed"
                ? "error"
                : run.status === "cancelled"
                  ? "idle"
                  : "complete"
        }
        label={
          workFoldPhaseLabel(items) ??
          (active
            ? "Working"
            : run.status === "failed"
              ? "Failed"
              : run.status === "cancelled"
                ? "Stopped"
                : "Completed")
        }
      />
      <ThinkingState nodes={nodes} autoPlay={false} live={active} />
    </section>
  );
});
