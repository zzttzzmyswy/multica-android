/**
 * 「清空排队」调用点守卫（MYS-2177）。
 *
 * 移动端 vitest 只有 Node 环境（见 vitest.config.ts），没有 RN 渲染器，所以
 * 一个正确的 `clearChatQueue` 只要 chat 屏不调用就等于没修 —— 而这正是本轮
 * 的缺陷形态：函数层面「清了队列」，屏幕上气泡却重新现形。这里钉的是调用点。
 *
 * 断言写成"行为形状"而不是"某一行文本"：`handleQueueClear` 必须走
 * `clearChatQueue`，且不得再出现那个只置空 queued_tasks 的浅清空形态 ——
 * 后者正是幽灵气泡的成因（见 lib/chat-queue-clear.ts 的模块注释）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");
const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body of `handleQueueClear`, from its declaration to the next top-level
 *  `const`/`function` — narrow enough that a match elsewhere in the 1000-line
 *  screen cannot satisfy an assertion. */
function queueClearBody(source: string): string {
  const start = source.indexOf("const handleQueueClear = useCallback(");
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const end = rest.indexOf("\n  const ", 1);
  return end === -1 ? rest : rest.slice(0, end);
}

describe("the chat screen's 清空排队 goes through the message-evicting path", () => {
  const chat = code(CHAT);
  const body = queueClearBody(chat);

  it("calls clearChatQueue — the only path that also evicts the bubbles", () => {
    expect(body).toMatch(/clearChatQueue\(qc, activeSessionId, wsId\)/);
  });

  it("is imported from the module that owns the eviction", () => {
    expect(chat).toMatch(
      /import \{ clearChatQueue \} from "@\/lib\/chat-queue-clear"/,
    );
  });

  it("no longer ships the shallow clear that leaves the ghosts", () => {
    // `patchPending(old => ({...old, queued_tasks: []}))` empties the queue
    // (and therefore the filter) without ever touching the messages cache —
    // the exact shape that made deleted prompts reappear.
    expect(body).not.toMatch(/queued_tasks:\s*\[\]/);
    expect(body).not.toMatch(/patchPending\(/);
    expect(body).not.toMatch(/api\.clearQueuedChatTasks\(/);
  });

  it("still resolves the workspace, so the IM list's aggregate is refreshed", () => {
    // The session list's "typing…" row reads chatKeys.pendingTasks(wsId); a
    // clear that skipped it would leave the aggregate showing a queue the
    // server no longer has.
    expect(body).toMatch(/wsId/);
  });

  it("hands failures to the queue card's Alert instead of swallowing them", () => {
    // ChatQueue.run() catches and shows chat.queue.actionFailed; a `catch {}`
    // here would make a failed clear look like a successful one.
    expect(body).not.toMatch(/\.catch\(/);
  });
});
