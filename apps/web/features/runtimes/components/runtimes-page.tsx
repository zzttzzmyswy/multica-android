"use client";

import { useEffect, useCallback } from "react";
import { Server } from "lucide-react";
import { useDefaultLayout } from "react-resizable-panels";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { useWSEvent } from "@/features/realtime";
import { useRuntimeStore } from "../store";
import { RuntimeList } from "./runtime-list";
import { RuntimeDetail } from "./runtime-detail";

export default function RuntimesPage() {
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const runtimes = useRuntimeStore((s) => s.runtimes);
  const selectedId = useRuntimeStore((s) => s.selectedId);
  const fetching = useRuntimeStore((s) => s.fetching);
  const fetchRuntimes = useRuntimeStore((s) => s.fetchRuntimes);
  const setSelectedId = useRuntimeStore((s) => s.setSelectedId);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "multica_runtimes_layout",
  });

  useEffect(() => {
    if (workspace) fetchRuntimes();
  }, [workspace, fetchRuntimes]);

  // Re-fetch on daemon register/deregister events.
  // Heartbeat events are not broadcast over WS, so no handler needed.
  const handleDaemonEvent = useCallback(() => {
    fetchRuntimes();
  }, [fetchRuntimes]);

  useWSEvent("daemon:register", handleDaemonEvent);

  const selected = runtimes.find((r) => r.id === selectedId) ?? null;

  if (isLoading || fetching) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="flex-1 min-h-0"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="list"
        defaultSize={280}
        minSize={240}
        maxSize={400}
        groupResizeBehavior="preserve-pixel-size"
      >
        <RuntimeList
          runtimes={runtimes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel id="detail" minSize="50%">
        {selected ? (
          <RuntimeDetail key={selected.id} runtime={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <Server className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-3 text-sm">Select a runtime to view details</p>
          </div>
        )}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
