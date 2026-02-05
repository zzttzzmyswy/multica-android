"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { toast } from "@multica/ui/components/ui/sonner";
import {
  useConnectionStore,
  parseConnectionCode,
  saveConnection,
} from "@multica/store";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { HugeiconsIcon } from "@hugeicons/react";
import { Camera01Icon, TextIcon } from "@hugeicons/core-free-icons";
import { QrScannerView } from "@multica/ui/components/qr-scanner-view";

type Mode = "scan" | "paste";

export function ConnectPrompt() {
  const gwState = useConnectionStore((s) => s.connectionState);
  const [mode, setMode] = useState<Mode>("scan");
  const [codeInput, setCodeInput] = useState("");
  const isMobile = useIsMobile();
  const validatingRef = useRef(false);

  const tryConnect = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || validatingRef.current) return;
    validatingRef.current = true;
    try {
      const info = parseConnectionCode(trimmed);
      saveConnection(info);
      useConnectionStore.getState().connect(info);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      validatingRef.current = false;
    }
  }, []);

  // Auto-validate on paste
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const text = e.clipboardData.getData("text");
      if (!text.trim()) return;
      // Let the textarea update visually first, then validate
      setTimeout(() => tryConnect(text), 50);
    },
    [tryConnect],
  );

  // Promise-based handler for QrScannerView
  const handleScanResult = useCallback(async (data: string) => {
    const info = parseConnectionCode(data);
    saveConnection(info);
    useConnectionStore.getState().connect(info);
  }, []);

  const isConnecting = gwState === "connecting" || gwState === "connected";

  // Mobile: scanner only, no tabs, no paste
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
        <div className="text-center space-y-1">
          <p className="text-base font-medium">Scan to start</p>
          <p className="text-xs text-muted-foreground">
            Scan a QR code to use an Agent
          </p>
          {isConnecting && (
            <p className="text-xs text-muted-foreground/60 animate-pulse">
              Connecting to Agent...
            </p>
          )}
        </div>
        <QrScannerView onResult={handleScanResult} fullscreen />
      </div>
    );
  }

  // Desktop: tab toggle (scan / paste), same-size panels
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
      <div className="text-center space-y-1">
        <p className="text-base font-medium">
          {mode === "scan" ? "Scan to start" : "Paste to start"}
        </p>
        <p className="text-xs text-muted-foreground">
          {mode === "scan"
            ? "Scan a QR code to use an Agent"
            : "Paste a connection code to use an Agent"}
        </p>
        {isConnecting && (
          <p className="text-xs text-muted-foreground/60 animate-pulse">
            Connecting to Agent...
          </p>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-muted rounded-lg p-1">
        <Button
          variant={mode === "scan" ? "default" : "ghost"}
          size="sm"
          className="text-xs gap-1.5 h-7 px-3"
          onClick={() => setMode("scan")}
        >
          <HugeiconsIcon icon={Camera01Icon} className="size-3.5" />
          Scan
        </Button>
        <Button
          variant={mode === "paste" ? "default" : "ghost"}
          size="sm"
          className="text-xs gap-1.5 h-7 px-3"
          onClick={() => setMode("paste")}
        >
          <HugeiconsIcon icon={TextIcon} className="size-3.5" />
          Paste
        </Button>
      </div>

      {/* Content — same max-width for both modes */}
      <div className="w-full max-w-[320px]">
        {mode === "scan" ? (
          <QrScannerView onResult={handleScanResult} />
        ) : (
          <div className="aspect-square rounded-xl bg-muted flex flex-col items-center justify-center p-6">
            <Textarea
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              onPaste={handlePaste}
              placeholder="Paste connection code here..."
              className="text-xs font-mono flex-1 resize-none bg-transparent border-0 focus-visible:ring-0 shadow-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  tryConnect(codeInput);
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
