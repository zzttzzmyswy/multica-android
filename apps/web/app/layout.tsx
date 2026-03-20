import type { Metadata } from "next";
import { ThemeProvider } from "@multica/ui/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multica",
  description: "AI-native task management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
