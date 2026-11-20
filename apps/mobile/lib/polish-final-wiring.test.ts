import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

const code = (name: string) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

describe("polish regression checks", () => {
  it("keeps queued cancellation changes inside the confirmed action", () => {
    const chat = code("app/(app)/[workspace]/(tabs)/chat.tsx");
    const queue = code("components/chat/chat-queue.tsx");
    for (const action of ["Edit", "Remove"]) {
      const start = chat.indexOf(`const handleQueue${action}`);
      const end = chat.indexOf("\n  );", start);
      const handler = chat.slice(start, end);
      const startConfirmed = handler.indexOf("reconcileQueueCancellation(async () =>");
      const request = handler.indexOf("await api.cancelTaskById");
      const evict = handler.indexOf("removePendingChatTask");
      const refresh = handler.indexOf("() => invalidatePendingTask(qc, sessionId)");
      expect(startConfirmed).toBeGreaterThan(-1);
      expect(request).toBeGreaterThan(startConfirmed);
      expect(evict).toBeGreaterThan(request);
      expect(refresh).toBeGreaterThan(evict);
    }
    const guard = queue.indexOf("if (inFlight.current) return;");
    expect(guard).toBeGreaterThan(-1);
    expect(queue.indexOf("inFlight.current = true;")).toBeGreaterThan(guard);
    expect(queue.indexOf("await action();")).toBeGreaterThan(guard);
    expect(queue).toContain("nestedScrollEnabled");
  });

  it("keeps the signed-out showcase offline and its close control reachable", () => {
    const demo = code("app/(auth)/demo.tsx");
    expect(demo).toMatch(
      /className="size-12 shrink-0 rounded-xl"\s+onPress=\{closeDemo\}/,
    );
    expect(demo).toContain('accessibilityRole="header"');
    expect(demo).not.toMatch(/@\/data\/|useQuery\(|fetch\(/);
  });
});
