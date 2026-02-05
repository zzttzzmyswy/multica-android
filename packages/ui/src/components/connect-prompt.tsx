"use client";

import { useState, useCallback } from "react";
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
import { Camera01Icon } from "@hugeicons/core-free-icons";
import { QrScannerSheet } from "@multica/ui/components/qr-scanner-sheet";

export function ConnectPrompt() {
  const gwState = useConnectionStore((s) => s.connectionState);
  const [codeInput, setCodeInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const isMobile = useIsMobile();

  const handleConnect = useCallback(() => {
    const trimmed = codeInput.trim();
    if (!trimmed) return;
    try {
      const info = parseConnectionCode(trimmed);
      saveConnection(info);
      useConnectionStore.getState().connect(info);
      setCodeInput("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [codeInput]);

  // Promise-based handler for QrScannerView — resolve = success, reject = error
  const handleScanResult = useCallback(async (data: string) => {
    const info = parseConnectionCode(data);
    saveConnection(info);
    useConnectionStore.getState().connect(info);
  }, []);

  const isConnecting = gwState === "connecting" || gwState === "connected";

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground">
          {isMobile
            ? "Scan or paste a connection code"
            : "Paste a connection code to start"}
        </p>
        {isConnecting && (
          <p className="text-xs text-muted-foreground/60 animate-pulse">
            Connecting...
          </p>
        )}
      </div>

      <div className="w-full max-w-sm space-y-3">
        {/* Mobile: scan button + sheet */}
        {isMobile && (
          <>
            <Button
              size="sm"
              onClick={() => setScanOpen(true)}
              className="w-full text-xs gap-2"
            >
              <HugeiconsIcon icon={Camera01Icon} className="size-4" />
              Scan QR Code
            </Button>
            <QrScannerSheet
              open={scanOpen}
              onOpenChange={setScanOpen}
              onResult={handleScanResult}
            />
          </>
        )}

        {/* Paste UI (always shown) */}
        <Textarea
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="Paste connection code here..."
          className="text-xs font-mono min-h-[100px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleConnect();
            }
          }}
        />
        <Button
          size="sm"
          onClick={handleConnect}
          disabled={!codeInput.trim() || gwState === "connecting"}
          className="w-full text-xs"
        >
          Connect
        </Button>

        {/* Mobile: paste fallback hint */}
        {isMobile && (
          <p className="text-xs text-muted-foreground text-center">
            or paste code above instead
          </p>
        )}
      </div>
    </div>
  );
}
