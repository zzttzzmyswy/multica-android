/** Native gestures need device coverage; these guards pin the responder
 * ownership that Node cannot exercise. They are not a native selection test. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const code = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

for (const [path, store] of [
  ["components/chat/chat-message-list.tsx", "useChatSelectStore"],
  ["components/issue/timeline-list.tsx", "useCommentSelectStore"],
] as const) {
  describe(path, () => {
    const source = code(path);
    it("never lets the ancestor tap responder consume Android selection touches", () => {
      expect(source).toContain('disabled={Platform.OS === "android" || !selectingId}');
    });
    it("keeps selection mode while Android scrolls and offers a separate Done control", () => {
      for (const event of ["onScrollBeginDrag", "onMomentumScrollBegin"]) {
        const handler = source.split(event + "={() => {")[1]?.split("}")[0];
        expect(handler?.trim()).toBe(`if (Platform.OS !== "android") ${store}.getState().clear();`);
      }
      expect(source).toMatch(/Platform\.OS === "android" && selectingId \? \(/);
      expect(source).toContain(`onPress={() => ${store}.getState().clear()}`);
      expect(source).toContain('t("common.done")');
      expect(source).toContain('t("menu.selectTextHint")');
    });
  });
}

it("retains the rich renderer and releases the row long-press gesture during selection", () => {
  for (const path of ["components/chat/chat-message-list.tsx", "components/issue/comment-card.tsx"]) {
    const source = code(path);
    expect(source).toContain("selectable={isSelecting}");
    expect(source).toContain("if (isSelecting) return body;");
    expect(source).toContain("<LongPressView");
  }
  const markdown = code("lib/markdown/markdown.tsx");
  expect(markdown).toContain("<EnrichedMarkdownText");
  expect(markdown).toContain("onLinkPress={onLinkPress}");
});

it("uses one selectable Text host across highlighted code lines", () => {
  const source = code("lib/markdown/code-block.tsx").split("function HighlightedCode")[1].split("function CodeBlockHeader")[0];
  expect(source).toMatch(/<Text className={CODE_BLOCK_TEXT_CLASS} selectable={selectable}>\s*{lines\.map/);
  expect(source).toContain('{i > 0 ? "\\n" : ""}');
  expect(source).not.toContain("<View>");
  expect(source).toContain("token.color");
});

it("clears chat selection on session switches and navigation away", () => {
  const source = code("app/(app)/[workspace]/(tabs)/chat.tsx");
  expect(source).toMatch(/useEffect\(\(\) => \{\s*useChatSelectStore.getState\(\).clear\(\);\s*\}, \[activeSessionId\]\)/);
  expect(source).toContain("useCallback(() => () => useChatSelectStore.getState().clear(), [])");
  expect(code("app/(app)/[workspace]/issue/[id].tsx")).toContain("useCommentSelectStore.getState().clear()");
});
