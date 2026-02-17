import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Hub } from "../hub/hub.js";
import type { AsyncAgent } from "../agent/async-agent.js";
import type { ChannelPlugin, ChannelMessage } from "./types.js";
import { ChannelManager } from "./manager.js";

type AgentEventCallback = (event: unknown) => void;

type AgentHarness = {
  agent: AsyncAgent;
  write: ReturnType<typeof vi.fn>;
  emit: (event: unknown) => void;
};

function createAgentHarness(sessionId: string): AgentHarness {
  let subscriber: AgentEventCallback | null = null;
  const write = vi.fn();

  const agent = {
    sessionId,
    closed: false,
    subscribe: (callback: AgentEventCallback) => {
      subscriber = callback;
      return () => {
        subscriber = null;
      };
    },
    write,
  } as unknown as AsyncAgent;

  return {
    agent,
    write,
    emit: (event: unknown) => {
      subscriber?.(event);
    },
  };
}

function createHarness() {
  const conversations = new Map<string, AgentHarness>();
  let conversationCounter = 0;

  const createConversation = vi.fn(() => {
    conversationCounter += 1;
    const id = `conv-${conversationCounter}`;
    const harness = createAgentHarness(id);
    conversations.set(id, harness);
    return harness.agent;
  });

  const hub = {
    listConversations: vi.fn(() => ["existing-conv"]),
    createConversation,
    getConversation: vi.fn((conversationId: string) => conversations.get(conversationId)?.agent),
    getConversationAgentId: vi.fn(() => "agent-1"),
    broadcastInbound: vi.fn(),
  } as unknown as Hub;

  const replyText = vi.fn(async () => {});
  const sendText = vi.fn(async () => {});
  const addReaction = vi.fn(async () => {});

  const plugin: ChannelPlugin = {
    id: "telegram",
    meta: {
      name: "Telegram",
      description: "test",
    },
    config: {
      listAccountIds: () => [],
      resolveAccount: () => undefined,
      isConfigured: () => false,
    },
    gateway: {
      start: async () => {},
    },
    outbound: {
      replyText,
      sendText,
      addReaction,
    },
  };

  const routeIncomingToManager = (target: ChannelManager, message: ChannelMessage) => {
    (target as unknown as {
      routeIncoming: (plugin: ChannelPlugin, accountId: string, message: ChannelMessage) => void;
    }).routeIncoming(plugin, "default", message);
  };

  const getConversationIdByExternal = (
    target: ChannelManager,
    externalConversationId: string,
  ): string | undefined => {
    const bindings = (target as unknown as {
      routeBindings: Map<string, { hubConversationId: string }>;
    }).routeBindings;

    for (const [routeKey, binding] of bindings.entries()) {
      if (routeKey.endsWith(`:${externalConversationId}`)) {
        return binding.hubConversationId;
      }
    }
    return undefined;
  };

  return {
    hub,
    replyText,
    sendText,
    addReaction,
    plugin,
    createManager: (routeBindingsPath: string) => new ChannelManager(hub, { routeBindingsPath }),
    routeIncomingToManager,
    getConversationIdByExternal,
    conversations,
  };
}

describe("channel manager route isolation", () => {
  let testDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    testDir = mkdtempSync(join(tmpdir(), "channel-manager-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(testDir, { recursive: true, force: true });
  });

  it("suppresses pure HEARTBEAT_OK in channel outbound", async () => {
    const routeBindingsPath = join(testDir, "route-bindings.json");
    const { createManager, routeIncomingToManager, getConversationIdByExternal, conversations, replyText, sendText } = createHarness();
    const manager = createManager(routeBindingsPath);

    routeIncomingToManager(manager, {
      messageId: "in-1",
      conversationId: "chat-1",
      senderId: "user-1",
      text: "hi",
      chatType: "direct",
    });

    const hubConversationId = getConversationIdByExternal(manager, "chat-1");
    expect(hubConversationId).toBeDefined();

    const harness = conversations.get(hubConversationId!);
    expect(harness).toBeDefined();

    harness!.emit({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    harness!.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "HEARTBEAT_OK" }] },
    });

    await Promise.resolve();

    expect(replyText).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    manager.stopAll();
  });

  it("keeps forwarding normal assistant replies", async () => {
    const routeBindingsPath = join(testDir, "route-bindings.json");
    const { createManager, routeIncomingToManager, getConversationIdByExternal, conversations, replyText, sendText } = createHarness();
    const manager = createManager(routeBindingsPath);

    routeIncomingToManager(manager, {
      messageId: "in-1",
      conversationId: "chat-1",
      senderId: "user-1",
      text: "hi",
      chatType: "direct",
    });

    const hubConversationId = getConversationIdByExternal(manager, "chat-1");
    expect(hubConversationId).toBeDefined();

    const harness = conversations.get(hubConversationId!);
    expect(harness).toBeDefined();

    harness!.emit({
      type: "message_start",
      message: { role: "assistant", content: [] },
    });
    harness!.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "Reminder: check inbox." }] },
    });

    await Promise.resolve();

    expect(replyText).toHaveBeenCalledTimes(1);
    expect(replyText).toHaveBeenCalledWith(
      {
        channel: "telegram",
        accountId: "default",
        conversationId: "chat-1",
        replyToMessageId: "in-1",
      },
      "Reminder: check inbox.",
    );
    expect(sendText).not.toHaveBeenCalled();

    manager.stopAll();
  });

  it("binds different external conversations to isolated hub conversations", async () => {
    const {
      createManager,
      hub,
      routeIncomingToManager,
      getConversationIdByExternal,
      conversations,
    } = createHarness();
    const manager = createManager(join(testDir, "route-bindings.json"));

    routeIncomingToManager(manager, {
      messageId: "in-a1",
      conversationId: "chat-a",
      senderId: "user-a",
      text: "alpha",
      chatType: "group",
    });

    routeIncomingToManager(manager, {
      messageId: "in-b1",
      conversationId: "chat-b",
      senderId: "user-b",
      text: "beta",
      chatType: "group",
    });

    await vi.advanceTimersByTimeAsync(600);

    const convA = getConversationIdByExternal(manager, "chat-a");
    const convB = getConversationIdByExternal(manager, "chat-b");

    expect(convA).toBeDefined();
    expect(convB).toBeDefined();
    expect(convA).not.toBe(convB);

    const harnessA = conversations.get(convA!);
    const harnessB = conversations.get(convB!);

    expect(harnessA?.write).toHaveBeenCalledTimes(1);
    expect(harnessA?.write.mock.calls[0]?.[0]).toContain("alpha");

    expect(harnessB?.write).toHaveBeenCalledTimes(1);
    expect(harnessB?.write.mock.calls[0]?.[0]).toContain("beta");

    // Same external route should reuse existing hub conversation binding.
    routeIncomingToManager(manager, {
      messageId: "in-a2",
      conversationId: "chat-a",
      senderId: "user-a",
      text: "alpha-2",
      chatType: "group",
    });

    await vi.advanceTimersByTimeAsync(600);

    expect(getConversationIdByExternal(manager, "chat-a")).toBe(convA);
    expect((hub as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation).toHaveBeenCalledTimes(2);
    expect(harnessA?.write).toHaveBeenCalledTimes(2);
    expect(harnessA?.write.mock.calls[1]?.[0]).toContain("alpha-2");

    manager.stopAll();
  });

  it("restores route bindings from disk after manager restart", async () => {
    const routeBindingsPath = join(testDir, "route-bindings.json");
    const {
      hub,
      createManager,
      routeIncomingToManager,
      getConversationIdByExternal,
      conversations,
    } = createHarness();

    const managerA = createManager(routeBindingsPath);
    routeIncomingToManager(managerA, {
      messageId: "in-p1",
      conversationId: "chat-persist",
      senderId: "user-p",
      text: "persist-1",
      chatType: "direct",
    });
    await vi.advanceTimersByTimeAsync(600);

    const firstConversationId = getConversationIdByExternal(managerA, "chat-persist");
    expect(firstConversationId).toBeDefined();
    const harness = conversations.get(firstConversationId!);
    expect(harness?.write).toHaveBeenCalledTimes(1);

    managerA.stopAll();

    const managerB = createManager(routeBindingsPath);
    routeIncomingToManager(managerB, {
      messageId: "in-p2",
      conversationId: "chat-persist",
      senderId: "user-p",
      text: "persist-2",
      chatType: "direct",
    });
    await vi.advanceTimersByTimeAsync(600);

    const restoredConversationId = getConversationIdByExternal(managerB, "chat-persist");
    expect(restoredConversationId).toBe(firstConversationId);
    expect((hub as unknown as { createConversation: ReturnType<typeof vi.fn> }).createConversation).toHaveBeenCalledTimes(1);
    expect(harness?.write).toHaveBeenCalledTimes(2);
    expect(harness?.write.mock.calls[1]?.[0]).toContain("persist-2");

    managerB.stopAll();
  });
});
