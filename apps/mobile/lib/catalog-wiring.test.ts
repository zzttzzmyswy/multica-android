/**
 * Wiring guard for the four-state remote-directory read (MYS-1892, widened by
 * MYS-1907).
 *
 * Mobile's vitest lane is Node-only (see vitest.config.ts) — there is no RN
 * renderer, so `resolveCatalogState` being correct proves nothing about what the
 * surfaces do with it. The regression this pins is exactly the one a
 * helper-level test cannot see: a caller destructures `{ data: rows = [] }` and
 * branches on `rows.length === 0`, which folds "still loading" and "request
 * failed" into "the workspace has none".
 *
 * Three assertions per surface, because any one alone is passable:
 *
 *   1. The surface reads the directory through `catalogRead` — otherwise there
 *      is no state to render.
 *   2. The surface does not destructure the raw query `data` with an empty
 *      default — the specific construct that collapsed the states.
 *   3. The surface's empty slot goes through `CatalogEmptySlot` — a surface that
 *      resolves the state and then re-implements the branches locally would
 *      drift from the copy and the retry semantics.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * call cannot satisfy or trip an assertion.
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

function code(rel: string): string {
  return readFileSync(path.join(APP_ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The pickers that read a workspace directory and said "there is nothing here"
 *  out of a read that had not settled. Each one carried its own absence
 *  sentence (「无匹配结果。」/「此工作区暂无项目。请在网页端创建。」/「此工作区暂无
 * 标签。」/「此工作区暂无成员或智能体。」) that a failed or in-flight request
 *  fell into.
 *
 *  The property catalog surfaces joined this list in MYS-1892 (they were the
 *  first half of the family); this iteration added the five picker bodies and
 *  the project-lead picker, which had the identical shape. */
const PICKER_SURFACES = [
  "components/issue/pickers/assignee-picker-body.tsx",
  "components/issue/pickers/mention-picker-body.tsx",
  "components/issue/pickers/label-picker-body.tsx",
  "components/issue/pickers/project-picker-body.tsx",
  "components/issue/pickers/filter-picker-bodies.tsx",
  "components/project/pickers/project-lead-picker-body.tsx",
  "components/issue/mention-suggestion-bar.tsx",
  "components/issue/subscriber-picker-sheet.tsx",
];

/** The surfaces that read a workspace directory *inside a detail page's
 *  section* rather than a picker, and said "there is nothing here" out of a read
 *  that had not settled (MYS-1916).
 *
 *  Same defect shape as the pickers, one level down: these are cards on a page
 *  that already resolved its own record, so they never went through the picker
 *  sweep. Each one defaulted its directory to `[]` and branched on the length —
 *  a failed read therefore rendered 「工作区还没有 skill」、「无智能体专属 MCP 服务
 *  器」、「暂无 Webhook 投递记录」, all assertions about the workspace made from a
 *  request that never landed. `emptyMessage` is the caller's own "genuinely
 *  none" sentence, which is the only branch allowed to make that claim. */
const SECTION_SURFACES: string[] = [
  "components/agent/agent-skills-section.tsx",
  "components/agent/agent-mcp-section.tsx",
  "components/autopilot/deliveries-section.tsx",
];

/** The property-catalog surfaces, which keep their own hook (it selects between
 *  the active-only and include-archived projections) but share the same
 *  resolver, the same state painter and the same `isResolved` gate. */
const PROPERTY_SURFACES: {
  file: string;
  hook: "useActivePropertyCatalog" | "usePropertyCatalog";
}[] = [
  { file: "app/(app)/[workspace]/issues-filter.tsx", hook: "useActivePropertyCatalog" },
  { file: "app/(app)/[workspace]/issues-filter-picker.tsx", hook: "useActivePropertyCatalog" },
  { file: "app/(app)/[workspace]/issue/[id]/picker/properties.tsx", hook: "usePropertyCatalog" },
  { file: "app/(app)/[workspace]/more/properties/[id].tsx", hook: "usePropertyCatalog" },
  { file: "components/issue/pickers/property-value-editor.tsx", hook: "usePropertyCatalog" },
];

/** Every surface in the family, for the checks that apply to all of them. */
const ALL_SURFACES = [
  ...PICKER_SURFACES,
  ...PROPERTY_SURFACES.map((s) => s.file),
];

/** Detail / edit routes that resolve ONE row out of a directory read.
 *
 *  Same defect one level up (MYS-1908): these wrote `if (q.isLoading) …; if
 *  (!record) → "does not exist"`, and `isLoading` is only true for the first
 *  attempt, so a failed read rendered "not found" over a record that was
 *  merely unreachable — 「还没有智能体」, 「还没有小队」, and 「该工作区已不可用。」
 *  (which also pushed the user out to the workspace switcher).
 *
 *  Each entry names the row it shows so the guard can assert the page gates on
 *  `recordRead`/`isResolved` rather than on `!<row>`. */
const RECORD_SURFACES = [
  "app/(app)/[workspace]/more/agents/[id].tsx",
  "app/(app)/[workspace]/more/agents/[id]/edit.tsx",
  "app/(app)/[workspace]/more/agents/[id]/integrations.tsx",
  "app/(app)/[workspace]/more/autopilots/[id].tsx",
  "app/(app)/[workspace]/more/autopilots/[id]/edit.tsx",
  "app/(app)/[workspace]/more/mcp-servers/[id].tsx",
  "app/(app)/[workspace]/more/squads/[id].tsx",
  "app/(app)/[workspace]/more/members/[id].tsx",
  "app/(app)/[workspace]/more/settings/workspace.tsx",
  "app/(app)/[workspace]/more/agents/[id]/custom-args.tsx",
  "app/(app)/[workspace]/more/agents/[id]/env.tsx",
  "app/(app)/[workspace]/project/[id]/edit.tsx",
];

describe("remote-directory four-state wiring", () => {
  describe("record pages", () => {
    for (const file of RECORD_SURFACES) {
      const src = code(file);

      it(`${file} resolves its row through recordRead`, () => {
        expect(src).toContain("recordRead");
      });

      it(`${file} gates the not-found branch on the read being settled`, () => {
        // The collapse was `if (isLoading) …; if (!record) → "missing"`.
        // Anything that claims an absence must be downstream of a settled read.
        // Asserting the *shape* (`!read.isResolved`, or `read.isResolved ?`)
        // rather than the bare token, so a file cannot satisfy this by
        // importing the flag and never branching on it.
        expect(src).toMatch(/!\s*read\.isResolved|read\.isResolved\s*\?/);
      });

      it(`${file} offers a retry out of the failure`, () => {
        // Every one of these pages was a dead end before: the only way past a
        // failed read was to kill the app.
        expect(src).toContain("CatalogStatus");
      });
    }

    // `channelState` reads `configured` straight off the listing, so a failed
    // listing used to render 「尚未配置」 for a channel that may well be
    // connected. Each card carries its own state instead of the page blanking.
    it("gives each agent channel card its own read state", () => {
      const src = code("app/(app)/[workspace]/more/agents/[id]/integrations.tsx");
      expect(src).toMatch(/channelReads/);
      expect(src).toContain("loadState");
      expect(src).toMatch(/loadState === "error"/);
    });
  });

  describe("page sections", () => {
    for (const file of SECTION_SURFACES) {
      const src = code(file);

      it(`${file} reads its directory through catalogRead`, () => {
        expect(src).toContain("catalogRead");
      });

      it(`${file} never defaults raw query data to an empty array`, () => {
        // `{ data: rows = [] }` is the construct that made a failed read
        // indistinguishable from an empty workspace.
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
      });

      it(`${file} decides its empty slot instead of assuming it`, () => {
        expect(src).toContain("CatalogStatus");
      });
    }
  });

  describe("pickers", () => {
    for (const file of PICKER_SURFACES) {
      const src = code(file);

      it(`${file} reads its directories through catalogRead`, () => {
        expect(src).toContain("catalogRead");
      });

      it(`${file} never defaults raw query data to an empty array`, () => {
        // The exact construct from the bug report: the `= []` default is what
        // made a failed read indistinguishable from an empty workspace.
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
      });

      it(`${file} decides its empty slot instead of assuming it`, () => {
        expect(src).toContain("CatalogEmptySlot");
      });
    }
  });

  describe("property catalog", () => {
    for (const { file, hook } of PROPERTY_SURFACES) {
      const src = code(file);

      it(`${file} reads the catalog through ${hook}`, () => {
        expect(src).toContain(hook);
      });

      it(`${file} never defaults the raw catalog data to an empty array`, () => {
        expect(src).not.toMatch(/data:\s*\w+\s*=\s*\[\]/);
        expect(src).not.toMatch(/catalog\s*=\s*useQuery\([\s\S]*?\}\)\.data/);
      });
    }

    it("keeps the shared status painter as the only error/empty renderer", () => {
      for (const { file } of PROPERTY_SURFACES) {
        expect(code(file)).toContain("PropertyCatalogStatus");
      }
    });
  });

  it("gives the failure a retry, not just a message", () => {
    // One implementation now serves both families, so the retry is asserted
    // where it lives rather than per caller.
    const status = code("components/catalog/catalog-status.tsx");
    expect(status).toContain("onRetry");
    expect(status).toContain("common.retry");

    // The property-flavoured name is an alias, not a second implementation —
    // two implementations of one truth is how the second half of a bug family
    // survives.
    const alias = code("components/property/property-catalog-status.tsx");
    expect(alias).toContain("CatalogStatus");
    expect(alias).not.toContain("ActivityIndicator");
  });

  it("never reports an absence without having settled the read", () => {
    // The one sentence that must never be reachable from a non-settled read.
    // `CatalogEmptySlot` resolves the verdict from the states handed to it, so
    // the decision lives in exactly one place and no caller can skip it by
    // writing its own `if (query)` branch.
    const slot = code("components/catalog/catalog-status.tsx");
    expect(slot).toContain("resolveCatalogEmpty");
    expect(slot).toContain("verdict.kind");
  });

  it("never folds a failed read into a record's absence claim", () => {
    // MYS-1910, surface D. These two pages resolve their row out of a list and
    // branched `if (error || !x) → "does not exist"`, which states a fact about
    // the record ("被移除") from an attempt that merely did not land. The
    // failure needs its own branch, checked before the absence claim.
    for (const file of [
      "app/(app)/[workspace]/more/runtimes/[id].tsx",
      "app/(app)/[workspace]/more/runtimes/machine/[machineId].tsx",
    ]) {
      const src = code(file);
      // The collapsed form is gone...
      expect(src).not.toMatch(/if\s*\(\s*error\s*\|\|\s*!/);
      // ...and the failure is named as a failure, before the not-found claim.
      const errorAt = src.indexOf("if (error)");
      const notFoundAt = src.search(/if\s*\(\s*!\s*(runtime|machine)\s*\)/);
      expect(errorAt).toBeGreaterThan(-1);
      expect(notFoundAt).toBeGreaterThan(errorAt);
    }
  });

  it("never branches a load state on isLoading alone", () => {
    // `isLoading` is only true for a query's FIRST attempt. Every surface that
    // wrote `q.isLoading ? spinner : (q.data ?? empty)` therefore fell into the
    // empty branch on a failure (isLoading false, data undefined) and asserted
    // the absence as a fact. `isPending` is the variant React Query v5 keeps
    // true until data or an error exists, and it is what these sites use now.
    //
    // Scoped to the two files this iteration converted; the pattern is not
    // globally banned because a query with a `placeholderData` seed legitimately
    // wants to distinguish its first paint.
    for (const file of [
      "app/(app)/[workspace]/more/autopilots/[id].tsx",
      "components/autopilot/deliveries-section.tsx",
    ]) {
      expect(code(file)).not.toMatch(/\w+Query\.isLoading|\{\s*isLoading\s*\}/);
    }
  });

  it("gives the autopilot run history and webhook payload their own states", () => {
    // Runs: `runList = runs.data ?? []` + `runList.length === 0` printed
    // 「暂无运行记录。点击"立即运行"手动触发。」 over real history — and the copy's
    // recommended next step fires another run to cure a display bug.
    // Payload: `payloadQuery.isLoading` is first-attempt-only, so a failed read
    // stated 「该 run 无触发载荷」 about a request that never landed.
    const src = code("app/(app)/[workspace]/more/autopilots/[id].tsx");
    expect(src).toContain("runsRead");
    expect(src).toMatch(/runsRead\.state !== "ready"/);
    expect(src).toContain("payloadQuery.isError");
    expect(src).toMatch(/payloadQuery\.isPending/);
  });

  it("gives the inbox-item screen a failure branch before its missing claim", () => {
    // The screen had only loading/ready/missing, so a failed list read landed in
    // `missing` and told the user the notification was gone.
    const src = code("app/(app)/[workspace]/inbox-item/[id].tsx");
    expect(src).toMatch(/phase === "error"/);
    const errorAt = src.indexOf('phase === "error"');
    const missingAt = src.indexOf('t("inbox.detail.notificationMissing")');
    expect(errorAt).toBeGreaterThan(-1);
    expect(missingAt).toBeGreaterThan(errorAt);
  });

  it("keeps the view-bar preference write behind both reads", () => {
    // The whole-document PUT (MYS-1916): writing the bar preference before the
    // preference read settled dropped every existing hide, and pruning against an
    // unsettled views list zeroed the document. Web guards this with
    // `if (!viewsReady) return;`; mobile needs both reads, because the doc it
    // writes is built from the prefs read and pruned against the views read.
    const src = code("components/issue/issue-view-bar.tsx");
    // Each flag is the resolved-ness of its own read...
    expect(src).toMatch(/const viewsReady = viewsRead\.isResolved/);
    expect(src).toMatch(/const prefsReady = prefsRead\.isResolved/);
    // ...and both are handed to the guard, which gates the mutation.
    expect(src).toContain("canWriteViewBarPrefs");
    expect(src).toMatch(/prefsSettled:\s*prefsReady/);
    expect(src).toMatch(/viewsSettled:\s*viewsReady/);
    // The write stays downstream of the guard, never beside it.
    const guardAt = src.indexOf("canWriteViewBarPrefs");
    const mutateAt = src.indexOf("updatePreference.mutate");
    expect(guardAt).toBeGreaterThan(-1);
    expect(mutateAt).toBeGreaterThan(guardAt);
  });

  it("keeps a route back to a lone hidden view", () => {
    // Caught while exercising the built APK: the manage button was gated on
    // `allViewItems.length > 1`, so hiding the last-remaining bar view left an
    // empty bar whose only recovery affordance was gone — the `allHidden` copy
    // ended by pointing at a button that was no longer rendered. Revealing needs
    // one item; only reordering needs two.
    const src = code("components/issue/issue-view-bar.tsx");
    expect(src).toContain("showsViewBarManage");
    expect(src).not.toMatch(/allViewItems\.length > 1\s*\?/);
  });

  it("keeps the delete-view path off the preference document", () => {
    // 差距 2 of MYS-1916 asked whether deleting a view also overwrites the prefs
    // doc out of an unsettled read. Checked against the source: it does not.
    // `deleteView` is `useDeleteIssueView` — a DELETE of the view plus a list
    // invalidation, with no prefs write at all — and it is the only call the
    // delete action makes. The stale `view:<id>` entry it leaves behind is
    // pruned at the next toggle/reorder through `sanitizeViewBarPrefs`, and
    // `applyViewBarPrefs` ignores an unknown id meanwhile, so nothing is lost
    // even if that pruned write is the one the guard drops.
    const src = code("components/issue/issue-view-bar.tsx");
    expect(src).toContain("useDeleteIssueView");
    // The delete branch never reaches the prefs mutation.
    const deleteAt = src.indexOf('case "delete":');
    expect(deleteAt).toBeGreaterThan(-1);
    const branch = src.slice(deleteAt, src.indexOf('case "cancel":', deleteAt));
    expect(branch).toContain("deleteView.mutate");
    expect(branch).not.toContain("savePrefs");
    expect(branch).not.toContain("updatePreference");
  });

  it("has no picker left claiming 'no matches' outside the shared slot", () => {
    // A surface that still hand-rolls `t("picker.noMatches")` beside its own
    // list is one refactor away from re-collapsing the states, because the
    // string is the *only* thing telling the user which of the three situations
    // they are in. Any file that renders that string next to a list must be
    // routing through the shared slot.
    //
    // No surface needs an exemption any more. `FilterPropertyPickerBody` used
    // to render `picker.noMatches` beside a list with no search box; its copy
    // now names the actual fact ("this property has no options") instead.
    const ALLOWED = new Set(["components/catalog/catalog-status.tsx"]);
    const offenders: string[] = [];
    for (const rel of globSync("{components,app}/**/*.{ts,tsx}", {
      cwd: APP_ROOT,
      exclude: (name) => name.endsWith(".test.ts") || name.endsWith(".test.tsx"),
    })) {
      if (ALLOWED.has(rel)) continue;
      const src = code(rel);
      if (
        src.includes('t("picker.noMatches")') &&
        (src.includes("ListEmptyComponent") || src.includes('kind: "empty"'))
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  describe("the shared multi-select sheet (MYS-1924, gap 2)", () => {
    // `MultiSelectSheet` is the one implementation behind thirteen picker call
    // sites. It accepted only a `loading` boolean and had no failure branch at
    // all, so every caller's failed directory read fell into its `emptyText`
    // branch: 「工作区还没有 skill，请先创建或导入。」, 「没有可选择的工作区成员。」,
    // 「工作区没有可选择的成员」, 「没有匹配的成员」, 「没有可添加的智能体。」 — five
    // different absence claims, all made from requests that never landed.
    //
    // The sheet now takes the resolved `CatalogState`, so the guard checks the
    // two halves: the sheet must decide its empty slot through the shared
    // tools, and every caller reading a workspace directory must hand it a
    // state (otherwise the failure branch is unreachable in practice, which is
    // exactly how the dead `loading` prop survived).
    const SHEET = "components/agent/multi-select-sheet.tsx";

    it("routes the sheet's non-ready states through the shared painter", () => {
      const src = code(SHEET);
      expect(src).toContain("CatalogStatus");
      expect(src).toMatch(/state\s*=\s*"ready"/);
      // The bare boolean is gone — it could not express failure.
      expect(src).not.toMatch(/loading\s*=\s*false/);
      expect(src).not.toMatch(/^\s*loading\?:/m);
    });

    it("gives the sheet a retry on its failure branch", () => {
      expect(code(SHEET)).toContain("onRetry");
    });

    // Every call site of the sheet. Two kinds:
    //   - `state`-passing: the rows come from a workspace directory, so a
    //     failure must be renderable.
    //   - static/derived: rows built from data the caller already resolved
    //     (the agent's own access list, a value store), where there is no read
    //     to fail.
    const DIRECTORY_CALLERS = [
      "components/skill/skill-batch-bar.tsx",
      "components/agent/agent-access-picker.tsx",
      "components/agent/agent-skills-section.tsx",
      "components/agent/builder-config-panel.tsx",
      "components/agent/manual-agent-form.tsx",
      "components/autopilot/autopilot-form.tsx",
      "app/(app)/[workspace]/more/autopilots.tsx",
      "app/(app)/[workspace]/more/squads.tsx",
      "app/(app)/[workspace]/more/skills.tsx",
      "app/(app)/[workspace]/more/autopilots/[id].tsx",
      "app/(app)/[workspace]/more/skills/[id].tsx",
    ];

    for (const file of DIRECTORY_CALLERS) {
      it(`${file} hands its directory state to the sheet`, () => {
        const src = code(file);
        expect(src).toContain("MultiSelectSheet");
        // `state=` is the prop that makes the failure branch reachable.
        expect(src).toMatch(/\bstate=\{/);
        expect(src).toMatch(/\bonRetry=\{/);
      });
    }

    it("leaves no caller defaulting its picker directory to an empty array", () => {
      // Same construct the picker sweep bans: a caller that folds a failed read
      // into `[]` and then passes that as `rows`/`groups` re-creates the bug
      // above the sheet, where the sheet's `state` cannot see it.
      //
      // Scoped to the *directory* reads these pickers are built from, not to
      // `= []` file-wide: several of these files also hold label-lookup reads
      // (an agent id → display name, with an id-stub fallback) whose emptiness
      // is never rendered as an absence, and forcing those through `catalogRead`
      // would add noise without removing a way to lie.
      const PICKER_DIRECTORIES = [
        "agentListOptions",
        "agentListAllOptions",
        "memberListOptions",
        "skillListOptions",
        "squadListOptions",
        "projectListOptions",
        "resourceLabelsOptions",
      ];
      const banned = new RegExp(
        `data:\\s*\\w+\\s*=\\s*\\[\\]\\s*\\}\\s*=\\s*useQuery\\(\\s*(?:${PICKER_DIRECTORIES.join("|")})`,
      );

      for (const file of DIRECTORY_CALLERS) {
        expect(code(file), file).not.toMatch(banned);
      }
    });
  });

  describe("chat availability (MYS-1924, gap 1)", () => {
    // The chat tab's "does this user have an agent to talk to?" answer gates the
    // composer. It resolved from `isFetched`, which React Query counts a *failed*
    // attempt toward, so one timeout declared 「暂无可用智能体」 and disabled the
    // input box — locking the main feature with no retry anywhere.
    const CHAT = "app/(app)/[workspace]/(tabs)/chat.tsx";

    it("resolves availability from a decision that can express failure", () => {
      // The pure resolver is where the four states live, and it is unit-tested
      // directly in `agent-availability.test.ts` (a .tsx surface cannot run in
      // the Node lane).
      const lib = code("lib/agent-availability.ts");
      expect(lib).toContain("resolveWorkspaceAgentAvailability");
      expect(lib).toMatch(/"loading"\s*\n?\s*\|\s*"error"/);

      const hook = code("lib/workspace-agent-availability.ts");
      expect(hook).toContain("resolveWorkspaceAgentAvailability");
      // `isFetched` is the primitive that caused the bug: it answers "has an
      // attempt completed", not "do we know the answer".
      expect(hook).not.toContain("isFetched");
      expect(hook).toContain("retry");
    });

    it("never lets a failed read disable the composer", () => {
      const src = code(CHAT);
      // The gate is `availability === "none"` — the settled, genuinely-empty
      // answer — and never the error state.
      expect(src).toMatch(/availability === "none"/);
      expect(src).not.toMatch(/availability !== "available"/);
      // The *composer gate* specifically, not just the banner: check the
      // disabled expression itself. Adding `availability === "error"` there
      // re-locks the input while leaving the banner correct, which the
      // assertions above cannot see — verified by reverting that line and
      // watching this test still pass.
      const disabledAt = src.indexOf("const disabled =");
      expect(disabledAt).toBeGreaterThan(-1);
      const gate = src.slice(disabledAt, src.indexOf("const disabledReason"));
      expect(gate).toContain('availability === "none"');
      expect(gate).not.toContain('"error"');
      // The failure gets its own banner with a retry, not the no-agent one.
      expect(src).toContain("AgentsUnavailableBanner");
      expect(src).toContain("retryAvailability");
    });

    it("tells the failure apart from the empty workspace", () => {
      // Two different facts, two different components. Collapsing them is how
      // the false claim returns.
      const banner = code("components/chat/agents-unavailable-banner.tsx");
      expect(banner).toContain("chat.agentsUnavailableTitle");
      expect(banner).not.toContain("chat.noAgentsTitle");
      expect(banner).toContain("common.retry");
    });
  });

  describe("assertion-style empty states (MYS-1924, gap 3)", () => {
    // Each of these stated a fact — about money, about a runtime's
    // configuration, about an agent's history — from a read that had merely not
    // landed. Same guard shape as everywhere else in this file: read through
    // `catalogRead`, and paint the failure rather than claiming an absence.
    //
    // The reads checked below are named individually rather than banning `= []`
    // file-wide, because these files also hold *label-lookup* reads (an agent id
    // → display name, with an id-stub fallback) whose emptiness is never spoken
    // aloud — a blanket ban would force those through `catalogRead` for no gain
    // and bury a real regression in noise.
    const CLAIM_READS = [
      "components/runtimes/runtime-usage-section.tsx:runtimeUsageOptions",
      "components/runtimes/runtime-usage-section.tsx:runtimeUsageByAgentOptions",
      "components/agent/agent-activity-section.tsx:agentTaskSnapshotOptions",
      "components/agent/agent-activity-section.tsx:agentTasksOptions",
      "app/(app)/[workspace]/chat-sessions.tsx:chatSessionsOptions",
    ];

    for (const entry of CLAIM_READS) {
      const [file, option] = entry.split(":");

      it(`${entry} is read through catalogRead, not an empty-array default`, () => {
        const src = code(file);
        // `catalogRead(useQuery(<option>(...)))`, possibly with the query spread
        // across lines — match the option inside a `catalogRead(` call.
        const call = new RegExp(
          `catalogRead\\([\\s\\S]{0,200}?${option}\\(`,
        );
        expect(src).toMatch(call);
        // ...and never as a bare destructure with an `= []` default.
        const raw = new RegExp(
          `data:\\s*\\w+\\s*=\\s*\\[\\]\\s*\\}\\s*=\\s*useQuery\\(\\s*${option}`,
        );
        expect(src).not.toMatch(raw);
      });
    }

    it("gives the runtime usage section a failure that is not 'no usage data'", () => {
      // The section renders a cost dashboard; 「还没有使用数据」 next to a runtime
      // that spent money is the worst version of this bug family.
      const src = code("components/runtimes/runtime-usage-section.tsx");
      const errorAt = src.indexOf('usageRead.state === "error"');
      const emptyAt = src.indexOf("usage.length === 0");
      expect(errorAt).toBeGreaterThan(-1);
      expect(emptyAt).toBeGreaterThan(errorAt);
    });

    it("gives the runtime serving card its own read state", () => {
      const src = code("app/(app)/[workspace]/more/runtimes/[id].tsx");
      expect(src).toContain("catalogRead");
      expect(src).toMatch(/state=\{agentsRead\.state\}/);
      expect(src).toMatch(/onRetry=\{agentsRead\.retry\}/);
      // The empty claim is gated behind the state, never reachable from it.
      const gateAt = src.indexOf('state !== "ready"');
      const claimAt = src.indexOf("runtimes.detail.noAgents");
      expect(gateAt).toBeGreaterThan(-1);
      expect(claimAt).toBeGreaterThan(gateAt);
    });

    it("keeps the autopilot assignee picker reachable when its read fails", () => {
      // The old branch replaced the picker with a "no agents" note, removing
      // the only control that can fill a required field — so the form could not
      // be submitted at all. The note is now reachable only from a settled,
      // genuinely-empty pair.
      const src = code("components/autopilot/autopilot-form.tsx");
      expect(src).toContain("assigneeCatalogState");
      expect(src).toContain("unsettledCatalogStatus");
      const gateAt = src.indexOf("assigneeCatalogState");
      const noteAt = src.indexOf("autopilots.new.agentsEmpty");
      expect(gateAt).toBeGreaterThan(-1);
      expect(noteAt).toBeGreaterThan(gateAt);
    });

    it("gives the chat session list a load state it never had", () => {
      // This screen had no `isLoading` / `isError` / spinner at all: in-flight
      // and failed both rendered 「暂无聊天。」.
      const src = code("app/(app)/[workspace]/chat-sessions.tsx");
      expect(src).toContain("catalogRead");
      expect(src).toContain("CatalogStatus");
      expect(src).toMatch(/sessionsRead\.state !== "ready"/);
      // The sessions read itself must not be an `= []` default. The `agents`
      // read beside it is a label map with an id-stub fallback whose emptiness
      // is never spoken aloud, so the ban is scoped to the read that actually
      // backs the empty state.
      expect(src).not.toMatch(
        /data:\s*\w+\s*=\s*\[\]\s*\}\s*=\s*useQuery\(chatSessionsOptions/,
      );
    });

    it("gives the GitHub picker a failure branch before 'not configured'", () => {
      // 「当前部署尚未配置 GitHub 连接。」 is an assertion about a deployment made
      // from a request that timed out.
      const src = code(
        "app/(app)/[workspace]/more/settings/repositories/github-picker.tsx",
      );
      expect(src).toContain("resolveCatalogState");
      expect(src).toContain("CatalogStatus");
      const errorAt = src.indexOf('installationsRead === "error"');
      // The *rendered* claim, not the `setConnectError` copy that uses the same
      // key on a failed connect action — matching the first occurrence would
      // compare against a line well above the failure branch and pass for the
      // wrong reason.
      const notConfiguredAt = src.lastIndexOf(
        't("repositories.githubNotConfigured")',
      );
      expect(errorAt).toBeGreaterThan(-1);
      expect(notConfiguredAt).toBeGreaterThan(errorAt);
    });

    it("gives the skill detail labels a failure that is not 'no labels'", () => {
      const src = code("app/(app)/[workspace]/more/skills/[id].tsx");
      expect(src).toContain("labelsRead");
      const gateAt = src.indexOf('labelsRead.state !== "ready"');
      const claimAt = src.indexOf('t("skills.detail.noLabels")');
      expect(gateAt).toBeGreaterThan(-1);
      expect(claimAt).toBeGreaterThan(gateAt);
    });

    it("never branches an agent-activity section on isLoading alone", () => {
      // `isLoading` is first-attempt-only, so a failure reported `false` and
      // fell into the empty branch.
      const src = code("components/agent/agent-activity-section.tsx");
      expect(src).not.toMatch(/agentTasks\.isLoading/);
      expect(src).toContain("unsettledCatalogStatus");
    });
  });
});
