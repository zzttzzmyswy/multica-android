/**
 * One event in the execution-transcript modal. Mobile counterpart of web's
 * `TranscriptEventRow` (`packages/views/common/task-transcript/`): a type badge,
 * a one-line summary, an expand-to-detail body, and a per-entry copy action.
 *
 * Detail bodies mirror web's presenter:
 *   - a file-mutating `tool_use` renders as a diff (or a whole-file write),
 *   - every other tool call falls back to pretty JSON,
 *   - `tool_result` output is unwrapped from its JSON string layer,
 *   - agent `text` renders as markdown; thinking/error as plain prose.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { TaskMessagePayload } from "@multica/core/types";
import { redactSecrets } from "@multica/core/task-transcript";
import { Text } from "@/components/ui/text";
import { Markdown } from "@/lib/markdown";
import { CodeBlock } from "@/lib/markdown/code-block";
import {
  highlight,
  SHIKI_THEME_DARK,
  SHIKI_THEME_LIGHT,
  type HighlightedLine,
} from "@/lib/markdown/shiki";
import { getToolSummary } from "@/lib/task-log";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  languageForPath,
  transcriptDiffDetail,
  transcriptEntryCopyText,
  transcriptEntryLabel,
  unwrapToolOutput,
  type TranscriptDiffDetail,
  type TranscriptDiffLine,
} from "@/lib/task-transcript";

export function TranscriptEntryRow({ entry }: { entry: TaskMessagePayload }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel a pending "copied" reset so it can't fire on an unmounted row.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const label = transcriptEntryLabel(entry);
  const summary = summarizeEntry(entry);
  const hasDetail = entryHasDetail(entry);
  // Memoized so the diff surface's highlight effect sees a stable `lines`
  // identity across the row's own re-renders (expand/copy state).
  const diffDetail = useMemo(
    () => (entry.type === "tool_use" ? transcriptDiffDetail(entry) : null),
    [entry],
  );

  const onCopy = async () => {
    try {
      // Web masks the copy body too (`agent-transcript-dialog.tsx`); without
      // this the clipboard would carry the raw secret the screen masks.
      await Clipboard.setStringAsync(redactSecrets(transcriptEntryCopyText(entry)));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed (extremely rare) — silent, matching code-block.
    }
  };

  const copyButton = (
    <Pressable
      onPress={onCopy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={copied ? t("runs.transcript.copied") : t("runs.transcript.copy")}
      className="ml-1 shrink-0 flex-row items-center gap-1 px-1 py-0.5 active:opacity-60"
    >
      {copied ? (
        <>
          <Ionicons name="checkmark" size={13} color={theme.success} />
          <Text className="text-[10px] text-success">{t("runs.transcript.copied")}</Text>
        </>
      ) : (
        <Ionicons name="copy-outline" size={13} color={theme.mutedForeground} />
      )}
    </Pressable>
  );

  const header = (
    <View className="flex-1 min-w-0 flex-row items-start gap-1.5">
      {hasDetail ? (
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={12}
          color={theme.mutedForeground}
          style={{ marginTop: 3 }}
        />
      ) : (
        <View style={{ width: 12 }} />
      )}
      <View className={cn("shrink-0 rounded px-1.5 py-0.5 self-start", badgeClass(entry.type))}>
        <Text className={cn("text-[10px] font-medium", badgeTextClass(entry.type))}>
          {label}
        </Text>
      </View>
      <Text
        className={cn(
          "flex-1 text-xs",
          entry.type === "error" ? "text-destructive" : "text-muted-foreground",
          (entry.type === "thinking" || entry.type === "text") && "italic",
        )}
        numberOfLines={expanded ? undefined : 2}
      >
        {summary || "—"}
      </Text>
    </View>
  );

  return (
    <View className="border-b border-border/60">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <View className="flex-row items-start px-3 py-2">
          {hasDetail ? (
            <CollapsibleTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${label} ${summary}`}
                className="flex-1 min-w-0 active:opacity-70"
              >
                {header}
              </Pressable>
            </CollapsibleTrigger>
          ) : (
            header
          )}
          {copyButton}
        </View>

        {hasDetail ? (
          <CollapsibleContent>
            <View className="px-3 pb-3 pl-7">
              <DetailBody entry={entry} diffDetail={diffDetail} />
            </View>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </View>
  );
}

// ─── Detail bodies ──────────────────────────────────────────────────────────

function DetailBody({
  entry,
  diffDetail,
}: {
  entry: TaskMessagePayload;
  diffDetail: TranscriptDiffDetail | null;
}) {
  if (entry.type === "tool_use") {
    if (diffDetail?.kind === "diff") {
      return <TranscriptDiffBlock path={diffDetail.path} lines={diffDetail.lines} />;
    }
    if (diffDetail?.kind === "file") {
      return (
        <View className="rounded bg-muted/40 px-2 py-1.5">
          <Text className="mb-1 text-[10px] font-mono text-muted-foreground" numberOfLines={1}>
            {diffDetail.path}
          </Text>
          <CodeBlock
            code={redactSecrets(diffDetail.text)}
            lang={languageForPath(diffDetail.path)}
            selectable={false}
          />
        </View>
      );
    }
    return <PlainBlock text={redactSecrets(JSON.stringify(entry.input, null, 2))} />;
  }
  if (entry.type === "tool_result") {
    return <PlainBlock text={unwrapToolOutput(entry.output ?? "")} />;
  }
  if (entry.type === "text") {
    return <Markdown content={entry.content ?? ""} />;
  }
  return (
    <PlainBlock text={entry.content ?? ""} destructive={entry.type === "error"} />
  );
}

function PlainBlock({ text, destructive }: { text: string; destructive?: boolean }) {
  return (
    <View className="rounded bg-muted/40 px-2 py-1.5">
      <Text
        className={cn(
          "text-[11px] font-mono",
          destructive ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {text}
      </Text>
    </View>
  );
}

// ─── Diff surface ───────────────────────────────────────────────────────────

type DiffSide = Exclude<TranscriptDiffLine["kind"], "gap">;

/**
 * Diff rows with the same reading rules as web's `DiffDetailSurface`: a +/-
 * gutter, a tinted row for changes, and — when the path names a language we
 * carry a grammar for — the code syntax-highlighted per side (each side is
 * highlighted as one block, then split back per line, so multi-line strings and
 * comments keep their grammar). With no grammar the rows fall back to plain
 * colored monospace, never blank.
 */
function TranscriptDiffBlock({ path, lines }: { path: string; lines: TranscriptDiffLine[] }) {
  const { isDarkColorScheme } = useColorScheme();
  const theme = isDarkColorScheme ? SHIKI_THEME_DARK : SHIKI_THEME_LIGHT;
  const language = languageForPath(path);
  const [sides, setSides] = useState<Record<DiffSide, HighlightedLine[] | null> | null>(null);

  // Masked before the highlight pass rather than at render: the highlighted
  // rows are rebuilt from the same strings, so masking the source keeps both
  // the plain and the tokenised path clean (web masks only its plain branch).
  const safeLines = useMemo(
    () =>
      lines.map((line) =>
        line.kind === "gap" ? line : { ...line, text: redactSecrets(line.text) },
      ),
    [lines],
  );

  useEffect(() => {
    if (!language) {
      setSides(null);
      return;
    }
    let cancelled = false;
    const kinds: DiffSide[] = ["add", "remove", "context"];
    void Promise.all(
      kinds.map(async (kind): Promise<readonly [DiffSide, HighlightedLine[] | null]> => {
        const text = safeLines
          .filter((line) => line.kind === kind)
          .map((line) => line.text)
          .join("\n");
        if (!text) return [kind, null];
        return [kind, await highlight(text, language, theme)];
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: Record<DiffSide, HighlightedLine[] | null> = {
        add: null,
        remove: null,
        context: null,
      };
      for (const [kind, value] of results) next[kind] = value;
      setSides(next);
    });
    return () => {
      cancelled = true;
    };
  }, [safeLines, language, theme]);

  const cursors: Record<DiffSide, number> = { add: 0, remove: 0, context: 0 };

  return (
    <View className="rounded bg-muted/40 px-2 py-1.5">
      <Text className="mb-1 text-[10px] font-mono text-muted-foreground" numberOfLines={1}>
        {path}
      </Text>
      {safeLines.map((line, index) => {
        if (line.kind === "gap") {
          return (
            <Text key={index} className="text-[11px] font-mono text-muted-foreground">
              {"  ⋯"}
            </Text>
          );
        }
        const kind = line.kind;
        const tokens = sides?.[kind]?.[cursors[kind]];
        cursors[kind] += 1;
        return (
          <View
            key={index}
            className={cn(
              "flex-row",
              kind === "add" && "bg-success/10",
              kind === "remove" && "bg-destructive/10",
            )}
          >
            <Text
              className={cn(
                "text-[11px] font-mono",
                kind === "add" && "text-success",
                kind === "remove" && "text-destructive",
                kind === "context" && "text-muted-foreground",
              )}
            >
              {kind === "add" ? "+" : kind === "remove" ? "-" : " "}
            </Text>
            {tokens ? (
              <Text
                className={cn(
                  "flex-1 pl-1 text-[11px] font-mono",
                  kind === "context" && "text-muted-foreground",
                )}
              >
                {tokens.tokens.map((token, tokenIndex) => (
                  <Text key={tokenIndex} style={token.color ? { color: token.color } : undefined}>
                    {token.content}
                  </Text>
                ))}
              </Text>
            ) : (
              <Text
                className={cn(
                  "flex-1 pl-1 text-[11px] font-mono",
                  kind === "add" && "text-success",
                  kind === "remove" && "text-destructive",
                  kind === "context" && "text-muted-foreground",
                )}
              >
                {line.text || " "}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const BADGE_CLASS: Record<string, string> = {
  text: "bg-brand/10",
  thinking: "bg-muted",
  tool_use: "bg-info/10",
  tool_result: "bg-secondary",
  error: "bg-destructive/10",
};

const BADGE_TEXT_CLASS: Record<string, string> = {
  text: "text-brand",
  thinking: "text-muted-foreground",
  tool_use: "text-info",
  tool_result: "text-muted-foreground",
  error: "text-destructive",
};

function badgeClass(type: TaskMessagePayload["type"]): string {
  return BADGE_CLASS[type] ?? "bg-muted";
}

function badgeTextClass(type: TaskMessagePayload["type"]): string {
  return BADGE_TEXT_CLASS[type] ?? "text-muted-foreground";
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function firstLine(value: string | undefined): string {
  return value?.split("\n").find((line) => line.trim().length > 0) ?? "";
}

/** Collapse whitespace runs so a pretty-printed result previews as one line. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeEntry(entry: TaskMessagePayload): string {
  switch (entry.type) {
    case "tool_use":
      return getToolSummary(entry);
    case "tool_result":
      return clip(collapseWhitespace(unwrapToolOutput(entry.output ?? "")), 200);
    default:
      return clip(firstLine(entry.content ?? entry.output), 200);
  }
}

function entryHasDetail(entry: TaskMessagePayload): boolean {
  switch (entry.type) {
    case "tool_use":
      return !!entry.input && Object.keys(entry.input).length > 0;
    case "tool_result":
      return !!entry.output && entry.output.length > 0;
    default:
      return !!entry.content && entry.content.length > 0;
  }
}
