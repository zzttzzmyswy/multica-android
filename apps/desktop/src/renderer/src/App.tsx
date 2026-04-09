import { RouterProvider } from "react-router-dom";
import { CoreProvider } from "@multica/core/platform";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "sonner";
import { router } from "./router";

export default function App() {
  return (
    <ThemeProvider>
      <CoreProvider
        apiBaseUrl={import.meta.env.VITE_API_URL}
        wsUrl={import.meta.env.VITE_WS_URL}
      >
        <RouterProvider router={router} />
      </CoreProvider>
      <Toaster />
    </ThemeProvider>
  );
}
