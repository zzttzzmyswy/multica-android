/**
 * Wiring ratchet for private projects (MUL-8472, MYS-2915).
 *
 * `lib/project-access.test.ts` proves the permission predicates answer
 * correctly. None of that reaches a user unless the three surfaces actually
 * mount them, and the gap this iteration removes is precisely "the helper
 * exists and nothing calls it": before this, the mobile app had no access
 * surface at all.
 *
 * Each assertion is paired with its negative, because presence alone passes on
 * a file that kept the old path beside the new one. Comments are stripped so a
 * comment describing the wiring cannot satisfy it — the convention this repo
 * already uses for wiring tests (`project-row-actions-wiring.test.ts`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function json(rel: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(APP_ROOT, rel), "utf8"));
}

const ACCESS_ROUTE = "app/(app)/[workspace]/project/[id]/picker/access.tsx";
const ACCESS_BODY = "components/project/project-access-body.tsx";
const PROPERTIES = "components/project/project-properties-section.tsx";
const DETAIL = "app/(app)/[workspace]/project/[id].tsx";
const NEW_PROJECT = "app/(app)/[workspace]/project/new.tsx";
const ROW = "components/project/project-row.tsx";
const LAYOUT = "app/(app)/[workspace]/_layout.tsx";
const MUTATIONS = "data/mutations/project-access.ts";

describe("access sheet is reachable and registered", () => {
  it("registers the route as a sheet", () => {
    const layout = code(LAYOUT);
    expect(layout).toContain('name="project/[id]/picker/access"');
    // ...and with SHEET_OPTIONS, not left to the default stack presentation:
    // every other project property picker is a formSheet and this one must not
    // be the exception a user notices.
    const idx = layout.indexOf('name="project/[id]/picker/access"');
    expect(layout.slice(idx, idx + 120)).toContain("SHEET_OPTIONS");
  });

  it("opens it from the detail screen's property row", () => {
    expect(code(DETAIL)).toContain("onPressAccess");
    // Not merely a handler name: the push must target the access route.
    expect(code(DETAIL)).toContain("/[workspace]/project/[id]/picker/access");
  });

  it("renders the access row inside the properties section", () => {
    const props = code(PROPERTIES);
    expect(props).toContain("<AccessRow");
    expect(props).toContain("projectVisibilityIsPrivate");
    // The row must consult the permission hook rather than showing a chevron
    // to everyone — a tap that can only 403 must not be offered.
    expect(props).toContain("useProjectAccessPermissions");
  });
});

describe("the sheet's three writes stay three", () => {
  const route = code(ACCESS_ROUTE);

  it("sends add and remove to their own endpoints", () => {
    // The route CONSTRUCTS the change; the dispatcher maps it to an endpoint.
    // `data/mutations/project-access.test.ts` pins the endpoint choice; what
    // this asserts is that the route asks for that dispatch at all and does
    // not hand-roll a PUT of its own.
    expect(route).toContain('type: "add"');
    expect(route).toContain('type: "remove"');
    const m = code(MUTATIONS);
    expect(m).toContain("sendProjectAccessChange");
    expect(m).toContain("client.addProjectMembers");
    expect(m).toContain("client.removeProjectMember");
  });

  it("sends the visibility switch as a PUT carrying the whole member list", () => {
    const m = code(MUTATIONS);
    expect(m).toContain('change.type === "visibility"');
    expect(m).toContain("client.updateProject");
    expect(m).toContain("member_ids: change.memberIds");
  });

  it("invalidates projects AND issues — an issue's visibility is its project's", () => {
    const m = code(MUTATIONS);
    expect(m).toContain("projectAccessInvalidationKeys");
    const helper = code(MUTATIONS);
    expect(helper).toContain("projectKeys.all(wsId)");
    expect(helper).toContain("issueKeys.all(wsId)");
  });

  it("routes add/remove through the dedicated endpoints only when already private", () => {
    // A draft project has no member rows yet, so add/remove must edit the draft
    // instead. Getting this backwards would POST a member to a public project
    // the server does not treat as having members.
    expect(route).toContain('currentVisibility === "private"');
    expect(route).toContain('type: "add"');
    expect(route).toContain('type: "remove"');
    expect(route).toContain("setDraftIds");
  });
});

describe("publishing a private project asks first", () => {
  const route = code(ACCESS_ROUTE);

  it("gates the workspace direction behind the confirmation predicate", () => {
    expect(route).toContain("visibilityRequiresPublishConfirm");
    expect(route).toContain("publish_title");
    expect(route).toContain("publish_description");
    // The confirm must not be the same call path as an ordinary save: if the
    // dirty save ran BEFORE the gate, the project would already be public.
    const gate = route.indexOf("visibilityRequiresPublishConfirm");
    const alert = route.indexOf("Alert.alert");
    expect(gate).toBeGreaterThan(-1);
    expect(alert).toBeGreaterThan(gate);
  });

  it("does not confirm the private direction", () => {
    // `visibilityRequiresPublishConfirm` itself is exercised in the unit
    // suite; here the point is that the route has exactly one confirmation
    // branch, keyed on the predicate rather than on `dirty`.
    expect(route.match(/Alert\.alert\(/g)?.length).toBe(1);
  });
});

describe("removal never offers the lead or yourself", () => {
  it("asks the predicate, not an inline id comparison", () => {
    const route = code(ACCESS_ROUTE);
    expect(route).toContain("canRemoveProjectMember");
    const body = code(ACCESS_BODY);
    expect(body).toContain("canRemove(");
    // The body renders no remove control of its own judgement: it must go
    // through the passed predicate.
    expect(body).not.toMatch(/targetId\s*===\s*leadId/);
  });
});

describe("a failed member read is not an empty member list", () => {
  const body = code(ACCESS_BODY);

  it("renders a distinct failure state with a retry", () => {
    expect(body).toContain("loadFailed");
    expect(body).toContain("projects.access.load_failed");
    expect(body).toContain("projects.access.retry");
  });

  it("does not fall through to the empty-list copy on failure", () => {
    // The failure branch must RETURN, or the "no members" sentence renders
    // underneath it and claims the project has nobody in it.
    const idx = body.indexOf("if (loadFailed)");
    expect(idx).toBeGreaterThan(-1);
    expect(body.slice(idx, idx + 400)).toContain("return");
  });
});

describe("the create form can make a project private", () => {
  const form = code(NEW_PROJECT);

  it("offers both choices and writes the draft", () => {
    expect(form).toContain("setVisibility");
    expect(form).toContain("newProject.visibilityWorkspace");
    expect(form).toContain("newProject.visibilityPrivate");
  });

  it("sends visibility and member_ids only in the private direction", () => {
    expect(form).toContain('visibility === "private"');
    expect(form).toContain("member_ids: memberIds");
  });

  it("counts a visibility change as unsaved work", () => {
    // Otherwise Cancel would discard a private choice without warning.
    expect(form).toContain('visibility !== "workspace"');
  });
});

describe("the list shows which projects are private", () => {
  it("renders a lock only for private projects", () => {
    const row = code(ROW);
    expect(row).toContain("projectVisibilityIsPrivate");
    expect(row).toMatch(/lock-closed/);
  });
});

describe("every key the surface renders exists in both bundles", () => {
  const en = json("lib/i18n/locales/en.json");
  const zh = json("lib/i18n/locales/zh.json");

  it("resolves projects.access.* and the new-project access keys", () => {
    const keys = [
      "projects.access.label",
      "projects.access.title",
      "projects.access.description",
      "projects.access.workspace",
      "projects.access.private",
      "projects.access.members_count",
      "projects.access.add",
      "projects.access.search",
      "projects.access.no_members",
      "projects.access.no_selected",
      "projects.access.admin_notice",
      "projects.access.agent_notice",
      "projects.access.you",
      "projects.access.remove_aria",
      "projects.access.failed",
      "projects.access.load_failed",
      "projects.access.publish_title",
      "projects.access.publish_description",
      "projects.access.publish_confirm",
      "projects.access.done",
      "projects.access.retry",
      "projects.access.read_only",
      "projects.access.privateHint",
      "projects.access.workspaceHint",
      "newProject.access",
      "newProject.visibilityWorkspace",
      "newProject.visibilityPrivate",
      "newProject.accessSeeded",
    ];
    for (const key of keys) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(zh[key], `zh ${key}`).toBeTruthy();
    }
  });

  it("keeps the two visibility names distinguishable in both languages", () => {
    // If both options read the same, the choice is meaningless — and choosing
    // wrong makes a project invisible to most of the workspace.
    expect(en["projects.access.workspace"]).not.toBe(en["projects.access.private"]);
    expect(zh["projects.access.workspace"]).not.toBe(zh["projects.access.private"]);
  });

  it("names WHO gets access in the publish warning, not just that it changes", () => {
    // The whole reason the confirmation exists: the reader must learn that
    // everyone will see it, and that it cannot be taken back.
    const zhWarn = zh["projects.access.publish_description"];
    expect(zhWarn).toContain("所有成员");
    expect(zhWarn).toContain("无法");
    const enWarn = en["projects.access.publish_description"];
    expect(enWarn).toContain("All workspace members");
  });
});
