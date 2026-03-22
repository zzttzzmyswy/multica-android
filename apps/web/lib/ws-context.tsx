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
import { useAuth } from "./auth-context";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080/ws";

type EventHandler = (payload: unknown) => void;

interface WSContextValue {
  subscribe: (event: WSEventType, handler: EventHandler) => () => void;
}

const WSContext = createContext<WSContextValue | null>(null);

export function WSProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const wsRef = useRef<WSClient | null>(null);

  useEffect(() => {
    if (!user) return;

    const ws = new WSClient(WS_URL);
    wsRef.current = ws;
    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [user]);

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

/**
 * Hook that subscribes to a WebSocket event and calls the handler.
 * Automatically unsubscribes on cleanup.
 */
export function useWSEvent(event: WSEventType, handler: EventHandler) {
  const { subscribe } = useWS();

  useEffect(() => {
    const unsub = subscribe(event, handler);
    return unsub;
  }, [event, handler, subscribe]);
}
