import { describe, expect, it } from "vitest";
import { daemonRuntimesDocsHref } from "./runtime-docs";

describe("daemonRuntimesDocsHref", () => {
  it("uses the localized docs path for zh", () => {
    expect(daemonRuntimesDocsHref("zh")).toBe(
      "https://multica.ai/docs/zh/daemon-runtimes",
    );
  });

  it("stays at the root for en", () => {
    expect(daemonRuntimesDocsHref("en")).toBe(
      "https://multica.ai/docs/daemon-runtimes",
    );
  });
});
