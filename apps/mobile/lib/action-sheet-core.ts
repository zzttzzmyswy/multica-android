/**
 * Imperative, framework-agnostic core for the cross-platform action sheet.
 *
 * The RN wiring (the `ActionSheetProvider` modal + the drop-in `ActionSheet`
 * object) lives in `./action-sheet.tsx`; this module only owns the dispatch
 * decision and the global handler registry, so the "no-throw on Android"
 * guarantee is unit-testable without an RN renderer.
 *
 * On Android the native `ActionSheetIOS` module does not exist
 * (`ActionSheetManager doesn't exist`), so the Android path routes to a
 * JS-rendered bottom sheet registered by the provider. This core never
 * touches react-native, keeping the test lane clean.
 */

export interface ActionSheetOptions {
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number;
  title?: string;
}

export type ActionSheetCallback = (buttonIndex: number) => void;

/** Signature of react-native's `ActionSheetIOS.showActionSheetWithOptions`. */
export type NativeActionSheetShow = (
  options: ActionSheetOptions,
  callback: ActionSheetCallback,
) => void;

type PendingHandler = (
  options: ActionSheetOptions,
  callback: ActionSheetCallback,
) => void;

let handler: PendingHandler | null = null;

/** The provider registers itself here on mount so `ActionSheet` can call into
 *  the JS modal from anywhere. Returns an unregister fn for cleanup. */
export function registerActionSheetHandler(h: PendingHandler): () => void {
  handler = h;
  return () => {
    if (handler === h) handler = null;
  };
}

/**
 * Route a sheet request. `isIOS` + `nativeShow` are injected so tests can pin
 * a platform without loading react-native: on iOS we delegate to the real
 * native sheet; everywhere else we hand off to the registered JS handler and
 * hard-fall back to a no-op if none is mounted, so a missing provider can
 * never surface as an `ActionSheetManager doesn't exist` crash.
 */
export function dispatchActionSheet(
  isIOS: boolean,
  nativeShow: NativeActionSheetShow,
  options: ActionSheetOptions,
  callback: ActionSheetCallback,
): void {
  if (isIOS) {
    nativeShow(options, callback);
    return;
  }
  if (handler) {
    handler(options, callback);
    return;
  }
  // No provider mounted — drop silently rather than crash on a missing
  // ActionSheetManager (React Native's cross-platform integration-safety net).
}