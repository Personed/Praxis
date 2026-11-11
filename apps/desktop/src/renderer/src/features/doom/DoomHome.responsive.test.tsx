// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoomHome } from "./DoomHome";

afterEach(cleanup);

describe("DOOM home compact layout", () => {
  it("keeps navigation and every control available to assistive technology", () => {
    render(<DoomHome sidebarOpen={false} onToggleSidebar={vi.fn()} />);
    const frame = screen.getByTitle("DOOM Web Wide");
    expect(frame.getAttribute("src")).toMatch(/\/doom\.html$/);
    expect(frame.getAttribute("allow")).toBe("autoplay");
    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-pointer-lock",
    );

    expect(screen.getByRole("button", { name: "Abrir navegação" })).toBeTruthy();
    expect(screen.getByText("Mover")).toBeTruthy();
    expect(screen.getByText("Mirar")).toBeTruthy();
    expect(screen.getByText("Atirar")).toBeTruthy();
    expect(screen.getByText("Interagir")).toBeTruthy();
    expect(screen.getByText("Correr")).toBeTruthy();
    expect(screen.getByText("Liberar mouse")).toBeTruthy();
  });

  it("keeps the game frame mounted while the route is inactive", () => {
    const onToggleSidebar = vi.fn();
    const { rerender } = render(
      <DoomHome active={false} sidebarOpen={false} onToggleSidebar={onToggleSidebar} />,
    );
    const frame = screen.getByTitle("DOOM Web Wide");
    rerender(<DoomHome sidebarOpen={false} onToggleSidebar={onToggleSidebar} />);
    expect(screen.getByTitle("DOOM Web Wide")).toBe(frame);
  });
});
