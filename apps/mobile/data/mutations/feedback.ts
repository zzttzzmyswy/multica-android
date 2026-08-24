/**
 * Feedback mutations (iteration-100) — thin react-query wrapper over
 * POST /api/feedback, mirroring packages/core/feedback/mutations.ts. The
 * endpoint is write-only: no downstream list to invalidate ("submitted"
 * confirmation is the whole surface, matching web).
 */
import { useMutation } from "@tanstack/react-query";
import type { CreateFeedbackInput } from "@/data/schemas";
import { api } from "@/data/api";

export function useCreateFeedback() {
  return useMutation({
    mutationFn: (input: CreateFeedbackInput) => api.createFeedback(input),
  });
}