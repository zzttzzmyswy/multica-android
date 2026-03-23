"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@multica/ui/components/ui/sidebar";
import { useAuth } from "../../../lib/auth-context";
import { useTabStore } from "../../../lib/tab-store";

const navItems = [
  { href: "/inbox", label: "Inbox", icon: Inbox, iconKey: "inbox" },
  { href: "/agents", label: "Agents", icon: Bot, iconKey: "agents" },
  { href: "/issues", label: "Issues", icon: ListTodo, iconKey: "issues" },
  {
    href: "/knowledge-base",
    label: "Knowledge Base",
    icon: BookOpen,
    iconKey: "knowledge-base",
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const {
    user,
    workspace,
    workspaces,
    logout,
    switchWorkspace,
    createWorkspace,
  } = useAuth();
  const { openTab } = useTabStore();

  const [showMenu, setShowMenu] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [creating, setCreating] = useState(false);

  const handleNameChange = (value: string) => {
    setNewName(value);
    setNewSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    );
  };

  const handleCreateWorkspace = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    try {
      const ws = await createWorkspace({
        name: newName.trim(),
        slug: newSlug.trim(),
      });
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

  return (
    <>
      <Sidebar variant="inset">
        {/* Workspace Switcher */}
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={() => setShowMenu(!showMenu)}>
                <MulticaIcon className="size-4" noSpin />
                <span className="flex-1 truncate font-semibold">
                  {workspace?.name ?? "Multica"}
                </span>
                <ChevronDown className="size-4" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowMenu(false)}
              />
              <div className="absolute left-2 top-14 z-50 w-52 rounded-lg border bg-popover p-1 shadow-md">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {user?.email}
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
                    <span className="flex-1 truncate text-left">
                      {ws.name}
                    </span>
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
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<Link href={item.href} />}
                        onClick={() =>
                          openTab(item.href, item.label, {
                            replace: true,
                            iconKey: item.iconKey,
                          })
                        }
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* User */}
        <SidebarFooter>
          {user && (
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="sm">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-medium">
                    {user.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <span className="truncate">{user.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      </Sidebar>

      {/* Create Workspace Dialog */}
      {showCreateDialog && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/10 backdrop-blur-xs"
            onClick={() => setShowCreateDialog(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-6 shadow-lg ring-1 ring-foreground/10">
            <div className="flex flex-col gap-1.5">
              <h2 className="text-lg font-semibold leading-none">
                Create workspace
              </h2>
              <p className="text-sm text-muted-foreground">
                Create a new workspace for your team.
              </p>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
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
                <label className="text-xs font-medium text-muted-foreground">
                  Slug
                </label>
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
    </>
  );
}
