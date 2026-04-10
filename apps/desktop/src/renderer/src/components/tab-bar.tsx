import {
  Inbox,
  CircleUser,
  ListTodo,
  Bot,
  Monitor,
  BookOpenText,
  Settings,
  X,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@multica/ui/lib/utils";
import { useTabStore, resolveRouteIcon, type Tab } from "@/stores/tab-store";

const TAB_ICONS: Record<string, LucideIcon> = {
  Inbox,
  CircleUser,
  ListTodo,
  Bot,
  Monitor,
  BookOpenText,
  Settings,
};

function TabItem({ tab, isActive, isOnly }: { tab: Tab; isActive: boolean; isOnly: boolean }) {
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const closeTab = useTabStore((s) => s.closeTab);

  const Icon = TAB_ICONS[tab.icon];

  const handleClick = () => {
    if (isActive) return;
    setActiveTab(tab.id);
    // No navigate() — Activity handles visibility
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tab.id);
    // No navigate() — store handles activeTabId switch
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "group flex h-7 w-40 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
        "select-none cursor-default",
        isActive
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "bg-sidebar-accent/50 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span
        className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left"
        style={{
          maskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
          WebkitMaskImage: "linear-gradient(to right, black calc(100% - 12px), transparent)",
        }}
      >
        {tab.title}
      </span>
      {!isOnly && (
        <span
          onClick={handleClose}
          className="hidden size-3.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors group-hover:flex hover:bg-muted-foreground/20 hover:text-foreground"
        >
          <X className="size-2.5" />
        </span>
      )}
    </button>
  );
}

function NewTabButton() {
  const addTab = useTabStore((s) => s.addTab);
  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const handleClick = () => {
    const path = "/issues";
    const tabId = addTab(path, "Issues", resolveRouteIcon(path));
    setActiveTab(tabId);
    // No navigate() — new tab's router starts at /issues automatically
  };

  return (
    <button
      onClick={handleClick}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-muted-foreground"
    >
      <Plus className="size-3.5" />
    </button>
  );
}

export function TabBar() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  return (
    <div
      className="flex h-full items-center gap-0.5 px-2 justify-start"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {tabs.map((tab) => (
        <TabItem key={tab.id} tab={tab} isActive={tab.id === activeTabId} isOnly={tabs.length === 1} />
      ))}
      <NewTabButton />
    </div>
  );
}
