import { describe, expect, it } from "vitest";
import {
  isRepoAttached,
  repoShortLabel,
  repositoryIdentity,
  repositorySource,
} from "./repositories";

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
describe("repoShortLabel", () => {
  it("reduces github clone urls to owner/repo", () => {
    expect(repoShortLabel("https://github.com/multica-ai/multica.git")).toBe(
      "multica-ai/multica",
    );
    expect(repoShortLabel("https://github.com/multica-ai/multica")).toBe(
      "multica-ai/multica",
    );
    expect(repoShortLabel("https://www.github.com/multica-ai/multica/")).toBe(
      "multica-ai/multica",
    );
  });

  it("reduces scp-like github urls to owner/repo", () => {
    expect(repoShortLabel("git@github.com:multica-ai/multica.git")).toBe(
      "multica-ai/multica",
    );
  });

  it("falls back to the raw url when there is no owner/repo to show", () => {
    expect(repoShortLabel("https://git.example.com/org/repo.git")).toBe(
      "https://git.example.com/org/repo.git",
    );
    expect(repoShortLabel("https://github.com/only-owner")).toBe(
      "https://github.com/only-owner",
    );
    expect(repoShortLabel("")).toBe("");
  });
});

describe("isRepoAttached", () => {
  it("is false when nothing is attached", () => {
    expect(isRepoAttached("https://github.com/o/r", [])).toBe(false);
  });

  it("matches on the exact url", () => {
    expect(
      isRepoAttached("https://github.com/o/r", ["https://github.com/o/r"]),
    ).toBe(true);
  });

  it("matches across .git / scp / trailing-slash spellings", () => {
    // The manual-URL fallback can register a differently-spelled but
    // identical repo; tapping the workspace row would then 409 server-side,
    // so the row must read as attached.
    const attached = ["https://github.com/o/r.git"];
    expect(isRepoAttached("https://github.com/o/r", attached)).toBe(true);
    expect(isRepoAttached("git@github.com:o/r.git", attached)).toBe(true);
    expect(isRepoAttached("https://github.com/o/r/", attached)).toBe(true);
  });

  it("does not treat a different repo on the same host as attached", () => {
    expect(
      isRepoAttached("https://github.com/o/other", [
        "https://github.com/o/r",
      ]),
    ).toBe(false);
  });

  it("ignores unparseable entries instead of matching them all", () => {
    expect(isRepoAttached("not a url", ["also not a url"])).toBe(false);
  });
});
