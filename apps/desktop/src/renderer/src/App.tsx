import { RouterProvider } from "react-router-dom";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "@multica/ui/components/ui/sonner";
import { QueryProvider } from "@multica/core/provider";
import { AuthInitializer } from "./platform/auth-initializer";
import { router } from "./router";

export default function App() {
  return (
    <ThemeProvider>
      <QueryProvider>
        <AuthInitializer>
          <RouterProvider router={router} />
        </AuthInitializer>
        <Toaster />
      </QueryProvider>
    </ThemeProvider>
  );
}
