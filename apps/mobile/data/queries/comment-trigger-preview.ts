/**
 * Comment trigger-preview fetch hook — mobile mirror of web
 * `packages/views/issues/hooks/use-comment-trigger-preview.ts`.
 *
 * Debounces the routing-mention signature (not the raw text), so ordinary
 * typing never spams the preview endpoint; the request itself always carries
 * the LATEST draft content (contentRef). The signature is "empty" (blank or
 * `/note` drafts) → no preview fetch, no chips. Loading/errors surface as
 * "no agents" because the preview is an enhancement.
 *
 * The answer depends on live queue state (pending-task dedup), so cached
 * results revalidate whenever the same signature reappears — `staleTime: 0`,
 * never a pinned stale snapshot (web comment at use-comment-trigger-preview.ts:99).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CommentTriggerOutcome, CommentTriggerPreviewAgent } from "@multica/core/types";
import { api } from "@/data/api";
import { commentTriggerPreviewSignature } from "@/lib/comment-trigger-preview";

const COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS = 300;

export interface UseCommentTriggerPreviewResult {
  agents: CommentTriggerPreviewAgent[];
  // Explicit @agent / @squad mentions that will NOT trigger if posted as-is
  // (MUL-4525 §2), so the composer can warn before sending.
  blocked: CommentTriggerOutcome[];
}

export const commentTriggerPreviewKeys = {
  all: (issueId: string) =>
    ["issues", "comment-trigger-preview", issueId] as const,
  preview: (
    issueId: string,
    parentId: string,
    editingCommentId: string,
    signature: string,
  ) =>
    [...commentTriggerPreviewKeys.all(issueId), parentId, editingCommentId, signature] as const,
};

function queryKeyMatchesPreviewContext(
  queryKey: readonly unknown[] | undefined,
  issueId: string,
  parentId: string,
  editingCommentId: string,
): boolean {
  if (!queryKey) return false;
  const prefix = commentTriggerPreviewKeys.all(issueId);
  return (
    prefix.every((part, index) => queryKey[index] === part) &&
    queryKey[prefix.length] === parentId &&
    queryKey[prefix.length + 1] === editingCommentId
  );
}

function useDebouncedSignature(signature: string): string {
  const [debouncedSignature, setDebouncedSignature] = useState("empty");

  useEffect(() => {
    if (signature === "empty") {
      setDebouncedSignature("empty");
      return;
    }
    const timer = setTimeout(() => {
      setDebouncedSignature(signature);
    }, COMMENT_TRIGGER_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [signature]);

  return debouncedSignature;
}

export function useCommentTriggerPreview({
  issueId,
  parentId,
  editingCommentId,
  content,
}: {
  issueId: string;
  parentId?: string;
  editingCommentId?: string;
  content: string;
}): UseCommentTriggerPreviewResult {
  const signature = useMemo(() => commentTriggerPreviewSignature(content), [content]);
  const debouncedSignature = useDebouncedSignature(signature);
  const contentRef = useRef(content);
  const parentKey = parentId ?? "";
  const editingKey = editingCommentId ?? "";

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const previewQuery = useQuery({
    queryKey: commentTriggerPreviewKeys.preview(
      issueId,
      parentKey,
      editingKey,
      debouncedSignature,
    ),
    queryFn: () =>
      api.previewCommentTriggers(issueId, contentRef.current, {
        parentId: parentId || undefined,
        editingCommentId: editingCommentId || undefined,
      }),
    enabled: signature !== "empty" && debouncedSignature !== "empty",
    retry: false,
    staleTime: 0,
    // Keep the previous agent list only while the same composer context is
    // re-fetching. Crossing issue/parent/edit context must not display stale
    // chips from another composer.
    placeholderData: (previousData, previousQuery) =>
      queryKeyMatchesPreviewContext(
        previousQuery?.queryKey,
        issueId,
        parentKey,
        editingKey,
      )
        ? keepPreviousData(previousData)
        : undefined,
  });

  if (signature === "empty" || debouncedSignature === "empty") {
    return { agents: [], blocked: [] };
  }

  return {
    agents: previewQuery.data?.agents ?? [],
    blocked: previewQuery.data?.blocked ?? [],
  };
}