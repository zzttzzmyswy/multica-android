import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  dispatchActionSheet,
  registerActionSheetHandler,
  type ActionSheetCallback,
  type ActionSheetOptions,
} from "./action-sheet-core";

const OPTIONS: ActionSheetOptions = {
  options: ["Cancel", "Mark all read", "Archive all"],
  cancelButtonIndex: 0,
  destructiveButtonIndex: 2,
};

describe("action-sheet-core dispatch", () => {
  beforeEach(() => {
    // Reset the singleton handler registry between tests.
    registerActionSheetHandler(() => {});
  });

  it("delegates to the native ActionSheetIOS on iOS", () => {
    const nativeShow = vi.fn();
    const cb: ActionSheetCallback = () => {};
    dispatchActionSheet(true, nativeShow, OPTIONS, cb);
    expect(nativeShow).toHaveBeenCalledTimes(1);
    expect(nativeShow).toHaveBeenCalledWith(OPTIONS, cb);
  });

  it("on Android routes to the registered JS handler (no native call)", () => {
    const nativeShow = vi.fn();
    const handler = vi.fn();
    registerActionSheetHandler(handler);
    const cb: ActionSheetCallback = () => {};
    dispatchActionSheet(false, nativeShow, OPTIONS, cb);
    // The fatal iOS-only call must never fire on Android.
    expect(nativeShow).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(OPTIONS, cb);
  });

  it("on Android with no provider mounted drops silently instead of crashing", () => {
    registerActionSheetHandler((() => {}) as never); // clear handler
    // re-register with a null to simulate unmounted provider
    const unsub = registerActionSheetHandler(() => {});
    unsub();
    expect(() =>
      dispatchActionSheet(false, () => {
        throw new Error("ActionSheetManager doesn't exist");
      }, OPTIONS, () => {}),
    ).not.toThrow();
  });
});