"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { arrayMove } from "@dnd-kit/sortable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Tab {
  id: string;
  path: string;
  title: string;
  iconKey?: string;
  closeable: boolean;
}

interface TabStoreValue {
  tabs: Tab[];
  activeTabId: string;
  openTab: (
    path: string,
    title: string,
    opts?: { replace?: boolean; iconKey?: string }
  ) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  closeTabByPath: (path: string) => void;
  updateTabTitle: (tabId: string, title: string) => void;
  reorderTabs: (oldIndex: number, newIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Route title mapping (for hydration / fallback)
// ---------------------------------------------------------------------------

const ROUTE_TITLES: Record<string, string> = {
  "/inbox": "Inbox",
  "/agents": "Agents",
  "/issues": "All Issues",
  "/knowledge-base": "Knowledge Base",
  "/settings": "Settings",
};

const ROUTE_ICON_KEYS: Record<string, string> = {
  "/inbox": "inbox",
  "/agents": "agents",
  "/issues": "issues",
  "/knowledge-base": "knowledge-base",
  "/settings": "settings",
};

function getTitleForPath(path: string): string {
  if (ROUTE_TITLES[path]) return ROUTE_TITLES[path];
  if (path.startsWith("/issues/")) return path.split("/")[2]?.slice(0, 8) ?? "Issue";
  if (path.startsWith("/agents/")) return "Agent";
  return "Tab";
}

function getIconKeyForPath(path: string): string | undefined {
  if (ROUTE_ICON_KEYS[path]) return ROUTE_ICON_KEYS[path];
  // Sub-paths inherit parent icon
  for (const [route, key] of Object.entries(ROUTE_ICON_KEYS)) {
    if (path.startsWith(route + "/")) return key;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function storageKey(workspaceId: string): string {
  return `multica-tabs-${workspaceId}`;
}

function loadTabs(workspaceId: string): { tabs: Tab[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return null;
    const data = JSON.parse(raw) as { tabs: Tab[]; activeTabId: string };
    if (Array.isArray(data.tabs) && data.tabs.length > 0 && data.activeTabId) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function saveTabs(workspaceId: string, tabs: Tab[], activeTabId: string): void {
  try {
    localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify({ tabs, activeTabId })
    );
  } catch {
    // localStorage full or unavailable
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TabStoreContext = createContext<TabStoreValue | null>(null);

export function useTabStore(): TabStoreValue {
  const ctx = useContext(TabStoreContext);
  if (!ctx) {
    throw new Error("useTabStore must be used within a TabProvider.");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TabProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Suppress URL-sync effect when we are the ones triggering navigation
  const navigatingRef = useRef(false);

  // Initialize tabs: hydrate from localStorage or create default
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = loadTabs(workspaceId);
    if (saved) return saved.tabs;
    return [
      {
        id: crypto.randomUUID(),
        path: pathname,
        title: getTitleForPath(pathname),
        iconKey: getIconKeyForPath(pathname),
        closeable: false,
      },
    ];
  });

  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const saved = loadTabs(workspaceId);
    if (saved) {
      // If saved active tab still exists, use it
      const exists = saved.tabs.find((t) => t.id === saved.activeTabId);
      if (exists) return saved.activeTabId;
    }
    return tabs[0]?.id ?? "";
  });

  // Persist on change
  useEffect(() => {
    saveTabs(workspaceId, tabs, activeTabId);
  }, [workspaceId, tabs, activeTabId]);

  // Sync active tab with initial pathname on mount
  const initialSyncDone = useRef(false);
  useEffect(() => {
    if (initialSyncDone.current) return;
    initialSyncDone.current = true;

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab && activeTab.path === pathname) return;

    // Try to find a tab matching the current URL
    const match = tabs.find((t) => t.path === pathname);
    if (match) {
      setActiveTabId(match.id);
    } else if (activeTab) {
      // Replace the active tab with current URL
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                path: pathname,
                title: getTitleForPath(pathname),
                iconKey: getIconKeyForPath(pathname),
              }
            : t
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL sync: when pathname changes externally (back/forward, direct URL)
  useEffect(() => {
    if (navigatingRef.current) {
      navigatingRef.current = false;
      return;
    }

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.path === pathname) return;

    // Find existing tab with this path
    const match = tabs.find((t) => t.path === pathname);
    if (match) {
      setActiveTabId(match.id);
    } else {
      // Replace current tab
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                path: pathname,
                title: getTitleForPath(pathname),
                iconKey: getIconKeyForPath(pathname),
              }
            : t
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const openTab = useCallback(
    (
      path: string,
      title: string,
      opts?: { replace?: boolean; iconKey?: string }
    ) => {
      const replace = opts?.replace ?? false;
      const iconKey = opts?.iconKey ?? getIconKeyForPath(path);

      if (replace) {
        // Sidebar nav click: find existing tab with same path or replace current
        const existing = tabs.find((t) => t.path === path);
        if (existing) {
          setActiveTabId(existing.id);
          navigatingRef.current = true;
          router.push(path);
          return;
        }
        // Replace current active tab
        setTabs((prev) =>
          prev.map((t) =>
            t.id === activeTabId
              ? { ...t, path, title, iconKey, closeable: false }
              : t
          )
        );
        setActiveTabId(activeTabId); // stays the same
        navigatingRef.current = true;
        router.push(path);
      } else {
        // Open new tab (e.g., clicking an issue)
        const newTab: Tab = {
          id: crypto.randomUUID(),
          path,
          title,
          iconKey,
          closeable: true,
        };
        setTabs((prev) => {
          const idx = prev.findIndex((t) => t.id === activeTabId);
          const next = [...prev];
          next.splice(idx + 1, 0, newTab);
          return next;
        });
        setActiveTabId(newTab.id);
        navigatingRef.current = true;
        router.push(path);
      }
    },
    [tabs, activeTabId, router]
  );

  const activateTab = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      setActiveTabId(tabId);
      navigatingRef.current = true;
      router.push(tab.path);
    },
    [tabs, router]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) return;

      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;

      const next = tabs.filter((t) => t.id !== tabId);
      setTabs(next);

      if (tabId === activeTabId) {
        // Activate neighbor: prefer left, fallback to first
        const newActive = next[Math.max(0, idx - 1)];
        if (newActive) {
          setActiveTabId(newActive.id);
          navigatingRef.current = true;
          router.push(newActive.path);
        }
      }
    },
    [tabs, activeTabId, router]
  );

  const closeTabByPath = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path);
      if (tab) closeTab(tab.id);
    },
    [tabs, closeTab]
  );

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? { ...t, title } : t))
    );
  }, []);

  const reorderTabs = useCallback((oldIndex: number, newIndex: number) => {
    setTabs((prev) => arrayMove(prev, oldIndex, newIndex));
  }, []);

  const value: TabStoreValue = {
    tabs,
    activeTabId,
    openTab,
    activateTab,
    closeTab,
    closeTabByPath,
    updateTabTitle,
    reorderTabs,
  };

  return (
    <TabStoreContext.Provider value={value}>{children}</TabStoreContext.Provider>
  );
}
