"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import {
  Inbox,
  ListTodo,
  Bot,
  BookOpen,
  ChevronDown,
  Settings,
  LogOut,
  Plus,
} from "lucide-react";
import { MulticaIcon } from "@multica/ui/components/multica-icon";
import { useAuth } from "../../lib/auth-context";
import type { Workspace } from "@multica/types";
import { api } from "../../lib/api";

const navItems = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/issues", label: "Issues", icon: ListTodo },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, workspace, isLoading, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);

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

  if (!user) return null;

  return (
    <div className="flex h-screen bg-canvas">
      {/* Sidebar */}
      <aside className="flex w-56 shrink-0 flex-col">
        {/* Workspace Switcher */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex h-12 w-full items-center gap-2 px-3 hover:bg-sidebar-accent/50 transition-colors"
          >
            <MulticaIcon className="size-4" noSpin />
            <span className="flex-1 truncate text-left text-sm font-semibold">
              {workspace?.name ?? "Multica"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute left-2 top-12 z-50 w-52 rounded-lg border bg-popover p-1 shadow-md">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {user.email}
                </div>
                <div className="my-1 border-t" />
                <Link
                  href="/settings"
                  onClick={() => setShowMenu(false)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </Link>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    logout();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-500 hover:bg-accent"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-2">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User info at bottom */}
        <div className="border-t px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
              {user.name
                .split(" ")
                .map((w) => w[0])
                .join("")
                .toUpperCase()
                .slice(0, 2)}
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {user.name}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 pt-1.5 pr-1.5 pb-1.5">
        <main className="h-full overflow-auto rounded-xl bg-background shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}
