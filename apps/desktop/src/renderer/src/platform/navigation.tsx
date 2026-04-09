import { useNavigate, useLocation } from "react-router-dom";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "@multica/views/navigation";
import { useTabStore, resolveRouteIcon } from "@/stores/tab-store";

export function DesktopNavigationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const adapter: NavigationAdapter = {
    push: (path) => navigate(path),
    replace: (path) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    pathname: location.pathname,
    searchParams: new URLSearchParams(location.search),
    openInNewTab: (path, title?) => {
      const icon = resolveRouteIcon(path);
      const store = useTabStore.getState();
      const tabId = store.openTab(path, title ?? path, icon);
      store.setActiveTab(tabId);
      navigate(path);
    },
    getShareableUrl: (path) => `https://www.multica.ai${path}`,
  };

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}
