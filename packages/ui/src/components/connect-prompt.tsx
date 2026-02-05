"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@multica/ui/components/ui/button";
import { Textarea } from "@multica/ui/components/ui/textarea";
import {
  useConnectionStore,
  parseConnectionCode,
  saveConnection,
} from "@multica/store";
import { useIsMobile } from "@multica/ui/hooks/use-mobile";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Camera01Icon,
  TextIcon,
  CheckmarkCircle02Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { QrScannerView } from "@multica/ui/components/qr-scanner-view";
import { Spinner } from "@multica/ui/components/spinner";

type Mode = "scan" | "paste";
type PasteState = "idle" | "success" | "error";

/** Shown while connecting to Gateway or waiting for Owner approval */
function ConnectionStatus({ fullscreen }: { fullscreen?: boolean }) {
  const gwState = useConnectionStore((s) => s.connectionState);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const isVerifying = gwState === "verifying";

  const wrapper = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-5 px-6"
    : "flex flex-col items-center justify-center h-full gap-5 px-4";

  return (
    <div className={wrapper}>
      <Spinner className="text-muted-foreground text-sm" />
      <div className="text-center space-y-1.5">
        <p className="text-base font-medium">
          {isVerifying ? "Waiting for approval" : "Connecting..."}
        </p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          {isVerifying
            ? "The device owner needs to approve this connection on their computer"
            : "Establishing connection to the agent"}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs text-muted-foreground"
        onClick={disconnect}
      >
        Cancel
      </Button>
    </div>
  );
}

/** Shown when Owner rejects the connection, auto-dismisses after 2s */
function RejectedStatus({ fullscreen, onDismiss }: { fullscreen?: boolean; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const wrapper = fullscreen
    ? "fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-5 px-6"
    : "flex flex-col items-center justify-center h-full gap-5 px-4";

  return (
    <div className={wrapper}>
      <HugeiconsIcon
        icon={Alert02Icon}
        className="size-14 text-destructive animate-in zoom-in duration-300"
      />
      <div className="text-center space-y-1.5">
        <p className="text-base font-medium">Connection rejected</p>
        <p className="text-xs text-muted-foreground max-w-[260px]">
          The device owner declined this connection
        </p>
      </div>
    </div>
  );
}

export function ConnectPrompt() {
  const gwState = useConnectionStore((s) => s.connectionState);
  const lastError = useConnectionStore((s) => s.lastError);
  const [mode, setMode] = useState<Mode>("scan");
  const [codeInput, setCodeInput] = useState("");
  const [pasteState, setPasteState] = useState<PasteState>("idle");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const isMobile = useIsMobile();
  const validatingRef = useRef(false);

  // Detect verify rejection: lastError appears while disconnected
  useEffect(() => {
    if (lastError?.code === "VERIFY_ERROR" && gwState === "disconnected") {
      setShowRejected(true);
    }
  }, [lastError, gwState]);

  const handleDismissRejected = useCallback(() => {
    setShowRejected(false);
    useConnectionStore.setState({ lastError: null });
  }, []);

  const tryConnect = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || validatingRef.current) return;
    validatingRef.current = true;
    try {
      const info = parseConnectionCode(trimmed);
      setPasteState("success");
      navigator.vibrate?.(50);
      // Let the user see the success state before connecting
      setTimeout(() => {
        saveConnection(info);
        useConnectionStore.getState().connect(info);
      }, 600);
    } catch (e) {
      setPasteState("error");
      setPasteError((e as Error).message || "Invalid code");
      navigator.vibrate?.([30, 50, 30]);
      setTimeout(() => {
        setPasteState("idle");
        setPasteError(null);
        setCodeInput("");
      }, 2000);
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

  const isInProgress =
    gwState === "connecting" ||
    gwState === "connected" ||
    gwState === "verifying";

  // Verification rejected — show rejection feedback
  if (showRejected) {
    return <RejectedStatus fullscreen={isMobile} onDismiss={handleDismissRejected} />;
  }

  // Connection in progress — show status (replaces scanner/paste)
  if (isInProgress) {
    return <ConnectionStatus fullscreen={isMobile} />;
  }

  // Mobile: scanner only, no tabs, no paste
  if (isMobile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-4">
        <div className="text-center space-y-1">
          <p className="text-base font-medium">Scan to start</p>
          <p className="text-xs text-muted-foreground">
            Scan a Multica QR code to start chatting
          </p>
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
            ? "Scan a Multica QR code to start chatting"
            : "Paste a Multica connection code to start chatting"}
        </p>
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
          <div className="aspect-square rounded-xl bg-muted flex flex-col items-center justify-center p-4">
            {pasteState === "idle" && (
              <Textarea
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onPaste={handlePaste}
                autoFocus={true}
                placeholder="Paste connection code here..."
                className="text-xs font-mono flex-1 resize-none bg-transparent! border-0 focus-visible:ring-0 shadow-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    tryConnect(codeInput);
                  }
                }}
              />
            )}

            {pasteState === "success" && (
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                className="size-14 text-(--tool-success) animate-in zoom-in duration-300"
              />
            )}

            {pasteState === "error" && (
              <div className="flex flex-col items-center justify-center gap-2">
                <HugeiconsIcon
                  icon={Alert02Icon}
                  className="size-12 text-(--tool-error)"
                />
                {pasteError && (
                  <p className="text-xs text-destructive bg-destructive/10 px-3 py-1.5 rounded-full">
                    {pasteError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
