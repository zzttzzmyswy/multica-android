import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useNavigationStore } from "@multica/core/navigation";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { WorkspaceIdProvider } from "@multica/core/hooks";
import { ModalRegistry } from "@multica/views/modals/registry";
import { useAuthStore } from "@/platform/auth";
import { useWorkspaceStore } from "@/platform/workspace";
import { DesktopNavigationProvider } from "@/platform/navigation";
import { AuthInitializer } from "@/platform/auth-initializer";
import { DesktopWSProvider } from "@/platform/ws-provider";
import { TitleBar } from "./title-bar";
import { AppSidebar } from "./app-sidebar";
import { MulticaIcon } from "./multica-icon";

export function DashboardShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login", { replace: true });
    }
  }, [user, isLoading, navigate]);

  useEffect(() => {
    useNavigationStore.getState().onPathChange(location.pathname);
  }, [location.pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col">
        <TitleBar />
        <div className="flex flex-1 items-center justify-center">
          <MulticaIcon className="size-6" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <DesktopNavigationProvider>
      <AuthInitializer>
        <DesktopWSProvider>
          <div className="flex h-screen flex-col">
            <TitleBar />
            <div className="flex flex-1 min-h-0">
              <SidebarProvider className="flex-1">
                <AppSidebar />
                <SidebarInset className="overflow-hidden">
                  {workspace ? (
                    <WorkspaceIdProvider wsId={workspace.id}>
                      <Outlet />
                      <ModalRegistry />
                    </WorkspaceIdProvider>
                  ) : (
                    <div className="flex flex-1 items-center justify-center">
                      <MulticaIcon className="size-6 animate-pulse" />
                    </div>
                  )}
                </SidebarInset>
              </SidebarProvider>
            </div>
          </div>
        </DesktopWSProvider>
      </AuthInitializer>
    </DesktopNavigationProvider>
  );
}
