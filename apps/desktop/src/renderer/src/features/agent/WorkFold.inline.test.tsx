// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WorkFold } from "./ActivityGroup";
import type { RunBlockItem, WorkFoldItem } from "./Timeline";

afterEach(cleanup);

it("keeps arriving events visible and settles from the real run status", () => {
  const run: RunBlockItem = {
    id: "run",
    type: "run",
    runId: "run",
    status: "running",
    startedAt: 1,
  };
  const items: WorkFoldItem[] = [
    { id: "thought", type: "thought", text: "Inspecting the project", streaming: true },
  ];
  const view = render(<WorkFold run={run} items={items} />);
  expect(screen.getByText("Inspecting the project")).toBeTruthy();
  expect(
    view.container.querySelector('[data-slot="agent-state"]')?.getAttribute("data-status"),
  ).toBe("working");
  const updated: WorkFoldItem[] = [
    ...items,
    { id: "notice", type: "notice", title: "Files inspected", body: "Inspection complete" },
    { id: "steer", type: "message", role: "user", content: "Also check the tests" },
  ];
  view.rerender(<WorkFold run={run} items={updated} />);
  expect(screen.getByText("Files inspected — Inspection complete")).toBeTruthy();
  view.rerender(<WorkFold run={{ ...run, status: "failed" }} items={updated} />);
  expect(
    view.container.querySelector('[data-slot="agent-state"]')?.getAttribute("data-status"),
  ).toBe("error");
  expect(screen.getByText("Also check the tests")).toBeTruthy();
  expect(screen.queryByText("Files inspected — Inspection complete")).toBeNull();
  const toggle = view.container.querySelector('button[aria-expanded="false"]') as HTMLButtonElement;
  expect(toggle).toBeTruthy();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Inspecting the project")).toBeTruthy();
});
