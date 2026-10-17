/**
 * The three projects-list cells a row can write in place — status, priority,
 * lead (iteration 253, MYS-2202).
 *
 * Web renders all three as live controls in *both* of its views
 * (`packages/views/projects/components/projects-page.tsx:406-460` in the
 * compact table, `:613-680` on the card). Mobile rendered them as static text,
 * so changing any of the three meant opening the project first.
 *
 * One implementation, two skins: the shapes differ only in glyph size and type
 * scale, both of which web also varies between its views, so the sizes are
 * props rather than a second copy of the cells. The decisions that are worth
 * being wrong about — whether a cell may be tapped at all, and the three states
 * a lead can be in — live in `lib/project-inline-edit.ts` and are unit-tested
 * there.
 *
 * Tap-through: these are nested inside the row's own `Pressable` (the row tap
 * opens the project). React Native gives the innermost responder the touch, the
 * same mechanism the row's "⋯" already relies on (MYS-2197) — so tapping a cell
 * edits it and tapping anywhere else on the row still navigates.
 */
import { Pressable, View } from "react-native";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ProjectPriorityIcon } from "@/components/ui/project-priority-icon";
import {
  projectPriorityLabel,
  projectStatusLabel,
} from "@/lib/project-status";
import { useActorLookup } from "@/data/use-actor-name";
import {
  PROJECT_CELL_TITLE_KEY,
  projectLeadCell,
  type ProjectCellColumn,
} from "@/lib/project-inline-edit";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/react";

/** The in-row write path, handed down by the list that owns it. Omitted by a
 *  host with no write path (the pinned screen's project rows), which renders
 *  the same cells read-only — the contract `ProjectRowMenu`'s `menu` prop has. */
export interface ProjectInlineEdit {
  /** Open the editor sheet for one column of one project. */
  onEdit: (project: Project, column: ProjectCellColumn) => void;
  /** Long-press multi-select is on. Cells give way, exactly as the row's "⋯"
   *  does: in that mode a row carries one control, and picking is what the mode
   *  is for. */
  selectionMode: boolean;
}

/**
 * Wraps a cell's content in its tap target, or returns it bare.
 *
 * `accessibilityLabel` is what makes the cell reachable without sight and is
 * also how a UI dump proves the entry point exists — the column name is passed
 * in so the label reads 「编辑状态」 / 「编辑优先级」 / 「编辑负责人」 rather than
 * three identical "Edit".
 */
function CellPress({
  column,
  edit,
  project,
  className,
  children,
}: {
  column: ProjectCellColumn;
  edit?: ProjectInlineEdit;
  project: Project;
  className?: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const columnLabel = t(PROJECT_CELL_TITLE_KEY[column]);
  const onPress =
    edit && !edit.selectionMode
      ? () => edit.onEdit(project, column)
      : undefined;

  if (!onPress) {
    return <View className={cn("flex-row items-center", className)}>{children}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("a11y.tableEditCell", { column: columnLabel })}
      className={cn("flex-row items-center active:opacity-70", className)}
    >
      {children}
    </Pressable>
  );
}

/** Status cell. The status is intrinsic to the project — no directory read
 *  stands behind it — so there is no not-yet-known state to render. */
export function ProjectStatusCell({
  project,
  edit,
  iconSize = 12,
  textClassName = "text-caption text-muted-foreground",
}: {
  project: Project;
  edit?: ProjectInlineEdit;
  iconSize?: number;
  textClassName?: string;
}) {
  return (
    <CellPress column="status" edit={edit} project={project} className="gap-1.5">
      <ProjectStatusIcon status={project.status} size={iconSize} />
      <Text className={cn("flex-shrink", textClassName)} numberOfLines={1}>
        {projectStatusLabel(project.status)}
      </Text>
    </CellPress>
  );
}

/** Priority cell. `none` is a real value, not a missing one, so it renders the
 *  em dash the table's other empty cells use — and stays tappable, which is the
 *  whole point: a project with no priority is exactly the one a user wants to
 *  give one. */
export function ProjectPriorityCell({
  project,
  edit,
  iconSize = 12,
  textClassName = "text-caption text-muted-foreground",
}: {
  project: Project;
  edit?: ProjectInlineEdit;
  iconSize?: number;
  textClassName?: string;
}) {
  return (
    <CellPress column="priority" edit={edit} project={project} className="gap-1.5">
      {project.priority === "none" ? (
        <Text className="text-caption text-muted-foreground/60">—</Text>
      ) : (
        <>
          <ProjectPriorityIcon priority={project.priority} size={iconSize} />
          <Text className={cn("flex-shrink", textClassName)} numberOfLines={1}>
            {projectPriorityLabel(project.priority)}
          </Text>
        </>
      )}
    </CellPress>
  );
}

/**
 * Lead cell — the one cell whose value comes from elsewhere.
 *
 * The name is resolved through the shared actor lookup, exactly as the detail
 * page's Lead row resolves it, so a project led by an archived agent renders
 * that agent's name rather than a uuid. Three states, and the difference
 * between the last two is the point:
 *
 *   - a name            — resolved, including the settled-but-gone case, which
 *                         falls back to the id's first 8 characters (see
 *                         `projectLeadCell`);
 *   - `noLead`          — the directories settled and this project has none, so
 *                         the absence was measured;
 *   - `pending`         — they have not answered, so the cell says the data is
 *                         not loaded instead of 「无负责人」. Claiming an absence
 *                         from an unanswered read is the defect this repo closed
 *                         for pickers (`lib/catalog-state.ts`) and records
 *                         (MYS-1908); a cell that printed the empty sentence on
 *                         cold start would reintroduce it in the one place a
 *                         user reads as a fact without tapping.
 */
export function ProjectLeadCell({
  project,
  edit,
  avatarSize,
  textClassName = "text-caption text-muted-foreground",
}: {
  project: Project;
  edit?: ProjectInlineEdit;
  /** Renders the avatar at this size. Omit for a text-only cell (the table had
   *  no avatar before this round; the card, like web's, has one). */
  avatarSize?: number;
  textClassName?: string;
}) {
  const { t } = useTranslation();
  const { getName, resolved } = useActorLookup();

  const cell = projectLeadCell({
    leadType: project.lead_type,
    leadId: project.lead_id,
    catalogsResolved: resolved,
    resolveName: getName,
  });

  // Nothing true to say yet: no avatar, no text, and no a11y claim either. An
  // empty cell asserts nothing, which is the only honest rendering for "the
  // directory has not answered".
  if (cell.kind === "pending") return null;

  const empty = cell.kind === "none";
  const name = cell.kind === "name" ? cell.name : t("projects.leadNone");

  return (
    <CellPress column="lead" edit={edit} project={project} className="gap-1.5">
      {avatarSize === undefined ? null : (
        <LeadAvatar project={project} size={avatarSize} empty={empty} />
      )}
      <Text
        className={cn(
          "flex-shrink",
          empty ? "text-caption text-muted-foreground/60" : textClassName,
        )}
        numberOfLines={1}
      >
        {name}
      </Text>
    </CellPress>
  );
}

/**
 * The chip beside a lead's name. A project with no lead gets the dashed ring
 * web's card uses (`projects-page.tsx:652`, `:670`) — the same glyph this app's
 * detail page draws for an empty lead — and a lead whose actor row is gone
 * keeps `ActorAvatar`'s own initials fallback rather than a blank hole.
 */
function LeadAvatar({
  project,
  size,
  empty,
}: {
  project: Project;
  size: number;
  empty: boolean;
}) {
  if (empty || !project.lead_type || !project.lead_id) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: size / 2 }}
        className="border border-dashed border-muted-foreground/40"
      />
    );
  }
  return (
    <ActorAvatar type={project.lead_type} id={project.lead_id} size={size} />
  );
}
