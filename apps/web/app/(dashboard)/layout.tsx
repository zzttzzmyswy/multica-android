"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MulticaIcon } from "@multica/ui/components/multica-icon";
import { SidebarProvider } from "@multica/ui/components/ui/sidebar";
import { useAuth } from "../../lib/auth-context";
import { TabProvider } from "../../lib/tab-store";
import { AppSidebar } from "./_components/app-sidebar";
import { TabBar } from "./_components/tab-bar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, workspace, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <MulticaIcon className="size-6" />
      </div>
    );
  }

  if (!user || !workspace) return null;

  return (
    <TabProvider workspaceId={workspace.id}>
      <SidebarProvider>
        <AppSidebar />
        <div className="relative flex w-full flex-1 flex-col overflow-hidden">
          <TabBar />
          <main className="flex-1 overflow-auto rounded-xl bg-background shadow-sm md:mr-2 md:mb-2">
            {children}
          </main>
        </div>
      </SidebarProvider>
    </TabProvider>
  );
}
