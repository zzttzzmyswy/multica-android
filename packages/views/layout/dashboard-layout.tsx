"use client";

import { useEffect, type ReactNode } from "react";
import { useNavigationStore } from "@multica/core/navigation";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { WorkspaceIdProvider } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceStore } from "@multica/core/workspace";
import { ModalRegistry } from "../modals/registry";
import { useNavigation } from "../navigation";
import { AppSidebar } from "./app-sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Above sidebar area (e.g. desktop TitleBar) */
  header?: ReactNode;
  /** Sibling of SidebarInset (e.g. web SearchCommand) */
  extra?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
  /** Redirect path when not authenticated. Default: "/" */
  loginPath?: string;
}

export function DashboardLayout({
  children,
  header,
  extra,
  loadingIndicator,
  loginPath = "/",
}: DashboardLayoutProps) {
  const { pathname, push } = useNavigation();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const workspace = useWorkspaceStore((s) => s.workspace);

  useEffect(() => {
    if (!isLoading && !user) push(loginPath);
  }, [user, isLoading, push, loginPath]);

  useEffect(() => {
    useNavigationStore.getState().onPathChange(pathname);
  }, [pathname]);

  if (isLoading) {
    return (
      <div className="flex h-screen flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center">
          {loadingIndicator}
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen flex-col">
      {header}
      <div className="flex flex-1 min-h-0">
        <SidebarProvider className="flex-1">
          <AppSidebar />
          <SidebarInset className="overflow-hidden">
            {workspace ? (
              <WorkspaceIdProvider wsId={workspace.id}>
                {children}
                <ModalRegistry />
              </WorkspaceIdProvider>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                {loadingIndicator}
              </div>
            )}
          </SidebarInset>
          {extra}
        </SidebarProvider>
      </div>
    </div>
  );
}
