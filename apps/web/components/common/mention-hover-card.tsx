"use client";

import type { ReactNode } from "react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { ActorAvatar } from "@/components/common/actor-avatar";
import { useWorkspaceStore } from "@/features/workspace";

interface MentionHoverCardProps {
  type: string;
  id: string;
  children: ReactNode;
}

function MentionHoverCard({ type, id, children }: MentionHoverCardProps) {
  const members = useWorkspaceStore((s) => s.members);
  const agents = useWorkspaceStore((s) => s.agents);

  if (type === "member") {
    const member = members.find((m) => m.user_id === id);
    if (!member) return <>{children}</>;

    return (
      <HoverCard>
        <HoverCardTrigger render={<span />} className="cursor-default">
          {children}
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-auto min-w-48 max-w-72">
          <div className="flex items-center gap-2.5">
            <ActorAvatar actorType="member" actorId={id} size={32} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{member.name}</p>
              <p className="text-xs text-muted-foreground truncate">{member.email}</p>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (type === "agent") {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return <>{children}</>;

    return (
      <HoverCard>
        <HoverCardTrigger render={<span />} className="cursor-default">
          {children}
        </HoverCardTrigger>
        <HoverCardContent align="start" className="w-auto min-w-48 max-w-72">
          <div className="flex items-center gap-2.5">
            <ActorAvatar actorType="agent" actorId={id} size={32} />
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{agent.name}</p>
              {agent.description && (
                <p className="text-xs text-muted-foreground truncate">{agent.description}</p>
              )}
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    );
  }

  return <>{children}</>;
}

export { MentionHoverCard };
