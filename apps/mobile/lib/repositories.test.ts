import { describe, expect, it } from "vitest";
import { repositoryIdentity, repositorySource } from "./repositories";

describe("repositoryIdentity", () => {
  it("returns null for empty or unparseable input", () => {
    expect(repositoryIdentity("")).toBeNull();
    expect(repositoryIdentity("   ")).toBeNull();
    expect(repositoryIdentity("not a url")).toBeNull();
  });

  it("normalises https clone urls", () => {
    expect(repositoryIdentity("https://github.com/multica-ai/multica.git")).toBe(
      "github.com/multica-ai/multica",
    );
    expect(repositoryIdentity("https://github.com/multica-ai/multica")).toBe(
      "github.com/multica-ai/multica",
    );
  });

  it("normalises scp-like git@ urls", () => {
    expect(repositoryIdentity("git@github.com:multica-ai/multica.git")).toBe(
      "github.com/multica-ai/multica",
    );
  });

  it("is case-insensitive on the host and keeps the path case", () => {
    expect(repositoryIdentity("https://GITHUB.COM/Multica-ai/Multica")).toBe(
      "github.com/Multica-ai/Multica",
    );
  });
});

describe("repositorySource", () => {
  it("labels github.com urls as github", () => {
    expect(repositorySource("https://github.com/multica-ai/multica.git")).toBe(
      "github",
    );
    expect(repositorySource("git@github.com:multica-ai/multica.git")).toBe(
      "github",
    );
  });

  it("labels other hosts as manual", () => {
    expect(repositorySource("https://git.example.com/org/repo.git")).toBe(
      "manual",
    );
    expect(repositorySource("")).toBe("manual");
  });
});