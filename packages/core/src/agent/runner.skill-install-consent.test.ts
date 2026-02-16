import { describe, expect, it } from "vitest";
import {
  evaluateCustomSkillAuthoringConsent,
  evaluateWorkaroundConsent,
  evaluateSkillInstallConsent,
  isEnvironmentInstallCommand,
  isLocalSkillMutationCommand,
  isMutatingClawhubCommand,
  isThirdPartyWorkaroundCommand,
} from "./runner.js";

describe("isMutatingClawhubCommand", () => {
  it("detects clawhub install command", () => {
    expect(
      isMutatingClawhubCommand("npx -y clawhub install spotify --workdir /tmp --dir skills"),
    ).toBe(true);
  });

  it("detects clawhub update command", () => {
    expect(isMutatingClawhubCommand("clawhub update spotify --force")).toBe(true);
  });

  it("does not match non-mutating clawhub commands", () => {
    expect(isMutatingClawhubCommand("clawhub search spotify --limit 10")).toBe(false);
    expect(isMutatingClawhubCommand("clawhub inspect spotify")).toBe(false);
  });

  it("detects wrapped bash flow that expands CLAWHUB_CMD and runs install", () => {
    const command = [
      "cd /tmp/meta-skill-installer && bash -c '",
      "if command -v clawhub >/dev/null 2>&1; then",
      "  CLAWHUB_CMD=(clawhub)",
      "else",
      "  CLAWHUB_CMD=(npx -y clawhub)",
      "fi",
      "\"${CLAWHUB_CMD[@]}\" install \"spotify\" --workdir \"$DATA_DIR\" --dir skills --force",
      "'",
    ].join("\n");
    expect(isMutatingClawhubCommand(command)).toBe(true);
  });
});

describe("evaluateSkillInstallConsent", () => {
  it("does not grant consent for generic capability requests", () => {
    const result = evaluateSkillInstallConsent("随机播放 spotify 中的音乐", false);
    expect(result).toEqual({ allowInstall: false, declined: false });
  });

  it("grants consent for explicit install requests", () => {
    const result = evaluateSkillInstallConsent("请帮我安装 spotify skill", false);
    expect(result).toEqual({ allowInstall: true, declined: false });
  });

  it("grants consent for short affirmative replies when awaiting confirmation", () => {
    const result = evaluateSkillInstallConsent("继续", true);
    expect(result).toEqual({ allowInstall: true, declined: false });
  });

  it("treats standalone Chinese affirmative as consent when awaiting confirmation", () => {
    const result = evaluateSkillInstallConsent("行", true);
    expect(result).toEqual({ allowInstall: true, declined: false });
  });

  it("marks declines explicitly", () => {
    const result = evaluateSkillInstallConsent("不要安装，先别动", true);
    expect(result).toEqual({ allowInstall: false, declined: true });
  });
});

describe("isEnvironmentInstallCommand", () => {
  it("detects package manager install commands", () => {
    expect(isEnvironmentInstallCommand("brew install spogo")).toBe(true);
    expect(isEnvironmentInstallCommand("pnpm add lodash")).toBe(true);
    expect(isEnvironmentInstallCommand("npm install -g clawhub")).toBe(true);
    expect(isEnvironmentInstallCommand("pip install requests")).toBe(true);
  });

  it("does not match read-only package manager commands", () => {
    expect(isEnvironmentInstallCommand("brew list")).toBe(false);
    expect(isEnvironmentInstallCommand("pnpm list --depth 0")).toBe(false);
    expect(isEnvironmentInstallCommand("npm view clawhub")).toBe(false);
  });
});

describe("isThirdPartyWorkaroundCommand", () => {
  it("detects local workaround commands", () => {
    expect(isThirdPartyWorkaroundCommand("spotify_player playback shuffle")).toBe(true);
    expect(isThirdPartyWorkaroundCommand("spogo status")).toBe(true);
    expect(isThirdPartyWorkaroundCommand("osascript -e 'tell app \"Spotify\" to play'")).toBe(true);
    expect(isThirdPartyWorkaroundCommand("curl http://localhost:8123/api/states")).toBe(true);
  });

  it("does not match unrelated commands", () => {
    expect(isThirdPartyWorkaroundCommand("ls -la")).toBe(false);
    expect(isThirdPartyWorkaroundCommand("pnpm test")).toBe(false);
  });
});

describe("evaluateWorkaroundConsent", () => {
  it("does not grant workaround mode for generic capability requests", () => {
    const result = evaluateWorkaroundConsent("随机播放 spotify 中的音乐", false);
    expect(result).toEqual({ allowWorkaround: false, declined: false });
  });

  it("grants workaround mode for explicit local-command intent", () => {
    const result = evaluateWorkaroundConsent("不要安装 skill，直接用本地命令试试", false);
    expect(result).toEqual({ allowWorkaround: true, declined: false });
  });

  it("grants workaround mode for short affirmative replies when awaiting confirmation", () => {
    const result = evaluateWorkaroundConsent("继续", true);
    expect(result).toEqual({ allowWorkaround: true, declined: false });
  });

  it("treats standalone Chinese affirmative as workaround consent when awaiting confirmation", () => {
    const result = evaluateWorkaroundConsent("行", true);
    expect(result).toEqual({ allowWorkaround: true, declined: false });
  });

  it("marks declines when no workaround intent is present", () => {
    const result = evaluateWorkaroundConsent("不要，先别执行", true);
    expect(result).toEqual({ allowWorkaround: false, declined: true });
  });
});

describe("isLocalSkillMutationCommand", () => {
  it("detects direct local skill mutation commands", () => {
    expect(
      isLocalSkillMutationCommand(
        "mkdir -p ~/.super-multica/skills/notion-integration && touch ~/.super-multica/skills/notion-integration/SKILL.md",
      ),
    ).toBe(true);

    expect(
      isLocalSkillMutationCommand(
        "cat > ~/.super-multica/skills/notion-integration/SKILL.md << 'EOF'\n# skill\nEOF",
      ),
    ).toBe(true);
  });

  it("does not match read-only commands or clawhub install flow", () => {
    expect(isLocalSkillMutationCommand("cat ~/.super-multica/skills/notion/SKILL.md")).toBe(false);
    expect(
      isLocalSkillMutationCommand(
        "npx -y clawhub install notion --workdir ~/.super-multica --dir skills --force",
      ),
    ).toBe(false);
  });
});

describe("evaluateCustomSkillAuthoringConsent", () => {
  it("does not grant consent for generic third-party requests", () => {
    const result = evaluateCustomSkillAuthoringConsent("帮我在 Notion 新建一个页面", false);
    expect(result).toEqual({ allowAuthoring: false, declined: false });
  });

  it("grants consent when user explicitly asks to create a custom skill", () => {
    const result = evaluateCustomSkillAuthoringConsent("请帮我创建一个 Notion skill", false);
    expect(result).toEqual({ allowAuthoring: true, declined: false });
  });

  it("grants consent for short affirmatives when awaiting confirmation", () => {
    const result = evaluateCustomSkillAuthoringConsent("继续", true);
    expect(result).toEqual({ allowAuthoring: true, declined: false });
  });

  it("marks declines explicitly", () => {
    const result = evaluateCustomSkillAuthoringConsent("先别创建技能", true);
    expect(result).toEqual({ allowAuthoring: false, declined: true });
  });
});
