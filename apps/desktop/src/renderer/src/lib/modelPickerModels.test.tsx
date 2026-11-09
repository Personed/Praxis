// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildModelPickerGroups,
  isModusModelId,
  ModelOptions,
  selectableModels,
} from "./modelPickerModels";

afterEach(cleanup);

const models = [
  { id: "zai/glm", name: "GLM", provider: "zai", providerName: "Zai" },
  { id: "modus/vendor/model", name: "Legacy", provider: "modus" },
  { id: "openai/gpt", name: "GPT", provider: "openai", providerName: "OpenAI" },
  { id: "openai/other", name: "Other", provider: "openai", providerName: "OpenAI" },
];

describe("model picker groups", () => {
  it("groups local and external providers alphabetically and preserves model order", () => {
    const result = buildModelPickerGroups(models);
    expect(result.groups.map(({ label }) => label)).toEqual(["OpenAI", "Zai"]);
    expect(result.groups[0]?.models.map(({ id }) => id)).toEqual(["openai/gpt", "openai/other"]);
    expect(result.loose).toEqual([]);
  });

  it("excludes removed account models even from stale or unprefixed catalog entries", () => {
    expect(
      selectableModels([
        { id: "modus/a/b", name: "Legacy" },
        { id: "a/b", name: "Legacy", provider: "modus" },
        { id: "local/model", name: "Local", provider: "local" },
      ]).map(({ id }) => id),
    ).toEqual(["local/model"]);
    expect(isModusModelId("modus/a/b")).toBe(true);
    expect(isModusModelId(undefined)).toBe(false);
  });

  it("preserves an unavailable saved value without substituting another provider", () => {
    expect(buildModelPickerGroups(models, "modus/vendor/model").loose).toEqual([
      { id: "modus/vendor/model", label: "Legacy (unavailable)" },
    ]);
    expect(buildModelPickerGroups(models, "gone/model").loose[0]?.label).toBe(
      "gone/model (unavailable)",
    );
  });

  it("renders a saved legacy value as unavailable with only external provider groups", () => {
    const { container } = render(
      <select defaultValue="modus/vendor/model">
        <ModelOptions models={models} savedModelId="modus/vendor/model" />
      </select>,
    );
    expect(container.querySelector("select")?.value).toBe("modus/vendor/model");
    expect([...container.querySelectorAll("optgroup")].map(({ label }) => label)).toEqual([
      "OpenAI",
      "Zai",
    ]);
    expect(container.textContent).toContain("Legacy (unavailable)");
  });
});
