/**
 * Skill file tree builder — the pure tree shape behind the mobile skill detail
 * page's attached-files rail. 1:1 port of web
 * `packages/views/skills/components/file-tree.tsx` `buildTree`/`sortNodes`,
 * kept framework-free so the grouping/SKILL.md-top rules are unit-testable.
 *
 * Node model: each path segment is a node; a node with children is a
 * directory (rendered with an expand/collapse affordance), a leaf is a file.
 * `SKILL.md` is pinned above everything at the root — it is the skill's
 * primary content (`content` field on the server), rendered as a distinct
 * highlighted row rather than a plain supporting file.
 */
export interface SkillFileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: SkillFileTreeNode[];
}

const SKILL_MD = "SKILL.md";

function sortNodes(nodes: SkillFileTreeNode[]): SkillFileTreeNode[] {
  nodes.sort((a, b) => {
    if (a.path === SKILL_MD) return -1;
    if (b.path === SKILL_MD) return 1;
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const node of nodes) {
    if (node.isDirectory) sortNodes(node.children);
  }
  return nodes;
}

/** Build the sorted tree for a full list of skill file paths. */
export function buildSkillFileTree(filePaths: string[]): SkillFileTreeNode[] {
  const root: SkillFileTreeNode[] = [];

  for (const filePath of filePaths) {
    const parts = filePath.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isLast = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");

      let existing = current.find((n) => n.name === name);
      if (!existing) {
        existing = { name, path, isDirectory: !isLast, children: [] };
        current.push(existing);
      }
      current = existing.children;
    }
  }

  return sortNodes(root);
}