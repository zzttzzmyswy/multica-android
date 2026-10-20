/**
 * Wiring guards for iteration 263 (MYS-2273).
 *
 * All three gaps this round closes are CALL-SITE relationships, not pure
 * functions — an option search box whose query never reaches the list, a
 * shortcut whose label is computed but never rendered, a routing screen that
 * exists but has no entry point. Iteration 261's stage bug was exactly this
 * shape (a tested `reset()` with no caller), and a routing route with no menu
 * entry would be the same defect one layer up.
 *
 * Every assertion is anchored to a statement or an exact expression, never to
 * a bare token: a token match survives the line being replaced by a constant
 * whenever a nearby comment happens to use the same word.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string =>
  readFileSync(resolve(here, "..", rel), "utf8");

const W = "app/(app)/[workspace]";

describe("iteration 263 wiring", () => {
  describe("#1 the OpenClaw routing screen is reachable and gated", () => {
    const detail = src(`${W}/more/agents/[id].tsx`);
    const actions = src("components/agent/agent-detail-actions.tsx");
    const layout = src(`${W}/_layout.tsx`);
    const route = src(`${W}/more/agents/[id]/routing.tsx`);

    it("registers the route so the push target exists", () => {
      // A `router.push` to a screen the layout never registered lands on the
      // router's not-found face on device while the menu entry still looks
      // fine — invisible in every unit test that only checks the push string.
      expect(layout).toMatch(/name="more\/agents\/\[id\]\/routing"/);
      expect(layout).toMatch(/title: t\("agents\.routing\.title"\)/);
    });

    it("pushes the route the layout registered", () => {
      expect(actions).toMatch(/nav\("routing"\)/);
      expect(actions).toMatch(
        /|edit|env|custom-args|routing|integrations|/,
      );
      expect(actions).toMatch(/\/more\/agents\/\$\{agent\.id\}\/\$\{route\}/);
    });

    it("offers the entry only for an agent whose runtime is openclaw", () => {
      // `showRouting` is the caller's RESOLVED answer, not the raw runtime:
      // passing `runtime?.provider === "openclaw"` down would render a loading
      // read as "not an OpenClaw agent" (see lib/openclaw-routing-availability).
      expect(actions).toMatch(/if \(showRouting\) push\(/);
      expect(detail).toMatch(
        /state === "shown"/,
      );
      expect(detail).toMatch(/showRouting=\{showRouting\}/);
    });

    it("resolves availability from the runtime read's own state", () => {
      // `runtimes.isSuccess` / `isError`, not `!runtimes.isLoading`: the latter
      // is also false for a FAILED first attempt, which would resolve to
      // "hidden" and withdraw a surface the user is entitled to.
      expect(detail).toMatch(/runtimesSettled: runtimes\.isSuccess/);
      expect(detail).toMatch(/runtimesFailed: runtimes\.isError/);
    });

    it("uses the core serializers rather than a local copy of the wire shape", () => {
      // A second implementation drifts from the daemon's Go decoder on the
      // first field rename (`server/internal/daemon/openclaw_runtime_config.go`).
      expect(route).toMatch(/from "@multica\/core\/agents"/);
      expect(route).toMatch(/parseOpenclawRuntimeConfig\(agent\?\.runtime_config\)/);
      expect(route).toMatch(/routingFormToConfig\(form\)/);
      expect(route).not.toMatch(/function parseOpenclawRuntimeConfig/);
    });

    it("submits through the core serializer, not the raw form state", () => {
      // `PUT /api/agents/{id}` replaces `runtime_config` wholesale. Posting the
      // form's string port would write `"18789"` where the daemon expects a
      // number, and posting `tokenWasMasked` would leak a UI flag onto the wire.
      // Core is also the side that collapses an empty gateway block and emits
      // only `tls: true`, so a manual `cfg` post drifts on partial pins.
      expect(route).toMatch(
        /runtime_config: serializeOpenclawRuntimeConfig\(cfg\)/,
      );
      expect(route).not.toMatch(/runtime_config: form\b/);
      expect(route).not.toMatch(/runtime_config: cfg as Record<string, unknown>/);
    });

    it("reseeds from the server's response, not from the local draft", () => {
      // The server substitutes the mask sentinel for the token it just stored.
      // Reseeding from the local value leaves the field showing a token the
      // server has already replaced, so the next save replays a secret the
      // user rotated away.
      expect(route).toMatch(
        /setState\(routingConfigToForm\(parseOpenclawRuntimeConfig\(resp\.runtime_config\)\)\)/,
      );
      expect(route).toMatch(/const resp = await saveAgent\.mutateAsync/);
    });

    it("gates save on a settled read of the agent row", () => {
      expect(route).toMatch(/readSettled: read\.isResolved/);
      expect(route).toMatch(/if \(!agent \|\| !read\.isResolved\) return;/);
    });

    it("drops the masked-replay flag when the mode switches", () => {
      // gateway → local → gateway otherwise re-arms the sentinel replay and
      // silently restores a token the user meant to drop (web
      // runtime-config-tab.tsx:177-190).
      expect(route).toMatch(/patch\(\{ mode, tokenWasMasked: false \}\)/);
    });

    it("clears the flag on a token keystroke", () => {
      expect(route).toMatch(/patch\(\{ token, tokenWasMasked: false \}\)/);
    });

    it("disables the TLS switch outside gateway mode", () => {
      // The dimmed container does not deactivate a press target, so the switch
      // needs its own gate or it stays live in Local mode.
      expect(route).toMatch(/disabled=\{!gatewayEnabled \|\| saveAgent\.isPending\}/);
    });
  });

  describe("#2 select / multi_select gain an option search", () => {
    const body = src("components/issue/pickers/property-value-body.tsx");

    it("renders a search field", () => {
      expect(body).toMatch(/t\("properties\.optionSearchPlaceholder"\)/);
      expect(body).toMatch(/<TextField/);
    });

    it("feeds the query into the list it renders", () => {
      // The plausible half-port: render the box, compute the match, and pass
      // the ORIGINAL options to the FlatList anyway. Typing then does nothing
      // while the UI claims it filters.
      expect(body).toMatch(
        /const matched = filterPropertyOptions\(propertyOptions\(property\), optionQuery\)/,
      );
      expect(body).toMatch(/data=\{matched\}/);
    });

    it("only grows the field past the threshold", () => {
      expect(body).toMatch(/shouldSearchPropertyOptions\(property\)/);
      expect(body).toMatch(/\{searchable \? \(/);
    });

    it("reports the empty result instead of a blank sheet", () => {
      // A blank list reads as "this property has no options" — a false
      // statement about the definition, not about the query.
      expect(body).toMatch(/hasNoPropertyOptionMatch\(matched\.length\)/);
      expect(body).toMatch(/t\("properties\.optionSearchEmpty"\)/);
    });

    it("keeps taps working while the keyboard is up", () => {
      // Without this a tap on an option only dismisses the keyboard, so the
      // search field makes the picker require two taps per option.
      expect(body).toMatch(/keyboardShouldPersistTaps="handled"/);
    });

    it("keeps the search out of the committed value", () => {
      // The query narrows what is visible; it is not part of the value. A build
      // that reported it through `onDraftChange` would make a text-ish host
      // commit the query string as the property's value.
      expect(body).not.toMatch(/onDraftChange\?\.\(optionQuery\)/);
    });
  });

  describe("#3 the chip bar gains a save-view shortcut", () => {
    const chrome = src("components/issue/issue-surface-chrome.tsx");
    const bar = src("components/issue/issue-view-bar.tsx");
    const issues = src(`${W}/more/issues.tsx`);
    const myIssues = src(`${W}/(tabs)/my-issues.tsx`);
    const project = src("components/project/project-issue-surface.tsx");
    const hint = src("lib/use-chip-save-hint.ts");

    it("renders the control beside Clear", () => {
      expect(chrome).toMatch(/\{onSave \? \(/);
      expect(chrome).toMatch(/onPress=\{onSave\}/);
    });

    it("labels it through the three-way rule, not a hardcoded word", () => {
      expect(hint).toMatch(/chipSaveAction\(\{ activeView, canManage \}\)/);
      expect(hint).toMatch(/t\("issueViews\.chipEdit"\)/);
      expect(hint).toMatch(/t\("issueViews\.chipSaveAs"\)/);
      expect(chrome).toMatch(/saveLabel \?\? translate\("issueViews\.saveView"\)/);
    });

    it("wires all three surfaces, not just the workspace Issues page", () => {
      // The chip bar is shared; wiring one host leaves the other two with a
      // control that never appears.
      for (const surface of [issues, myIssues, project]) {
        expect(surface).toMatch(/onSave=\{chipSave\.visible \? chipSave\.onPress : undefined\}/);
        expect(surface).toMatch(/saveLabel=\{chipSave\.visible \? chipSave\.label : undefined\}/);
      }
    });

    it("passes each surface's OWN view scope to the hint", () => {
      // A copy-pasted `issueScope` in my-issues would label the button from
      // another container's open view and open that container's dialog.
      expect(issues).toMatch(/useChipSaveHint\(issueScope\)/);
      expect(myIssues).toMatch(/useChipSaveHint\(myScope\)/);
      expect(project).toMatch(/useChipSaveHint\(projectScope\)/);
    });

    it("consumes the request in the bar that owns the dialog", () => {
      // The chip bar raises a token; without a consumer the shortcut is inert.
      expect(bar).toMatch(/useSaveViewRequestStore\(/);
      expect(bar).toMatch(/saveRequestToken === consumedSaveToken\.current/);
      expect(bar).toMatch(/openSaveDialog\(\)/);
    });

    it("opens EDIT for an owned view and CREATE otherwise", () => {
      // Opening `create` unconditionally — the obvious wiring — files a
      // near-duplicate every time a view owner tries to keep an edit.
      expect(bar).toMatch(
        /if \(activeView && canManage\(activeView\)\) \{\s*setDialog\(\{ mode: "edit", view: activeView \}\)/,
      );
      expect(bar).toMatch(/setDialog\(\{ mode: "create" \}\)/);
    });

    it("resolves the open view against the list this bar read", () => {
      // A stale id (deleted on another device) must resolve to null, which is
      // the same "no view open" the rest of the bar acts on.
      expect(bar).toMatch(
        /views\.find\(\(v\) => v\.id === activeViewIdInStore\) \?\? null/,
      );
    });

    it("ignores the initial token so mount does not open the dialog", () => {
      // `useRef(saveRequestToken)` seeds the consumed value. Without it the
      // first render sees 0 !== 0 as false — but a build that seeded with 0
      // and consumed 0 would fire on every mount that already had a token.
      expect(bar).toMatch(/const consumedSaveToken = useRef\(saveRequestToken\)/);
    });
  });
});
