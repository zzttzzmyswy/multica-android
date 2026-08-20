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
 *
 * Mirrors web packages/views/skills/components/file-tree.tsx on a phone: same
 * tree shape, no rename/delete row menus (mobile keeps those in skill edit +
 * the base file management), selection highlight preserved.
 */
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { SkillFileTreeNode } from "@/lib/skill-file-tree";
import { buildSkillFileTree } from "@/lib/skill-file-tree";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

const SKILL_MD = "SKILL.md";

/** Recursive leaf count under a directory node. */
function countFiles(node: SkillFileTreeNode): number {
  if (!node.isDirectory) return 1;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

export function SkillFileTree({
  paths,
  selectedPath,
  onSelect,
}: {
  paths: string[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const tree = useMemoTree(paths);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  if (tree.length === 0) return null;

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
    return (
      <Pressable
        key={node.path}
        onPress={() => onSelect(node.path)}
        style={{ paddingLeft: 10 + depth * 14 }}
        className={`flex-row items-center gap-2 py-2.5 pr-2 active:bg-secondary ${
          isSelected ? "bg-secondary" : ""
        }`}
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
    );
  };

  return (
    <View className="rounded-lg border border-border divide-y divide-border">
      {tree.map((node) => renderNode(node, 0))}
    </View>
  );
}

// useMemo keeps the tree stable across re-renders (typing in a sibling sheet
// must not re-sort the rail); paths change only when the skill reloads.
function useMemoTree(paths: string[]) {
  return useMemo(() => buildSkillFileTree(paths), [paths]);
}