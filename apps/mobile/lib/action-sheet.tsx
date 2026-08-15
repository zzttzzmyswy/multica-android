/**
 * Cross-platform action sheet shim.
 *
 * The app was ported from the iOS client and sprinkled `ActionSheetIOS.
 * showActionSheetWithOptions` throughout (inbox "…", issue/project/profile
 * "…", comment/chat long-press). `ActionSheetIOS` is iOS-only: on Android the
 * native `ActionSheetManager` module doesn't exist, so every call throws
 * `Invariant Violation: ActionSheetManager doesn't exist` and crashes the app.
 *
 * This module mirrors that exact signature so every call site keeps its
 * `(options, callback)` shape — only the import line changes:
 *
 *   - iOS:     delegates to the real `ActionSheetIOS` (native sheet).
 *   - Android: the core (see ./action-sheet-core.ts) routes to `ActionSheet-
 *              Provider`, which renders a React Native `Modal` bottom-sheet
 *              with one button per option (destructive tinted red); the
 *              callback fires with the selected index, and tapping the
 *              backdrop/cancel fires `callback(cancelButtonIndex)`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, Text, View } from "react-native";
import {
  dispatchActionSheet,
  registerActionSheetHandler,
  type ActionSheetOptions,
  type ActionSheetCallback,
} from "@/lib/action-sheet-core";

export type { ActionSheetOptions, ActionSheetCallback };

interface ActionSheetApi {
  showActionSheetWithOptions: (
    options: ActionSheetOptions,
    callback: ActionSheetCallback,
  ) => void;
}

const ActionSheetContext = createContext<ActionSheetApi | null>(null);

/** Drop-in for `ActionSheetIOS` (same shape, works on both platforms). */
export const ActionSheet: ActionSheetApi = {
  showActionSheetWithOptions(options, callback) {
    dispatchActionSheet(
      Platform.OS === "ios",
      (o, cb) => ActionSheetIOS.showActionSheetWithOptions(o, cb),
      options,
      callback,
    );
  },
};

export function ActionSheetProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<
    { options: ActionSheetOptions; callback: ActionSheetCallback } | null
  >(null);

  useEffect(
    () =>
      registerActionSheetHandler((options, callback) =>
        setRequest({ options, callback }),
      ),
    [],
  );

  const dismiss = useCallback(() => setRequest(null), []);

  const onPress = useCallback(
    (index: number) => {
      const current = request;
      dismiss();
      if (current) current.callback(index);
    },
    [request, dismiss],
  );

  const cancelIndex = request?.options.cancelButtonIndex ?? 0;

  return (
    <ActionSheetContext.Provider value={ActionSheet}>
      {children}
      <Modal
        transparent
        visible={request !== null}
        animationType="fade"
        onRequestClose={() => onPress(cancelIndex)}
      >
        <View className="flex-1 justify-end">
          <Pressable
            className="flex-1 bg-black/40"
            onPress={() => onPress(cancelIndex)}
            accessibilityLabel="Dismiss action sheet"
          />
          <View className="bg-background rounded-t-2xl pb-6 px-2 pt-2">
            {request?.options.title ? (
              <Text className="text-center text-sm font-semibold text-muted-foreground pt-3 pb-1">
                {request.options.title}
              </Text>
            ) : null}
            {request?.options.options.map((label, index) => {
              const destructive = index === request?.options.destructiveButtonIndex;
              return (
                <Pressable
                  key={`${index}-${label}`}
                  className="py-4 px-4 border-b border-border"
                  onPress={() => onPress(index)}
                >
                  <Text
                    className={
                      destructive
                        ? "text-center text-base font-medium text-destructive"
                        : "text-center text-base text-foreground"
                    }
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </ActionSheetContext.Provider>
  );
}

/** Optional React binding for components that prefer the hook form. */
export function useActionSheet(): ActionSheetApi {
  const ctx = useContext(ActionSheetContext);
  return ctx ?? ActionSheet;
}