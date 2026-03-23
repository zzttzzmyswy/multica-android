"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Inbox,
  ListTodo,
  Bot,
  BookOpen,
  ChevronDown,
  Settings,
  LogOut,
  Plus,
  Check,
} from "lucide-react";
import { MulticaIcon } from "@multica/ui/components/multica-icon";
import { useAuth } from "../../lib/auth-context";

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
  const { user, workspace, workspaces, isLoading, logout, switchWorkspace, createWorkspace } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && user && workspaces.length === 0) {
      setShowCreateDialog(true);
    }
  }, [isLoading, user, workspaces.length]);

  const handleNameChange = (value: string) => {
    setNewName(value);
    setNewSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  };

  const handleCreateWorkspace = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const ws = await createWorkspace({ name: newName.trim(), slug: newSlug.trim() });
      setShowCreateDialog(false);
      setNewName("");
      setNewSlug("");
      await switchWorkspace(ws.id);
    } catch (err) {
      console.error("Failed to create workspace:", err);
    } finally {
      setCreating(false);
    }
  };

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

  if (!workspace) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
          <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MulticaIcon className="size-5" noSpin />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Create your first workspace</h1>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              You need a workspace before you can manage issues, agents, and inbox items.
            </p>

            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setShowCreateDialog(true)}
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Create workspace
              </button>
              <button
                onClick={logout}
                className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        {showCreateDialog && (
          <>
            <div
              className="fixed inset-0 z-50 bg-black/10 backdrop-blur-xs"
              onClick={() => setShowCreateDialog(false)}
            />
            <div className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-6 shadow-lg ring-1 ring-foreground/10">
              <div className="flex flex-col gap-1.5">
                <h2 className="text-lg font-semibold leading-none">Create workspace</h2>
                <p className="text-sm text-muted-foreground">
                  Create a new workspace for your team.
                </p>
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="My Workspace"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Slug</label>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value)}
                    placeholder="my-workspace"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={logout}
                  className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
                >
                  Sign out
                </button>
                <button
                  onClick={handleCreateWorkspace}
                  disabled={creating || !newName.trim() || !newSlug.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </>
        )}
      </>
    );
  }

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
                <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                  Workspaces
                </div>
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setShowMenu(false);
                      if (ws.id !== workspace?.id) {
                        switchWorkspace(ws.id);
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                      {ws.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 truncate text-left">{ws.name}</span>
                    {ws.id === workspace?.id && (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                ))}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowCreateDialog(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create workspace
                </button>
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

      {/* Create Workspace Dialog */}
      {showCreateDialog && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/10 backdrop-blur-xs"
            onClick={() => setShowCreateDialog(false)}
          />
          <div className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-6 shadow-lg ring-1 ring-foreground/10">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-lg font-semibold leading-none">Create workspace</h2>
              <p className="text-sm text-muted-foreground">
                Create a new workspace for your team.
              </p>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My Workspace"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Slug</label>
                <input
                  type="text"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="my-workspace"
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="rounded-md px-3 py-1.5 text-sm hover:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkspace}
                disabled={creating || !newName.trim() || !newSlug.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
