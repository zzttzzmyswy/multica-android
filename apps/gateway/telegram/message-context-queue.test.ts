import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageContextQueue } from "./message-context-queue.js";

describe("MessageContextQueue", () => {
  it("keeps the first context active while newer messages stay pending", () => {
    const queue = new MessageContextQueue();
    const deviceId = "device-1";

    queue.enqueue(deviceId, { telegramChatId: 100, telegramMessageId: 1 });
    queue.enqueue(deviceId, { telegramChatId: 100, telegramMessageId: 2 });

    assert.deepEqual(queue.activate(deviceId), {
      telegramChatId: 100,
      telegramMessageId: 1,
    });
    assert.deepEqual(queue.peekForSend(deviceId), {
      telegramChatId: 100,
      telegramMessageId: 1,
    });

    assert.deepEqual(queue.release(deviceId), {
      telegramChatId: 100,
      telegramMessageId: 1,
    });
    assert.deepEqual(queue.peekForSend(deviceId), {
      telegramChatId: 100,
      telegramMessageId: 2,
    });
  });

  it("releases oldest pending context when a run errors before message_start", () => {
    const queue = new MessageContextQueue();
    const deviceId = "device-2";

    queue.enqueue(deviceId, { telegramChatId: 200, telegramMessageId: 11 });
    queue.enqueue(deviceId, { telegramChatId: 200, telegramMessageId: 12 });

    // No activate(): simulate agent_error before streaming starts
    assert.deepEqual(queue.release(deviceId), {
      telegramChatId: 200,
      telegramMessageId: 11,
    });
    assert.deepEqual(queue.peekForSend(deviceId), {
      telegramChatId: 200,
      telegramMessageId: 12,
    });
  });

  it("does not advance queue on repeated activate calls during one run", () => {
    const queue = new MessageContextQueue();
    const deviceId = "device-3";

    queue.enqueue(deviceId, { telegramChatId: 300, telegramMessageId: 21 });
    queue.enqueue(deviceId, { telegramChatId: 300, telegramMessageId: 22 });

    assert.equal(queue.activate(deviceId)?.telegramMessageId, 21);
    assert.equal(queue.activate(deviceId)?.telegramMessageId, 21);

    assert.equal(queue.release(deviceId)?.telegramMessageId, 21);
    assert.equal(queue.peekForSend(deviceId)?.telegramMessageId, 22);
  });

  it("isolates contexts by device", () => {
    const queue = new MessageContextQueue();

    queue.enqueue("a", { telegramChatId: 1, telegramMessageId: 1 });
    queue.enqueue("b", { telegramChatId: 2, telegramMessageId: 2 });

    assert.equal(queue.activate("a")?.telegramMessageId, 1);
    assert.equal(queue.peekForSend("b")?.telegramMessageId, 2);
    assert.equal(queue.release("a")?.telegramMessageId, 1);
    assert.equal(queue.peekForSend("a"), undefined);
    assert.equal(queue.peekForSend("b")?.telegramMessageId, 2);
  });
});
