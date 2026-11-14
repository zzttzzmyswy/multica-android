/**
 * The inline handoff hint on one status-picker row (MYS-2874) — web's
 * `StepHandoffHint` (`packages/views/issues/components/pickers/status-picker.tsx:218`)
 * as a phone row.
 *
 * ## What it draws, and what it must NOT draw
 *
 * Web draws a `CornerDownRight` glyph plus the handler's avatar and puts the
 * sentence 「交给 X」 in a tooltip. A phone has no hover, so the same information
 * has to be legible without one:
 *
 *   - the glyph and the avatar (same as web), plus
 *   - the handler's NAME — an avatar alone identifies nobody on a small screen
 *     with no tooltip to fall back on, and
 *   - the whole sentence in the ROW's `accessibilityLabel`, because a screen
 *     reader cannot see an icon. A hint announced as a bare glyph is worse than
 *     no hint at all.
 *
 * The decision of WHETHER to draw — and who the actor is — is in
 * `lib/handoff-hint.ts`, which the handoff gate shares through `stepHandsOff`.
 * This file resolves a name from the workspace directories and lays the row
 * out. That split is deliberate: a hint derived here from `handler.type`
 * directly could promise a handoff the gate would not ask about, which is the
 * one failure this feature must not have.
 *
 * ## Why the display is a hook of its own
 *
 * `useHandoffHintDisplay` is called once per row from a component, never inside
 * a `.map()` — the picker body renders a `StatusPickerRow` per option for
 * exactly this reason. It also always calls its hooks before deciding anything:
 * an early `return null` ahead of `useActorLookup()` would change the hook
 * count on the render where a hint appears.
 *
 * The two surfaces that CANNOT hold a row (the board card's status sheet and
 * the swimlane's long-press menu are `ActionSheet`s) go through
 * `useStatusHandoffLabel` instead, which returns a per-status resolver so the
 * caller can append the same sentence to a line of option text.
 */
import { useCallback } from "react";
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useColorScheme } from "nativewind";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { THEME } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n/react";
import { useActorLookup } from "@/data/use-actor-name";
import { isResolvedActorName } from "@/lib/actor-name-state";
import {
  handoffHintActor,
  handoffHintCopy,
  statusHandoffHint,
  type HandoffActor,
  type HandoffHint,
} from "@/lib/handoff-hint";
import type { StatusScope } from "@/lib/workflow-status-scope";

/** What one row's hint resolves to, ready to draw and to announce. */
export interface HandoffHintDisplay {
  /** The actor to draw an avatar for, when the hint names one. */
  actor: HandoffActor | null;
  /** The name or the role noun — the visible text. */
  name: string;
  /** The whole 「交给 X」 sentence, for the row's accessibility label. */
  sentence: string;
}

/**
 * Resolves one hint against the workspace directories and i18n, or null when
 * the row draws no hint.
 *
 * ## Why an unresolved name degrades to the ROLE
 *
 * `getName` folds "the directory has not answered" and "this actor is gone"
 * into the same `"Unknown Agent"` string (`data/use-actor-name.ts`), and
 * `isResolvedActorName` is the shared test for which one it produced. Both land
 * on `null` here, and both fall back to the role noun.
 *
 * That is the right call for THIS surface even though it is the wrong one for a
 * table cell (`lib/actor-name-state.ts` withholds there). The difference is
 * what is being asserted: a cell asserts "this actor is X", so an unread
 * directory must stay silent; the hint asserts "this column hands off", which
 * the WORKFLOW states and the directory has nothing to do with. Only the name
 * is pending, so the row prints the part that is known (「智能体」) and upgrades
 * to the real name when the read lands. Rendering nothing would leave 「交给 」
 * — a sentence with its object missing, which reads as a bug.
 */
export function useHandoffHintDisplay(hint: HandoffHint | null): HandoffHintDisplay | null {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  return resolveHandoffDisplay(hint, getName, t);
}

/**
 * The ONE place a hint becomes display text, shared by the picker row and the
 * two action-sheet surfaces.
 *
 * Factored out rather than written twice because two copies of this are two
 * places to drift, and drift here means the board's sheet and the picker
 * describe the same handoff differently — the exact class of divergence this
 * iteration exists to remove. The pieces it composes (`handoffHintActor`,
 * `handoffHintCopy`) are pure and tested; this only stitches them with the
 * caller's directory and translator.
 */
function resolveHandoffDisplay(
  hint: HandoffHint | null,
  getName: (type: HandoffActor["type"], id: string) => string,
  t: (key: string, params?: Record<string, string | number>) => string,
): HandoffHintDisplay | null {
  if (!hint) return null;
  const actor = handoffHintActor(hint);
  const rawName = actor ? getName(actor.type, actor.id) : "";
  const copy = handoffHintCopy(hint, isResolvedActorName(rawName) ? rawName : null);
  if (!copy) return null;

  // A project lead that resolved to a person is named WITH the role, because
  // 「Grace」 alone would not tell the reader why entering this column involves
  // her. Every other shape names its actor plainly.
  const name =
    copy.kind === "noun"
      ? t(copy.nounKey)
      : copy.kind === "leadNamed"
        ? t("workflow.handler.project_lead_named", { name: copy.name })
        : copy.name;

  return { actor, name, sentence: t("workflow.handsOffTo", { name }) };
}

/**
 * A per-status hint resolver for surfaces that can only show a LINE OF TEXT.
 *
 * The board card's status sheet and the swimlane's long-press menu are
 * `ActionSheet`s — native on iOS, plain buttons on Android. Neither can hold a
 * row with an avatar on the right, so the hint goes where a line of text can:
 * appended to the option's own label (「进行中 · 交给 Ada」). The decision is the
 * same one the picker draws — same `statusHandoffHint`, same gate — so a member
 * moving an issue from the board is told exactly what a member moving it from
 * the picker is told. Upstream does the analogous thing for its drag target
 * (`workflows.board.drop_hint`: 「松开后交给 {{name}}」).
 *
 * Returns a resolver rather than a map so the caller pays only for the options
 * it actually renders, and returns null per status when there is nothing to
 * say — the caller then leaves the label untouched.
 *
 * The scope arrives FLAT (`workflow` + `defaultScope`) rather than as a
 * `{workflow, defaultScope}` object, and that is not cosmetic: callers build
 * that object inline, so an object-shaped parameter would be a fresh reference
 * every render, make this callback's identity churn, and force every
 * `useCallback` that depends on it (both sheets') to churn with it. Flat props
 * let the deps compare by value, which is what they actually are.
 */
export function useStatusHandoffLabel(input: {
  workflow: StatusScope["workflow"];
  defaultScope: StatusScope["defaultScope"];
  projectLead: Pick<Project, "lead_type" | "lead_id"> | null | undefined;
  currentStatus: string | null | undefined;
}): (statusKey: string) => HandoffHintDisplay | null {
  const { t } = useTranslation();
  const { getName } = useActorLookup();
  const { workflow, defaultScope, projectLead, currentStatus } = input;

  return useCallback(
    (statusKey: string): HandoffHintDisplay | null =>
      resolveHandoffDisplay(
        statusHandoffHint({
          // Rebuilt inside the callback, where a fresh object costs nothing —
          // it is created once per call, not once per render of every card.
          scope: { workflow, defaultScope },
          project: projectLead,
          statusKey,
          currentStatus,
        }),
        getName,
        t,
      ),
    [workflow, defaultScope, projectLead, currentStatus, getName, t],
  );
}

/**
 * The hint's visuals. Presentational only — it takes the resolved display, so
 * it holds no hook of its own and cannot re-resolve a name the row already
 * announced.
 *
 * Returning `null` — not an empty `View` — is load-bearing: an empty slot would
 * leave a gap on every non-handoff row and push each row's label out of
 * alignment with the others. Upstream's `if (!handler) return null` makes the
 * same call.
 */
export function HandoffHintRow({ display }: { display: HandoffHintDisplay | null }) {
  const { colorScheme } = useColorScheme();
  if (!display) return null;

  return (
    <View
      className="flex-row shrink-0 items-center gap-1 pl-2"
      // A container, not a claim: the sentence belongs to the ROW's accessible
      // name (the press target). Announcing it twice — once here, once on the
      // row — would make a screen reader read every handoff row twice.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Ionicons
        // Upstream draws Lucide's `CornerDownRight` (`status-picker.tsx:230`);
        // this is Ionicons' counterpart of the same corner-then-right glyph, so
        // the two clients say "this row hands the issue onward" with the same
        // mark.
        name="return-down-forward"
        size={12}
        color={
          colorScheme === "dark" ? THEME.dark.mutedForeground : THEME.light.mutedForeground
        }
      />
      {display.actor ? (
        <ActorAvatar type={display.actor.type} id={display.actor.id} size={14} />
      ) : null}
      <Text
        className="max-w-24 shrink text-caption text-muted-foreground"
        numberOfLines={1}
      >
        {display.name}
      </Text>
    </View>
  );
}
