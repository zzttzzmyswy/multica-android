"use client";

import { useState, useEffect } from "react";
import { Bot } from "lucide-react";
import { cn } from "@multica/ui/lib/utils";

interface ActorAvatarProps {
  name: string;
  initials: string;
  avatarUrl?: string | null;
  isAgent?: boolean;
  isOnline?: boolean;
  size?: number;
  className?: string;
}

function ActorAvatar({
  name,
  initials,
  avatarUrl,
  isAgent,
  isOnline,
  size = 20,
  className,
}: ActorAvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Reset error state when URL changes (e.g. user uploads new avatar)
  useEffect(() => {
    setImgError(false);
  }, [avatarUrl]);

  // Status dot size scales with avatar size
  const dotSize = Math.max(6, Math.round(size * 0.3));

  return (
    <div
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-medium overflow-visible",
        "bg-muted text-muted-foreground",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      title={name}
    >
      <div className="h-full w-full overflow-hidden rounded-[inherit]">
        {avatarUrl && !imgError ? (
          <img
            src={avatarUrl}
            alt={name}
            className="h-full w-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : isAgent ? (
          <div className="flex h-full w-full items-center justify-center">
            <Bot style={{ width: size * 0.55, height: size * 0.55 }} />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {initials}
          </div>
        )}
      </div>
      {isOnline !== undefined && (
        <span
          className={cn(
            "absolute right-0 top-0 z-10 rounded-full ring-2 ring-background",
            isOnline ? "bg-success" : "bg-muted-foreground/40"
          )}
          style={{ width: dotSize, height: dotSize, transform: "translate(25%, -25%)" }}
        />
      )}
    </div>
  );
}

export { ActorAvatar, type ActorAvatarProps };
