import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("account integration is removed", () => {
  it("does not bootstrap account services, callbacks or the managed provider", () => {
    expect(source("./index.ts")).not.toMatch(
      /auth-service-instance|billing-service-instance|modus-provider-instance|deep-link\/deep-link|initializeAuthService|shutdownAuthService/,
    );
    expect(source("./ipc/register-app-ipc.ts")).not.toMatch(
      /auth-service-instance|billing-service-instance|registerAuthIpcHandlers|registerBillingIpcHandlers/,
    );
  });

  it("does not expose account APIs or channels through preload", () => {
    expect(source("../preload/index.ts")).not.toMatch(
      /["'](?:auth|billing):|\n {2}(?:auth|billing):/,
    );
    expect(source("../preload/types.ts")).not.toMatch(/\n {2}(?:auth|billing):/);
    expect(source("./ipc/channels.ts")).not.toMatch(/["'](?:auth|billing):/);
  });
});
