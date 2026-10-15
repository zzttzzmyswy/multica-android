/**
 * Wiring guard for the runtime registration-failure surface (MYS-2175).
 *
 * `customRuntimeRegistrationFailure` was ported from web, is individually
 * correct, and has been unit-tested since it landed — and nothing called it.
 * That is the defect this iteration fixes, and a helper test cannot see it:
 * the helper was fine, it simply had no consumer. These assertions match on
 * the SURFACES (the two row components) instead.
 *
 * What the phone did with a failed registration: `daemon.go` records the
 * failure as an ordinary `status: "offline"` row carrying
 * `runtime_profile_registration_error` in metadata, and never sets
 * `pending_custom_runtime` (that flag is client-only, written by
 * `pendingRuntimeFromProfile`). So the row fell through to the derived-health
 * branch, where it read `recently_lost` — then `offline`, then `about_to_gc` —
 * i.e. "a runtime that is coming back", while the reason it never will stayed
 * invisible. Web shows a destructive alert plus "Registration error" and
 * prints the daemon's reason in its CLI column; the phone showed neither.
 *
 * Comments are stripped before matching, so a comment that quotes the banned
 * construct cannot satisfy or trip an assertion.
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

const LIST = "app/(app)/[workspace]/more/runtimes.tsx";
const MACHINE = "app/(app)/[workspace]/more/runtimes/machine/[machineId].tsx";

/** The body of one component: `name` up to the next top-level declaration. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end === -1 ? undefined : end);
}

function rowBody(source: string): string {
  return bodyOf(source, "RuntimeRow");
}

function machineRowBody(source: string): string {
  return bodyOf(source, "MachineRuntimeRow");
}

describe("the runtimes list row surfaces a registration failure", () => {
  it("binds the helper's answer to the row's own flag", () => {
    // The assignment itself, not merely a mention: a row that calls the helper
    // and throws the answer away (or pins it to null) still "consumes" it by a
    // substring test and still renders the pre-fix health branch.
    expect(code(LIST)).toMatch(
      /const registrationFailure = customRuntimeRegistrationFailure\(runtime\);/,
    );
  });

  it("keeps the failure branch ahead of the pending one", () => {
    // `pending` is false for a real failure row, so a failure branch nested
    // *inside* the pending one is dead code that still type-checks. Web's
    // HealthCell orders them disabled -> failure -> pending; match it.
    //
    // Scoped to the row body: the imports at the top of the file name both
    // helpers, so a file-wide indexOf compares the wrong pair.
    const row = rowBody(code(LIST));
    const glyphAt = row.indexOf('"alert-circle"');
    expect(glyphAt).toBeGreaterThan(-1); // the glyph lives inside the branch
    const failureCheckAt = row.lastIndexOf("registrationFailure ?", glyphAt);
    const pendingArmAt = row.indexOf("pending ? null");
    expect(failureCheckAt).toBeGreaterThan(-1);
    expect(pendingArmAt).toBeGreaterThan(-1);
    expect(failureCheckAt).toBeLessThan(pendingArmAt);
  });

  it("renders the destructive label rather than a health state", () => {
    const source = code(LIST);
    expect(source).toContain('t("runtimes.list.pending_health_error")');
    expect(source).toMatch(/registrationFailure[\s\S]{0,400}text-destructive/);
  });

  it("swaps the health dot for an alert glyph", () => {
    // The dot is tinted by derived health; leaving it in place beside a
    // destructive caption is the mixed signal web avoids by dropping it. The
    // glyph must sit in the *taken* arm of the failure test — a `false ?`
    // branch compiles, renders the dot, and passes any "contains" check.
    const row = rowBody(code(LIST));
    expect(row).toMatch(
      /registrationFailure \? \(\s*<Ionicons name="alert-circle"/,
    );
    // ...and the dot must be reachable only when that test did not fire.
    expect(row).toMatch(/\) : pending \? null : \(/);
  });

  it("prints the daemon's reason, not just the label", () => {
    // Web hides the reason behind a `title` tooltip. A phone has no hover, so
    // the reason has to be on the row and in the accessibility label.
    const row = rowBody(code(LIST));
    expect(row).toMatch(/registrationFailure\s*\?\s*` · \$\{registrationFailure\}`/);
    expect(row).toMatch(
      /accessibilityLabel=\{\s*registrationFailure\s*\?\s*`\$\{t\("runtimes\.list\.pending_health_error"\)\} · \$\{registrationFailure\}`/,
    );
  });

  it("still labels a runtime that is merely waiting", () => {
    // The failure branch must not swallow the pending copy: a placeholder that
    // has not failed keeps saying it is registering, on the arm the failure
    // test does not take.
    const row = rowBody(code(LIST));
    expect(row).toMatch(/t\("runtimes\.list\.pending_health"\)/);
    const body = row.slice(row.indexOf("            >\n"));
    const failureAt = body.indexOf('t("runtimes.list.pending_health_error")');
    const pendingAt = body.indexOf('t("runtimes.list.pending_health")');
    expect(failureAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeGreaterThan(-1);
    expect(failureAt).toBeLessThan(pendingAt);
  });
});

describe("the machine detail row surfaces it too", () => {
  // Web's CliCell prints the command plus the reason; the machine page's row
  // is this surface's counterpart, and a failure there is the same event.
  it("binds the helper's answer to the row's own flag", () => {
    expect(code(MACHINE)).toMatch(
      /const registrationFailure = customRuntimeRegistrationFailure\(runtime\);/,
    );
  });

  it("puts the error label and reason on the health line", () => {
    const row = machineRowBody(code(MACHINE));
    // The line is built from the failure branch, not merely mentioned near it.
    expect(row).toMatch(/const healthLine = registrationFailure\s*\?/);
    expect(row).toMatch(/t\("runtimes\.list\.pending_health_error"\)/);
    // The daemon's reason and the profile's command both make the line, as
    // web's CliCell does; a line carrying only the label hides the cause.
    expect(row).toMatch(/failedCommand/);
    expect(row).toMatch(/registrationFailure,\n\s*\]/);
  });

  it("swaps that row's health dot for the alert glyph", () => {
    const row = machineRowBody(code(MACHINE));
    expect(row).toMatch(
      /registrationFailure \? \(\s*<Ionicons\s+name="alert-circle"/,
    );
  });

  it("reaches the reason through the accessibility label", () => {
    const row = machineRowBody(code(MACHINE));
    expect(row).toMatch(
      /accessibilityLabel=\{\s*registrationFailure\s*\?\s*`\$\{t\("runtimes\.list\.pending_health_error"\)\} · \$\{registrationFailure\}`/,
    );
  });
});

describe("the two locales carry the key upstream uses", () => {
  it("resolves pending_health_error in en and zh", () => {
    const en = JSON.parse(
      readFileSync(path.join(APP_ROOT, "lib/i18n/locales/en.json"), "utf8"),
    ) as Record<string, string>;
    const zh = JSON.parse(
      readFileSync(path.join(APP_ROOT, "lib/i18n/locales/zh.json"), "utf8"),
    ) as Record<string, string>;
    // Verbatim upstream (`packages/views/locales/{en,zh-Hans}/runtimes.json`),
    // so the two clients say the same thing.
    expect(en["runtimes.list.pending_health_error"]).toBe("Registration error");
    expect(zh["runtimes.list.pending_health_error"]).toBe("注册错误");
  });
});
