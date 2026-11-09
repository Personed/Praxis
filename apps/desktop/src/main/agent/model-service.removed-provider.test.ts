import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let userData: string;
let service: typeof import("./model-service");
let database: ReturnType<typeof import("../db/database").getDatabase>;
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

beforeAll(async () => {
  userData = await mkdtemp(join(tmpdir(), "modus-removed-provider-"));
  service = await import("./model-service");
  database = (await import("../db/database")).getDatabase();
}, 60_000);

afterAll(async () => {
  database?.close();
  await rm(userData, { recursive: true, force: true });
});

describe("removed account provider", () => {
  it("keeps external credentials and exposes settings without account or plan fields", async () => {
    await service.configureProvider({ provider: "openai", apiKey: "test-external-key" });
    const settings = service.getModelSettings();
    expect(settings.providers.some(({ id }) => id === "openai")).toBe(true);
    expect(settings.providers.some(({ id }) => id === "modus")).toBe(false);
    expect(settings.models.some(({ provider }) => provider === "modus")).toBe(false);
    expect(settings).not.toHaveProperty("modus");
    expect(settings).not.toHaveProperty("modusPlan");
    expect(service.getModelRegistry().authStorage.get("openai")).toMatchObject({
      key: "test-external-key",
    });
  });

  it("preserves a legacy saved selection while rejecting requests before network", async () => {
    const legacy = "modus/vendor/model";
    database
      .prepare("insert or replace into app_settings (key, value, updated_at) values (?, ?, ?)")
      .run("model.default", legacy, new Date().toISOString());
    const network = vi.spyOn(globalThis, "fetch");
    try {
      expect(service.getDefaultModelId()).toBe(legacy);
      expect(service.isUsableModelId(legacy)).toBe(false);
      expect(() => service.getDefaultModel()).toThrow(/disabled|removed/);
      await expect(
        service.completeWithModel({ modelId: legacy, systemPrompt: "", prompt: "hello" }),
      ).rejects.toThrow(/disabled|removed/);
      expect(service.getDefaultModelId()).toBe(legacy);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      service.setDefaultModel(undefined);
    }
  });

  it("rejects recreating the removed provider through custom provider settings", async () => {
    await expect(
      service.upsertCustomProvider({
        provider: "modus",
        name: "Modus",
        baseUrl: "https://example.test/v1",
        apiKey: "test-key",
        models: [{ id: "model", name: "Model" }],
      }),
    ).rejects.toThrow(/removed/);
  });
});
