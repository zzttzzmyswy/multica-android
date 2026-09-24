/**
 * Recognise a link that addresses one issue or project page on THIS
 * deployment — mobile port of web's `parseWorkspaceEntityLink`
 * (`packages/views/editor/utils/link-handler.ts:197`) plus the
 * `unfurlableEntityLink` gate that sits on top of it
 * (`packages/views/rich-content/rich-content.tsx:193`).
 *
 * Why this exists: an issue link pasted into a comment or a chat message is
 * the same destination as the mention chip the composer produces, but the
 * markdown renderer only special-cases the `mention://` scheme. Everything
 * else fell through to `Linking.openURL`, so tapping a link to an issue in
 * the app you are already in threw the user into a browser — and on a phone
 * that browser tab has no session, so the destination was usually a login
 * wall (MYS-270/MYS-327 are the same failure for attachment URLs).
 *
 * Resolution goes through a real URL parse rather than a string prefix test.
 * A leading slash does NOT mean "this site": `//other.example/x` and
 * `/\other.example/x` both start with one and both name another host. A
 * parser sees the host; a prefix test cannot, and no list of prefixes closes
 * the gap.
 *
 * PURE — no React, no navigation. The caller decides what to do with the
 * result, which is what keeps this testable in the Node vitest lane.
 */
import { isReservedSlug } from "@multica/core/paths";

/** An in-app entity page addressed by a link. */
export interface WorkspaceEntityRef {
  kind: "issue" | "project";
  /**
   * Entity id from the path — a UUID for either kind, or, for an issue, a
   * bare identifier (`MUL-123`). Callers dispatch on the shape: an identifier
   * still has to be resolved before it can be navigated to.
   */
  id: string;
  /**
   * Workspace slug the link names, or `null` for the slug-less legacy form
   * (`/issues/<uuid>`), which is current-workspace by construction. A caller
   * rendering workspace-scoped data MUST compare a non-null slug against the
   * current one — the entity only resolves inside the workspace that owns it.
   */
  slug: string | null;
}

const ENTITY_ROUTE_SEGMENTS: Record<string, WorkspaceEntityRef["kind"]> = {
  issue: "issue",
  issues: "issue",
  project: "project",
  projects: "project",
};

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Bare issue identifier (`MUL-123`). Mirrors `@multica/ui/markdown`'s
 *  `isIssueIdentifier` — a UUID never matches (lowercase hex, four dashes), so
 *  the two shapes are unambiguous. Duplicated rather than imported: the ui
 *  package is not on mobile's import surface. */
const ISSUE_IDENTIFIER_RE = /^[A-Z][A-Z0-9]*-\d+$/;

export function isIssueIdentifier(value: string): boolean {
  return ISSUE_IDENTIFIER_RE.test(value);
}

/** A project is only ever addressed by UUID; an issue also has the identifier
 *  shorthand, which is what "Copy link" actually produces. */
function isEntityId(kind: WorkspaceEntityRef["kind"], id: string): boolean {
  return UUID_RE.test(id) || (kind === "issue" && isIssueIdentifier(id));
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The path (pathname + search + hash) a link addresses on THIS deployment, or
 * `null` when it addresses anywhere else.
 *
 * `URL` needs an absolute base, so a site-relative href is resolved against
 * `appOrigin`. With no origin known, nothing resolves — failing closed is the
 * safe direction (a link we cannot prove is ours gets the external-browser
 * treatment it has always had).
 */
function toSameOriginPath(
  href: string,
  appOrigin: string,
): string | null {
  if (!appOrigin) return null;
  let target: URL;
  let app: URL;
  try {
    target = new URL(href, appOrigin);
    app = new URL(appOrigin);
  } catch {
    return null;
  }
  if (target.origin !== app.origin) return null;
  // Opaque origins (`javascript:`, `data:`) stringify to "null" and can never
  // equal a real one, so they fall out here too.
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

/**
 * Parse a link addressing exactly one issue or project page on this
 * deployment; `null` for everything else — external URLs, list pages, deeper
 * routes, and links carrying a query string or fragment.
 *
 * The query/fragment rejection is not pedantry: `?view=<id>` addresses a
 * specific saved view and `#comment-3` a specific comment, and collapsing
 * either to "the issue page" would silently drop what the author linked to.
 */
export function parseWorkspaceEntityLink(
  href: string,
  appOrigin: string | null | undefined,
): WorkspaceEntityRef | null {
  if (!appOrigin) return null;
  const path = toSameOriginPath(href, appOrigin);
  if (!path) return null;
  if (path.includes("?") || path.includes("#")) return null;

  const segments: string[] = [];
  for (const raw of path.split("/").filter(Boolean)) {
    const decoded = decodeSegment(raw);
    if (decoded === null) return null;
    segments.push(decoded);
  }

  // `/{slug}/{route}/{id}` — what every in-app "copy link" produces.
  // `/{route}/{id}` — slug-less legacy content, current-workspace by
  // definition since the writer meant their own workspace.
  let slug: string | null;
  let route: string | undefined;
  let id: string | undefined;
  if (segments.length === 3) {
    const [first, second, third] = segments;
    if (!first || isReservedSlug(first.toLowerCase())) return null;
    slug = first;
    route = second;
    id = third;
  } else if (segments.length === 2) {
    slug = null;
    [route, id] = segments;
  } else {
    return null;
  }

  const kind = route ? ENTITY_ROUTE_SEGMENTS[route] : undefined;
  if (!kind || !id || !isEntityId(kind, id)) return null;
  return { kind, id, slug };
}

/**
 * Whether a markdown link should be rendered as an in-app entity chip rather
 * than opened externally — web's `unfurlableEntityLink`
 * (`rich-content.tsx:193-204`).
 *
 * Two gates beyond a successful parse:
 *   - the visible LABEL must be the href itself. `[see this issue](url)` is
 *     prose the author wrote; replacing it with a chip would discard the
 *     label they chose.
 *   - a link naming a DIFFERENT workspace must not unfurl. A chip resolves
 *     its title against the CURRENT workspace, so a cross-workspace link
 *     would turn a working link into a permanently empty chip.
 */
export function parseUnfurlableEntityLink({
  href,
  label,
  currentSlug,
  appOrigin,
}: {
  href: string;
  /** The link's visible text. */
  label: string;
  currentSlug: string | null;
  appOrigin: string | null | undefined;
}): WorkspaceEntityRef | null {
  if (label !== href) return null;
  const entity = parseWorkspaceEntityLink(href, appOrigin);
  if (!entity) return null;
  if (entity.slug !== null && entity.slug !== currentSlug) return null;
  return entity;
}

/**
 * The app-route path for an entity, or `null` when it cannot be addressed
 * yet. An identifier-shaped issue id still needs a lookup, so it resolves to
 * null here and the caller keeps the plain link.
 */
export function entityRoutePath(
  entity: WorkspaceEntityRef,
  wsSlug: string | null,
): string | null {
  if (!wsSlug) return null;
  if (isIssueIdentifier(entity.id)) return null;
  return entity.kind === "issue"
    ? `/${wsSlug}/issue/${entity.id}`
    : `/${wsSlug}/project/${entity.id}`;
}
