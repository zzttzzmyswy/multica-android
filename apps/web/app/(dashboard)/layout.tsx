"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  ListTodo,
  Bot,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { MulticaIcon } from "@multica/ui/components/multica-icon";

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

  return (
    <div className="flex h-screen bg-canvas">
      {/* Sidebar — sits on the canvas layer */}
      <aside className="flex w-56 shrink-0 flex-col">
        {/* Workspace Switcher */}
        <div className="flex h-12 items-center gap-2 px-3">
          <MulticaIcon className="size-4" noSpin />
          <span className="flex-1 truncate text-sm font-semibold">
            Multica
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
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
      </aside>

      {/* Main content — floating panel on top of the canvas */}
      <div className="flex-1 pt-1.5 pr-1.5 pb-1.5">
        <main className="h-full overflow-auto rounded-xl bg-background shadow-sm">
          {children}
        </main>
      </div>
    </div>
  );
}
