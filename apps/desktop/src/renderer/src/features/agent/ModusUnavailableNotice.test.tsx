// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ModusUnavailableNotice } from "./ModusUnavailableNotice";

afterEach(() => cleanup());

describe("legacy model availability notice", () => {
  it("shows inline for the legacy model without suggesting account or purchase", () => {
    render(
      <ModusUnavailableNotice
        modelIds={["openai/gpt-x", "modus/deepseek/deepseek-flash"]}
      />,
    );
    const notice = screen.getByTestId("modus-unavailable-notice");
    expect(notice.getAttribute("role")).toBe("status");
    expect(notice.textContent).toMatch(/model is no longer available/i);
    expect(notice.textContent).not.toMatch(/sign in|login|credit|upgrade|buy/i);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not show for a user-configured provider", () => {
    render(<ModusUnavailableNotice modelIds={["openai/gpt-x", undefined]} />);
    expect(screen.queryByTestId("modus-unavailable-notice")).toBeNull();
  });
});
