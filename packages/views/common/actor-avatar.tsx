"use client";

import { ActorAvatar as ActorAvatarBase } from "@multica/ui/components/common/actor-avatar";
import { useActorName } from "@multica/core/workspace/hooks";

interface ActorAvatarProps {
  actorType: string;
  actorId: string;
  size?: number;
  className?: string;
  showOnlineStatus?: boolean;
}

export function ActorAvatar({ actorType, actorId, size, className, showOnlineStatus = true }: ActorAvatarProps) {
  const { getActorName, getActorInitials, getActorAvatarUrl, getActorOnlineStatus } = useActorName();
  return (
    <ActorAvatarBase
      name={getActorName(actorType, actorId)}
      initials={getActorInitials(actorType, actorId)}
      avatarUrl={getActorAvatarUrl(actorType, actorId)}
      isAgent={actorType === "agent"}
      isOnline={showOnlineStatus ? getActorOnlineStatus(actorType, actorId) : undefined}
      size={size}
      className={className}
    />
  );
}
