"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { WSClient } from "@multica/sdk";
import type { WSEventType } from "@multica/types";
import { useAuthStore } from "@/features/auth";
import { useWorkspaceStore } from "@/features/workspace";
import { useRealtimeSync } from "./use-realtime-sync";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type EventHandler = (payload: unknown) => void;

interface WSContextValue {
  subscribe: (event: WSEventType, handler: EventHandler) => () => void;
}

const WSContext = createContext<WSContextValue | null>(null);

export function WSProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const wsRef = useRef<WSClient | null>(null);

  useEffect(() => {
    if (!user || !workspace) return;

    const token = localStorage.getItem("multica_token");
    if (!token) return;

    const ws = new WSClient(WS_URL);
    ws.setAuth(token, workspace.id);
    wsRef.current = ws;
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [user, workspace]);

  // Centralized WS → store sync
  useRealtimeSync(wsRef.current);

  const subscribe = useCallback(
    (event: WSEventType, handler: EventHandler) => {
      const ws = wsRef.current;
      if (!ws) return () => {};
      return ws.on(event, handler);
    },
    [],
  );

  return (
    <WSContext.Provider value={{ subscribe }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error("useWS must be used within WSProvider");
  return ctx;
}
