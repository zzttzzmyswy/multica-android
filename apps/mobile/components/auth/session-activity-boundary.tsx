/**
 * Notices that someone is actually using the app, so the sliding session can
 * follow use rather than a clock (MYS-2538).
 *
 * Launch and foreground transitions alone are not enough: an app opened once
 * and then used continuously in the foreground for longer than the renewal
 * cadence would never check again, and could expire under the user's hands.
 * Every touch that starts anywhere in the tree passes through here first.
 *
 * The responder config declines the gesture it observes — see
 * `sessionActivityResponderConfig` — so taps, scrolls and swipes behave exactly
 * as they would without this wrapper. `maybeRenewSession` is a timestamp
 * comparison on all but one call per interval, so it is cheap enough to sit on
 * that path.
 *
 * There is deliberately no timer: a phone in a pocket with the app foregrounded
 * must not keep renewing a session nobody is using.
 */
import type { ReactNode } from "react";
import { useMemo } from "react";
import { PanResponder, View } from "react-native";
import { sessionActivityResponderConfig } from "@/lib/session-activity";

export function SessionActivityBoundary({ children }: { children: ReactNode }) {
  const responder = useMemo(
    () => PanResponder.create(sessionActivityResponderConfig),
    [],
  );

  return (
    <View style={{ flex: 1 }} {...responder.panHandlers}>
      {children}
    </View>
  );
}
