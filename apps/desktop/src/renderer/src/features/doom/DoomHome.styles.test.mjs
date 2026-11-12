import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("hides only the help text on short screens and keeps a 44px navigation hit area", () => {
  const css = readFileSync(new URL("./DoomHome.css", import.meta.url), "utf8");
  const compact = css.slice(css.indexOf("@media (max-height: 560px)"));
  const navigation = css.match(/\.doom-home-sidebar\s*\{([^}]+)\}/)?.[1];

  expect(compact).toContain("display: none");
  expect(navigation).toContain("width: 44px");
  expect(navigation).toContain("height: 44px");
});

it("reserves a row above the prompt for the DOOM stage", () => {
  const css = readFileSync(new URL("./DoomHome.css", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../app/App.tsx", import.meta.url), "utf8");

  expect(app).toContain('isDoomHome && "doom-home-app-layout"');
  expect(css).toContain("grid-template-rows: minmax(0, 1fr) max-content");
  expect(css).toContain("grid-row: 1");
  expect(css).toContain("grid-row: 2");
});
