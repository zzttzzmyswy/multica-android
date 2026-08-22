import { describe, it, expect } from "vitest";
import type { MemberWithUser } from "@multica/core/types";
import {
  filterMemberMatches,
  matchesMember,
  memberInitials,
  wantsAllMembers,
} from "./member-search";

function member(
  partial: Partial<MemberWithUser> & { id: string; name: string },
): MemberWithUser {
  const base: MemberWithUser = {
    id: partial.id,
    workspace_id: "ws-1",
    user_id: `user-${partial.id}`,
    role: "member",
    created_at: "2026-01-01T00:00:00Z",
    name: partial.name,
    email: `${partial.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    avatar_url: null,
  };
  return { ...base, ...partial };
}

const members: MemberWithUser[] = [
  member({ id: "a", name: "Alice Zhang", email: "alice@example.com" }),
  member({ id: "b", name: "李云龙", role: "admin" }),
  member({ id: "c", name: "Bob Li", email: "bob.li@multica.ai" }),
  member({ id: "d", name: "王大锤", role: "owner" }),
];

describe("memberInitials", () => {
  it("takes first letters of space-separated words, upper, 2 chars", () => {
    expect(memberInitials("Alice Zhang")).toBe("AZ");
  });

  it("handles single-word names", () => {
    expect(memberInitials("李云龙")).toBe("李");
  });

  it("caps at 2 characters", () => {
    expect(memberInitials("John Jacob Jingleheimer")).toBe("JJ");
  });
});

describe("wantsAllMembers", () => {
  it("matches members/people/users/team prefixes (≥3 chars)", () => {
    for (const prefix of ["members", "people", "users", "team", "mem", "peo"]) {
      expect(wantsAllMembers(prefix)).toBe(true);
    }
  });

  it("does not match short queries or non-prefix queries", () => {
    expect(wantsAllMembers("me")).toBe(false);
    expect(wantsAllMembers("memx")).toBe(false);
    expect(wantsAllMembers("alice")).toBe(false);
    expect(wantsAllMembers("")).toBe(false);
  });
});

describe("matchesMember", () => {
  it("matches by name (case-insensitive)", () => {
    expect(matchesMember(members[0]!, "alice")).toBe(true);
    expect(matchesMember(members[0]!, "ALICE")).toBe(true);
  });

  it("matches by email", () => {
    expect(matchesMember(members[2]!, "bob.li")).toBe(true);
    expect(matchesMember(members[2]!, "multica.ai")).toBe(true);
  });

  it("matches role prefix (≥3 chars)", () => {
    expect(matchesMember(members[1]!, "adm")).toBe(true);
    expect(matchesMember(members[1]!, "ad")).toBe(false);
  });

  it("matches chinese names via full pinyin", () => {
    expect(matchesMember(members[1]!, "liyunlong")).toBe(true);
  });

  it("matches chinese names via pinyin initials", () => {
    expect(matchesMember(members[1]!, "lyl")).toBe(true);
  });

  it("does not match unrelated query", () => {
    expect(matchesMember(members[0]!, "zhangsan")).toBe(false);
  });

  it("returns false for empty query", () => {
    // matchesMember never fires on empty; filterMemberMatches guards it too.
    expect(matchesMember(members[0]!, "")).toBe(false);
  });
});

describe("filterMemberMatches", () => {
  it("returns members matching name/email/pinyin", () => {
    expect(filterMemberMatches(members, "alice").map((m) => m.name)).toEqual([
      "Alice Zhang",
    ]);
    expect(filterMemberMatches(members, "lyl").map((m) => m.name)).toEqual([
      "李云龙",
    ]);
  });

  it("lists all members for want-all prefixes", () => {
    const all = filterMemberMatches(members, "members");
    expect(all).toHaveLength(members.length);
  });

  it("caps at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      member({ id: `m${i}`, name: `User ${i}` }),
    );
    expect(filterMemberMatches(many, "members")).toHaveLength(10);
  });

  it("returns [] for empty query", () => {
    expect(filterMemberMatches(members, "")).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    expect(filterMemberMatches(members, "zzzz")).toEqual([]);
  });

  it("returns [] when there are no members (e.g. no logged-in workspace)", () => {
    expect(filterMemberMatches([], "members")).toEqual([]);
    expect(filterMemberMatches([], "alice")).toEqual([]);
  });
});