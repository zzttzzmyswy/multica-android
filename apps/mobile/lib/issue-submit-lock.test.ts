import { describe, expect, it, vi } from "vitest";
import { createIssueSubmitLock } from "./issue-submit-lock";
import {
  propertyWriteFailureMessage,
  writeCreatePropertyValues,
} from "./create-property-writes";

describe("create issue submission", () => {
  it("blocks repeat taps and the other mode while properties are saving", async () => {
    const lock = createIssueSubmitLock();
    let finishProperty!: () => void;
    const pendingProperty = new Promise<void>((resolve) => { finishProperty = resolve; });
    const createManual = vi.fn(async () => ({ id: "issue-1" }));
    const createAgent = vi.fn(async () => undefined);
    const api = { setIssueProperty: vi.fn(() => pendingProperty) };
    const finishDraft = vi.fn();
    const changeMode = vi.fn();
    const manual = () => lock.run(async () => {
      const issue = await createManual();
      await writeCreatePropertyValues(api, issue.id, { note: "keep this" });
      finishDraft();
    });

    const original = manual();
    await Promise.resolve();
    expect(api.setIssueProperty).toHaveBeenCalledWith("issue-1", "note", "keep this");
    expect(lock.busy).toBe(true);
    if (!lock.busy) changeMode();
    await expect(manual()).resolves.toBe(false);
    await expect(lock.run(createAgent)).resolves.toBe(false);
    expect(changeMode).not.toHaveBeenCalled();
    expect(finishDraft).not.toHaveBeenCalled();

    finishProperty();
    await expect(original).resolves.toBe(true);
    expect(createManual).toHaveBeenCalledTimes(1);
    expect(api.setIssueProperty).toHaveBeenCalledTimes(1);
    expect(finishDraft).toHaveBeenCalledTimes(1);
    expect(createAgent).not.toHaveBeenCalled();
    expect(lock.busy).toBe(false);
    await expect(lock.run(createAgent)).resolves.toBe(true);
  });

  it.each(["manual", "agent"])("allows retry after a rejected %s create without clearing the draft", async () => {
    const lock = createIssueSubmitLock();
    const finishDraft = vi.fn();
    const create = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const submit = () => lock.run(async () => {
      await create();
      finishDraft();
    });

    await expect(submit()).rejects.toThrow("offline");
    expect(finishDraft).not.toHaveBeenCalled();
    expect(lock.busy).toBe(false);
    await expect(submit()).resolves.toBe(true);
    expect(finishDraft).toHaveBeenCalledTimes(1);
  });

  it("does not turn a property-only rejection into a failed create", async () => {
    const lock = createIssueSubmitLock();
    const api = { setIssueProperty: vi.fn().mockRejectedValue(new Error("offline")) };
    const finishDraft = vi.fn();
    const create = vi.fn(async () => ({ id: "issue-1" }));
    await expect(lock.run(async () => {
      const issue = await create();
      const result = await writeCreatePropertyValues(api, issue.id, { note: "kept" });
      finishDraft(propertyWriteFailureMessage(result, (key, params) => `${key}:${params?.count}`));
    })).resolves.toBe(true);

    expect(create).toHaveBeenCalledTimes(1);
    expect(finishDraft).toHaveBeenCalledWith("newIssue.propertiesFailed:1");
    expect(lock.busy).toBe(false);
  });
});
