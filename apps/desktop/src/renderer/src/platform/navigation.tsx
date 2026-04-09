import { useNavigate, useLocation } from "react-router-dom";
import {
  NavigationProvider,
  type NavigationAdapter,
} from "@multica/views/navigation";

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
  };

  return <NavigationProvider value={adapter}>{children}</NavigationProvider>;
}
