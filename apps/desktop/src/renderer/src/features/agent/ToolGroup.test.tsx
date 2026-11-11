// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkActivityRow, WorkFold, workActivityStreamCounts } from "./ActivityGroup";
import type { GroupedWorkActivityItem, RunBlockItem, WorkFoldItem } from "./Timeline";

afterEach(cleanup);

const tool = (id: string, name: string, args: unknown, done = true): GroupedWorkActivityItem => ({
  id,
  type: "tool",
  name,
  args,
  output: name === "grep" ? "a.ts:1: x" : "",
  ...(done ? { isComplete: true } : {}),
});

describe("work activity trace", () => {
  it("counts distinct files and searches for the streaming detail", () => {
    expect(
      workActivityStreamCounts([
        tool("1", "read", { path: "a.ts" }),
        tool("2", "read", { path: "a.ts" }),
        tool("3", "edit", { path: "b.ts" }),
        tool("4", "grep", { pattern: "x" }),
        tool("5", "bash", { command: "ls" }),
      ]),
    ).toBe("2 files, 1 search");
    expect(workActivityStreamCounts([tool("1", "bash", { command: "ls" })])).toBe("");
  });

  it("opens a running trace with counts and preserves its nested tool card", () => {
    const run: RunBlockItem = {
      id: "run",
      type: "run",
      runId: "run",
      status: "running",
      startedAt: Date.now(),
    };
    const items: WorkFoldItem[] = [
      {
        id: "g",
        type: "work-activity-group",
        items: [tool("1", "read", { path: "a.ts" }), tool("2", "grep", { pattern: "x" }, false)],
      },
    ];
    render(<WorkFold items={items} run={run} />);
    const group = screen.getByRole("button", { name: /Searching/ });
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("1 file, 1 search")).toBeTruthy();
    expect(screen.getByText("Searching…")).toBeTruthy();
    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("false");
  });

  it("settled group shows the summary label and no streaming detail", () => {
    const run: RunBlockItem = {
      id: "run",
      type: "run",
      runId: "run",
      status: "completed",
      startedAt: 0,
      completedAt: 1000,
    };
    const items: WorkFoldItem[] = [
      {
        id: "g",
        type: "work-activity-group",
        items: [tool("1", "read", { path: "a.ts" }), tool("2", "read", { path: "b.ts" })],
      },
    ];
    render(<WorkFold items={items} run={run} />);
    const group = screen.getByRole("button", { name: /Read 2 files/ });
    expect(screen.getByText("2 steps")).toBeTruthy();
    expect(group.getAttribute("aria-expanded")).toBe("false");
  });

  it("WorkActivityRow still renders non-search tools through ToolCard", () => {
    render(<WorkActivityRow item={tool("1", "read", { path: "src/a.ts" })} />);
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });
});
