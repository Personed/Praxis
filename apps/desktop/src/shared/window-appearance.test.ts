import { describe, expect, it } from "vitest";
import { resolveWindowAppearance } from "./window-appearance";

describe("resolveWindowAppearance", () => {
  it("uses macOS native traffic lights and vibrancy", () => {
    expect(resolveWindowAppearance("darwin", "15.0.0")).toEqual({
      chrome: "macos",
      glass: "native",
    });
  });

  it("uses native Windows controls with Acrylic where Windows 11 22H2 is supported", () => {
    expect(resolveWindowAppearance("win32", "10.0.22621")).toEqual({
      chrome: "windows-overlay",
      glass: "native",
    });
  });

  it("keeps the integrated Windows chrome with solid surfaces on older Windows", () => {
    expect(resolveWindowAppearance("win32", "10.0.19045")).toEqual({
      chrome: "windows-overlay",
      glass: "solid",
    });
  });

  it("keeps Linux on its native frame with solid surfaces", () => {
    expect(resolveWindowAppearance("linux", "6.12.0")).toEqual({
      chrome: "system",
      glass: "solid",
    });
  });

  it("keeps the title bar hidden even when the Windows version is unknown", () => {
    expect(resolveWindowAppearance("win32", "unknown")).toEqual({
      chrome: "windows-overlay",
      glass: "solid",
    });
  });
});
