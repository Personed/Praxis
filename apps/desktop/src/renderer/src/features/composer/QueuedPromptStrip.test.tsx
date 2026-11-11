// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { QueuedPromptItem } from "../../../../shared/contracts";
import { QueuedPromptStrip } from "./QueuedPromptStrip";

afterEach(cleanup);

const items: QueuedPromptItem[] = [
  { id: "q-1", delivery: "follow-up", text: "Then add a test\n\nfor the parser", imageCount: 0 },
  { id: "q-2", delivery: "steer", text: "Use this screenshot", imageCount: 2 },
];

it("preserves queue order, image counts and removal by runtime id", () => {
  const onRemove = vi.fn();
  render(<QueuedPromptStrip items={items} onRemove={onRemove} />);
  const queue = screen.getByRole("region", { name: "Queued messages" });
  const rows = within(queue).getAllByRole("listitem");
  expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
    "Then add a test for the parser",
    "Use this screenshot",
  ]);
  expect(within(queue).getByText("2 images")).toBeTruthy();
  fireEvent.click(
    within(queue).getByRole("button", { name: "Remove queued message: Use this screenshot" }),
  );
  expect(onRemove).toHaveBeenCalledExactlyOnceWith("q-2");
});

it("leaves the composer clear when the runtime queue is empty", () => {
  render(<QueuedPromptStrip items={[]} onRemove={vi.fn()} />);
  expect(screen.queryByRole("region", { name: "Queued messages" })).toBeNull();
});
