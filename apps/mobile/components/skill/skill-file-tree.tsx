/**
 * Skill file tree — the attached-files rail on the skill detail page. Renders
 * the pure tree from lib/skill-file-tree with mobile conventions:
 *
 *   - SKILL.md is pinned to the top and rendered as the highlighted primary
 *     row (badge + bolder type), even though it lives in the skill's `content`
 *     field rather than the files array.
 *   - Directories group their descendants with an expand/collapse chevron and
 *     show their descendant file count.
 *   - Files are plain rows; tapping one opens it (via the parent's callback).
 *   - With `actions`, every attached file also gets a "⋯" that offers Rename
 *     and Delete, mirroring web's row menu
 *     (packages/views/skills/components/file-tree.tsx:240-270). The reserved
 *     main file gets no menu at all rather than a menu with nothing in it —
 *     its one web entry, Edit, is the section header's button here.
 *
 * The tree owns no draft state: rename/delete are reported upward and applied
 * to the page's file-set draft, exactly as web's `FileTreeActions` callbacks
 * are. Renaming opens the page's sheet rather than an inline input — a phone
 * row is too narrow to edit a path in place, and the surrounding paths the
 * inline form exists to compare against do not fit beside it either.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SkillFileTreeNode } from "@/lib/skill-file-tree";
import { buildSkillFileTree } from "@/lib/skill-file-tree";
import { SKILL_MD } from "@/lib/skill-file-paths";
import { Text } from "@/components/ui/text";
import { IconButton } from "@/components/ui/icon-button";
import { ActionSheet } from "@/lib/action-sheet";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

/** Recursive leaf count under a directory node. */
function countFiles(node: SkillFileTreeNode): number {
  if (!node.isDirectory) return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

export interface SkillFileTreeActions {
  /** Open the rename flow for `path` (the page owns the sheet). */
  onRename: (path: string) => void;
  /** Drop `path` from the draft. Undo is the save bar's Discard. */
  onDelete: (path: string) => void;
  /** Row that gets no menu. Defaults to SKILL.md. */
  reservedPath?: string;
}

export function SkillFileTree({
  paths,
  selectedPath,
  onSelect,
  actions,
}: {
  paths: string[];
  selectedPath: string;
  onSelect: (path: string) => void;
  /** Omit to render a read-only tree. */
  actions?: SkillFileTreeActions;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const tree = useMemoTree(paths);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (tree.length === 0) return null;

  const reserved = actions?.reservedPath ?? SKILL_MD;

  const openRowMenu = (path: string) => {
    if (!actions) return;
    const options = [
      t("skills.detail.fileActions.rename"),
      t("skills.detail.fileActions.delete"),
      t("common.cancel"),
    ];
    ActionSheet.showActionSheetWithOptions(
      {
        title: path,
        options,
        cancelButtonIndex: 2,
        destructiveButtonIndex: 1,
      },
      (index) => {
        if (index === 0) actions.onRename(path);
        else if (index === 1) actions.onDelete(path);
      },
    );
  };

  const renderNode = (node: SkillFileTreeNode, depth: number) => {
    if (node.isDirectory) {
      const isCollapsed = !!collapsed[node.path];
      const Icon = isCollapsed ? "folder-outline" : "folder-open-outline";
      return (
        <View key={node.path}>
          <Pressable
            onPress={() =>
              setCollapsed((prev) => ({ ...prev, [node.path]: !prev[node.path] }))
            }
            className="flex-row items-center gap-2 py-2.5 pr-2 active:bg-secondary"
            accessibilityRole="button"
            accessibilityLabel={node.path}
          >
            <Ionicons
              name={isCollapsed ? "chevron-forward" : "chevron-down"}
              size={13}
              color={theme.mutedForeground}
            />
            <Ionicons name={Icon} size={15} color={theme.mutedForeground} />
            <Text
              className="text-sm text-muted-foreground flex-1"
              numberOfLines={1}
            >
              {node.name}
            </Text>
            <Text className="text-xs text-muted-foreground/70">
              {countFiles(node)}
            </Text>
          </Pressable>
          {!isCollapsed && (
            <View>{node.children.map((child) => renderNode(child, depth + 1))}</View>
          )}
        </View>
      );
    }

    const isSelected = node.path === selectedPath;
    const isPrimary = node.path === SKILL_MD;
    const showMenu = !!actions && node.path !== reserved;
    return (
      <View
        key={node.path}
        className={`flex-row items-center ${isSelected ? "bg-secondary" : ""}`}
      >
        <Pressable
          onPress={() => onSelect(node.path)}
          style={{ paddingLeft: 10 + depth * 14 }}
          className="flex-row items-center gap-2 py-2.5 pr-2 flex-1 active:bg-secondary"
          accessibilityRole="button"
          accessibilityLabel={node.path}
        >
          <Ionicons
            name={isPrimary ? "document-text-outline" : "document-outline"}
            size={15}
            color={isPrimary ? theme.foreground : theme.mutedForeground}
          />
          <Text
            className={`text-sm flex-1 ${
              isPrimary
                ? "font-semibold text-foreground"
                : isSelected
                  ? "text-foreground"
                  : "text-muted-foreground"
            }`}
            numberOfLines={1}
          >
            {node.name}
          </Text>
          {isPrimary && (
            <View className="px-1.5 py-px rounded-full bg-primary/10">
              <Text className="text-[10px] text-primary font-medium">Primary</Text>
            </View>
          )}
        </Pressable>
        {showMenu ? (
          <IconButton
            name="ellipsis-horizontal"
            iconSize={16}
            className="h-7 w-7 mr-1"
            color={theme.mutedForeground}
            accessibilityLabel={t("skills.detail.fileActions.label", { path: node.path })}
            onPress={() => openRowMenu(node.path)}
          />
        ) : null}
      </View>
    );
  };

  return (
    <View className="rounded-lg border border-border divide-y divide-border">
      {tree.map((node) => renderNode(node, 0))}
    </View>
  );
}

// useMemo keeps the tree stable across re-renders (typing in a sibling sheet
// must not re-sort the rail); paths change only when the draft or skill changes.
function useMemoTree(paths: string[]) {
  return useMemo(() => buildSkillFileTree(paths), [paths]);
}
