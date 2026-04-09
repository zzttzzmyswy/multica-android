import { WSProvider } from "@multica/core/realtime";
import { useAuthStore } from "./auth";
import { useWorkspaceStore } from "./workspace";
import { desktopStorage } from "./storage";
import { toast } from "sonner";

const WS_URL = "ws://localhost:8080/ws";

export function DesktopWSProvider({ children }: { children: React.ReactNode }) {
  return (
    <WSProvider
      wsUrl={WS_URL}
      authStore={useAuthStore}
      workspaceStore={useWorkspaceStore}
      storage={desktopStorage}
      onToast={(message, type) => {
        if (type === "error") toast.error(message);
        else toast.info(message);
      }}
    >
      {children}
    </WSProvider>
  );
}
