import { describe, expect, it } from "vitest";
import type { Agent, MemberWithUser } from "@multica/core/types";
import { buildSubscriberPickerRows } from "./subscriber-picker";
import { isSubscribedActor } from "./subscription";

const member = (userId: string, name: string, email = `${userId}@x.com`): MemberWithUser =>
  ({ user_id: userId, name, email, role: "member" }) as MemberWithUser;

const agent = (id: string, name: string, description = ""): Agent =>
  ({ id, name, description }) as Agent;

const labels = { membersLabel: "Members", agentsLabel: "Agents" };

const build = (over: Partial<Parameters<typeof buildSubscriberPickerRows>[0]> = {}) =>
  buildSubscriberPickerRows({
    members: [],
    agents: [],
    query: "",
    ...labels,
    ...over,
  });

describe("buildSubscriberPickerRows", () => {
  it("lists every member and agent with a group header each", () => {
    const rows = build({
      members: [member("u1", "Ann")],
      agents: [agent("a1", "Mika")],
    });
    expect(rows.map((r) => r.key)).toEqual([
      "h:members",
      "m:u1",
      "h:agents",
      "a:a1",
    ]);
  });

  it("puts members before agents", () => {
    const rows = build({
      members: [member("u1", "Ann")],
      agents: [agent("a1", "Mika")],
    });
    expect(rows[0].kind).toBe("header");
    expect(rows[0]).toMatchObject({ label: "Members" });
    const agentHeader = rows.find((r) => r.key === "h:agents");
    expect(agentHeader).toMatchObject({ label: "Agents" });
  });

  it("dedupes members by user_id, keeping the first", () => {
    const rows = build({
      members: [member("u1", "Ann"), member("u1", "Ann (joined row)")],
    });
    const memberRows = rows.filter((r) => r.kind === "member");
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]).toMatchObject({ member: { name: "Ann" } });
  });

  it("suppresses an empty group's header rather than leaving it bare", () => {
    const rows = build({ agents: [agent("a1", "Mika")] });
    expect(rows.some((r) => r.key === "h:members")).toBe(false);
    expect(rows.map((r) => r.key)).toEqual(["h:agents", "a:a1"]);
  });

  it("returns nothing at all for an empty workspace", () => {
    expect(build()).toEqual([]);
  });

  it("treats an empty or whitespace query as match-everything", () => {
    const args = {
      members: [member("u1", "Ann")],
      agents: [agent("a1", "Mika")],
    };
    expect(build({ ...args, query: "" })).toHaveLength(4);
    expect(build({ ...args, query: "   " })).toHaveLength(4);
  });

  it("filters both groups by the query", () => {
    const rows = build({
      members: [member("u1", "Ann"), member("u2", "Bob")],
      agents: [agent("a1", "Mika"), agent("a2", "Nova")],
      query: "bo",
    });
    expect(rows.map((r) => r.key)).toEqual(["h:members", "m:u2"]);
  });

  it("matches members on email as well as name", () => {
    // Mobile widens web's name-only match to email, because the row shows a
    // name and an email is the other identifier a colleague is known by.
    const rows = build({
      members: [member("u1", "Ann", "ann@example.com")],
      query: "example",
    });
    expect(rows.map((r) => r.key)).toEqual(["h:members", "m:u1"]);
  });

  it("matches members and agents on pinyin", () => {
    const rows = build({
      members: [member("u1", "张伟")],
      agents: [agent("a1", "李雷")],
      query: "zhangwei",
    });
    expect(rows.map((r) => r.key)).toEqual(["h:members", "m:u1"]);
  });

  it("matches agents on description too", () => {
    const rows = build({
      agents: [agent("a1", "Mika", "triages incoming issues")],
      query: "triage",
    });
    expect(rows.map((r) => r.key)).toEqual(["h:agents", "a:a1"]);
  });

  it("yields no rows when nothing matches", () => {
    const rows = build({
      members: [member("u1", "Ann")],
      agents: [agent("a1", "Mika")],
      query: "zzzz",
    });
    expect(rows).toEqual([]);
  });
});

describe("isSubscribedActor", () => {
  const row = (userType: "member" | "agent", userId: string) =>
    ({ issue_id: "i1", user_type: userType, user_id: userId, reason: "manual", created_at: "x" }) as never;

  it("reads undefined (unresolved) as not subscribed", () => {
    // The picker must never act on this answer — callers gate on isSuccess
    // (MUL-5714). This asserts only that the read itself stays false, not
    // that acting on it is safe.
    expect(isSubscribedActor(undefined, "u1", "member")).toBe(false);
  });

  it("distinguishes types that share an id", () => {
    const list = [row("agent", "x1")];
    expect(isSubscribedActor(list, "x1", "agent")).toBe(true);
    expect(isSubscribedActor(list, "x1", "member")).toBe(false);
  });

  it("finds a subscribed member", () => {
    const list = [row("member", "u1"), row("agent", "a1")];
    expect(isSubscribedActor(list, "u1", "member")).toBe(true);
    expect(isSubscribedActor(list, "a1", "agent")).toBe(true);
    expect(isSubscribedActor(list, "u2", "member")).toBe(false);
  });
});
