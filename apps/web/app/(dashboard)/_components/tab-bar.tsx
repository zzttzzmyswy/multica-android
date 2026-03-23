"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  X,
  Inbox,
  Bot,
  ListTodo,
  BookOpen,
  Settings,
  FileText,
} from "lucide-react";
import { useTabStore, type Tab } from "../../../lib/tab-store";

// ---------------------------------------------------------------------------
// Icon lookup
// ---------------------------------------------------------------------------

const TAB_ICONS: Record<string, typeof Inbox> = {
  inbox: Inbox,
  agents: Bot,
  issues: ListTodo,
  "knowledge-base": BookOpen,
  settings: Settings,
};

function TabIcon({ iconKey }: { iconKey?: string }) {
  const Icon = iconKey ? TAB_ICONS[iconKey] : undefined;
  if (!Icon) return <FileText className="h-3.5 w-3.5 shrink-0" />;
  return <Icon className="h-3.5 w-3.5 shrink-0" />;
}

// ---------------------------------------------------------------------------
// Context Menu
// ---------------------------------------------------------------------------

function TabContextMenu({
  x,
  y,
  tabId,
  onClose,
}: {
  x: number;
  y: number;
  tabId: string;
  onClose: () => void;
}) {
  const { tabs, closeTab } = useTabStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const canClose = tabs.length > 1;

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  const handleClose = () => {
    if (canClose) closeTab(tabId);
    onClose();
  };

  const handleCloseOthers = () => {
    tabs.forEach((t) => {
      if (t.id !== tabId && tabs.length > 1) closeTab(t.id);
    });
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[140px] rounded-md border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
    >
      <button
        onClick={handleClose}
        disabled={!canClose}
        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        Close
      </button>
      <button
        onClick={handleCloseOthers}
        disabled={tabs.length <= 1}
        className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        Close others
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SortableTab
// ---------------------------------------------------------------------------

function SortableTab({
  tab,
  isActive,
  canClose,
  onContextMenu,
}: {
  tab: Tab;
  isActive: boolean;
  canClose: boolean;
  onContextMenu: (e: React.MouseEvent, tabId: string) => void;
}) {
  const { activateTab, closeTab } = useTabStore();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleClick = () => {
    if (!isDragging) {
      activateTab(tab.id);
    }
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeTab(tab.id);
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      onContextMenu={(e) => onContextMenu(e, tab.id)}
      className={`group flex h-7 max-w-[200px] items-center gap-1.5 rounded-lg px-2.5 text-[13px] transition-all select-none ${
        isDragging ? "opacity-30" : ""
      } ${
        isActive
          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
          : "bg-background/50 text-foreground ring-1 ring-border/30 opacity-60 hover:opacity-85"
      }`}
    >
      <TabIcon iconKey={tab.iconKey} />
      <span className="truncate">{tab.title}</span>
      {canClose && (
        <span
          onClick={handleClose}
          className="ml-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// TabBar
// ---------------------------------------------------------------------------

export function TabBar() {
  const { tabs, activeTabId, reorderTabs, openTab } = useTabStore();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        reorderTabs(oldIndex, newIndex);
      }
    },
    [tabs, reorderTabs]
  );

  const handleNewTab = () => {
    openTab("/issues", "All Issues", { replace: false, iconKey: "issues" });
  };

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 bg-sidebar px-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabs.map((t) => t.id)}
          strategy={horizontalListSortingStrategy}
        >
          {tabs.map((tab) => (
            <SortableTab
              key={tab.id}
              tab={tab}
              isActive={tab.id === activeTabId}
              canClose={tab.closeable && tabs.length > 1}
              onContextMenu={handleContextMenu}
            />
          ))}
        </SortableContext>
      </DndContext>
      <button
        onClick={handleNewTab}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          tabId={contextMenu.tabId}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
