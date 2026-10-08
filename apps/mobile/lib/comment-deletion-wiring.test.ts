/**
 * Iteration 210 — wiring ratchet for comment-deletion semantics.
 *
 * The mobile vitest lane is Node-only: no RN renderer, so a green
 * `applyCommentDeletion` proves nothing about whether any surface consults it.
 * That is exactly where this class of defect hides — the helper can be perfect
 * while `useDeleteComment` still strips replies the deployment kept.
 *
 * Each assertion corresponds to one surface that has to agree with the
 * deployment's `comment_delete_keep_replies_supported` declaration. Dropping
 * any one of them puts that surface back to promising the pre-#8296 semantics.
 *
 * Comments are stripped before matching so a comment that merely describes a
 * branch cannot satisfy an assertion.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Source with comments removed — an assertion must match real code. */
function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the delete request follows the deployment's declared semantics", () => {
  const api = code("data/api.ts");

  it("routes through /keep-replies when the caller asks for it", () => {
    expect(api).toContain("keep-replies");
    // The route must be conditional, not unconditional: an older server does
    // not mount the path, so sending it always would break plain deletes.
    expect(api).toMatch(/keepReplies\s*\?[^:]*keep-replies/);
  });
});

describe("useDeleteComment mirrors the server's outcome instead of guessing", () => {
  const mutations = code("data/mutations/issues.ts");

  it("reads the capability from the shared config cache", () => {
    expect(mutations).toContain("commentDeleteKeepsReplies");
    expect(mutations).toContain("serverConfigOptions");
  });

  it("no longer strips replies optimistically before the server answers", () => {
    // The old optimistic patch filtered `parent_id === commentId` out of the
    // cache. With keep-replies deployments that deleted rows the server kept.
    const start = mutations.indexOf("export function useDeleteComment");
    expect(start).toBeGreaterThan(-1);
    const end = mutations.indexOf("export function useResolveComment", start);
    const body = mutations.slice(start, end);
    expect(body).not.toContain("onMutate");
    expect(body).not.toMatch(/entry\.parent_id\s*===\s*commentId/);
  });

  it("applies the keep-replies patch and the cascade patch on the matching branch", () => {
    const start = mutations.indexOf("export function useDeleteComment");
    const end = mutations.indexOf("export function useResolveComment", start);
    const body = mutations.slice(start, end);
    expect(body).toContain("applyCommentDeletion");
    expect(body).toContain("removeCommentSubtree");
  });
});

describe("the confirmation copy does not promise an outcome the server can refuse", () => {
  const menu = code("components/issue/comment-context-menu.tsx");

  it("branches the body on the capability", () => {
    expect(menu).toContain("commentDeleteKeepsReplies");
    const call = menu.indexOf("Alert.alert(");
    expect(call).toBeGreaterThan(-1);
    const dialog = menu.slice(call, call + 700);
    expect(dialog).toContain("comment.deleteKeepsRepliesMessage");
    expect(dialog).toContain("comment.deleteCommentMessage");
  });
});

describe("the timeline renders a tombstone instead of a blank bubble", () => {
  const card = code("components/issue/comment-card.tsx");

  it("has a placeholder branch for a deleted comment", () => {
    expect(card).toContain("isDeletedComment");
    expect(card).toContain("comment.deletedPlaceholder");
  });

  it("hides deleted replies, which render nothing", () => {
    // A deleted reply is only a parent anchor for its own replies; web drops
    // its row. Filtering must survive, or the row comes back as a blank bubble.
    // The inner `(reply) =>` keeps a naive `[^)]*` from matching, so allow
    // anything up to the predicate but bound it to the same statement.
    expect(card).toMatch(/replies\.filter\(\([^)]*\)\s*=>\s*!?isDeletedComment/);
  });

  it("renders the surviving replies, not the raw list", () => {
    // The filter is worthless if the render site still maps `replies`.
    expect(card).toContain("visibleReplies.map");
  });
});

describe("the tombstone marker survives the realtime path", () => {
  const updaters = code("data/realtime/issue-ws-updaters.ts");

  it("carries deleted_at through commentToTimelineEntry", () => {
    const start = updaters.indexOf("export function commentToTimelineEntry");
    expect(start).toBeGreaterThan(-1);
    const body = updaters.slice(start, start + 900);
    expect(body).toContain("deleted_at");
  });
});
