// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WakeSlider from "./WakeSlider";

afterEach(cleanup);

describe("WakeSlider keyboard interaction", () => {
  it("commits arrow and boundary-key changes accessibly", () => {
    const onChange = vi.fn();
    render(<WakeSlider defaultValue={50} onChange={onChange} ariaLabel="Game volume" />);
    const slider = screen.getByRole("slider", { name: "Game volume" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.getAttribute("aria-valuenow")).toBe("51");
    expect(onChange).toHaveBeenLastCalledWith(51);

    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider.getAttribute("aria-valuenow")).toBe("0");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });
});
