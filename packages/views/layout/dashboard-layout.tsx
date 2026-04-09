"use client";

import type { ReactNode } from "react";
import { SidebarProvider, SidebarInset } from "@multica/ui/components/ui/sidebar";
import { WorkspaceIdProvider } from "@multica/core/hooks";
import { ModalRegistry } from "../modals/registry";
import { AppSidebar } from "./app-sidebar";
import { useDashboardGuard } from "./use-dashboard-guard";

interface DashboardLayoutProps {
  children: ReactNode;
  /** Sibling of SidebarInset (e.g. SearchCommand) */
  extra?: ReactNode;
  /** Loading indicator */
  loadingIndicator?: ReactNode;
}

export function DashboardLayout({
  children,
  extra,
  loadingIndicator,
}: DashboardLayoutProps) {
  const { user, isLoading, workspace } = useDashboardGuard("/");

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        {loadingIndicator}
      </div>
    );
  }

  if (!user) return null;

  return (
    <SidebarProvider className="h-svh">
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
  );
}
