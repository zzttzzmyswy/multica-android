import { Platform } from "react-native";

/**
 * Keyboard behavior for `KeyboardAvoidingView`.
 *
 * On iOS we use `padding` (the standard). On Android we must also give a
 * behavior—`height`—rather than leaving it unset (RN's default defers to the
 * window `softInputMode="adjustResize"`). Since the app runs edge-to-edge
 * (`edgeToEdgeEnabled`, decorFitsSystemWindows=false), Android ignores
 * `adjustResize` and never resizes the window, so an unset behavior leaves
 * bottom-anchored inputs (chat composer, form actions) covered by the IME.
 * Forcing `height` shrinks the view by the keyboard height so content lifts.
 */
export const keyboardBehavior: "padding" | "height" =
  Platform.OS === "ios" ? "padding" : "height";
