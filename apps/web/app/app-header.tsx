"use client";

import { Button } from "@multica/ui/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header>
        <div className="flex items-center justify-between px-4 py-2 max-w-4xl mx-auto">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Multica" className="size-6 rounded-md" />
            <span className="text-sm tracking-wide font-[family-name:var(--font-brand)]">
              Multica
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
