/**
 * Demo-page avatar. Same visual contract as the real ActorAvatar
 * (components/ui/actor-avatar.tsx) — member = initials on muted, agent =
 * initials on brand tint — but driven by hardcoded demo data. The demo page
 * (app/(auth)/demo.tsx) runs pre-auth with no workspace, so it must not
 * touch useActorLookup / workspace stores.
 *
 * Mirrors the web landing's MockAvatar
 * (apps/web/features/landing/components/features-section.tsx).
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

interface Props {
  kind: "member" | "agent";
  initials: string;
  /** Diameter in pt. */
  size?: number;
}

export function MockAvatar({ kind, initials, size = 32 }: Props) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2 }}
      className={cn(
        "items-center justify-center",
        kind === "agent" ? "bg-brand/15" : "bg-muted",
      )}
    >
      <Text
        className={cn(
          "text-xs font-medium",
          kind === "agent" ? "text-brand" : "text-muted-foreground",
        )}
      >
        {initials}
      </Text>
    </View>
  );
}