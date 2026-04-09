import { Outlet } from "react-router-dom";
import { DesktopNavigationProvider } from "@/platform/navigation";
import { DashboardLayout } from "@multica/views/layout";
import { TitleBar } from "./title-bar";
import { MulticaIcon } from "./multica-icon";

export function DashboardShell() {
  return (
    <DesktopNavigationProvider>
      <DashboardLayout
        header={<TitleBar />}
        loginPath="/login"
        loadingIndicator={<MulticaIcon className="size-6" />}
      >
        <Outlet />
      </DashboardLayout>
    </DesktopNavigationProvider>
  );
}
