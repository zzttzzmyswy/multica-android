import { RouterProvider } from "react-router-dom";
import { CoreProvider } from "@multica/core/platform";
import { ThemeProvider } from "@multica/ui/components/common/theme-provider";
import { Toaster } from "sonner";
import { router } from "./router";

export default function App() {
  return (
    <ThemeProvider>
      <CoreProvider
        apiBaseUrl={import.meta.env.VITE_API_URL || "http://localhost:8080"}
        wsUrl={import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws"}
      >
        <RouterProvider router={router} />
      </CoreProvider>
      <Toaster />
    </ThemeProvider>
  );
}
