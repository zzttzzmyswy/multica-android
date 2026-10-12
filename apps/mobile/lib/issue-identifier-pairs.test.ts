import { describe, expect, it } from "vitest";
import {
  deserializeResolvedPairs,
  serializeResolvedPairs,
  toResolvedMap,
} from "./issue-identifier-pairs";

const A = "01a12e65-9ed5-7e40-a2f1-363fdea817bc";
const B = "01a12d8c-97ca-7150-a93d-ee7f9c421a70";

/** The pair step is where "linkable" is decided: only an identifier with a
 *  resolved issue may be rewritten, everything else must fall out so the
 *  author's text is rendered verbatim. */
describe("serializeResolvedPairs", () => {
  it("pairs each identifier with its resolved issue id", () => {
    const key = serializeResolvedPairs(["MYS-1", "MYS-2"], [{ id: A }, { id: B }]);
    expect(deserializeResolvedPairs(key)).toEqual([
      ["MYS-1", A],
      ["MYS-2", B],
    ]);
  });

  it("drops identifiers that did not resolve — they must stay plain text", () => {
    const key = serializeResolvedPairs(
      ["MYS-1", "MYS-99999", "MYS-2"],
      [{ id: A }, null, { id: B }],
    );
    expect(deserializeResolvedPairs(key)).toEqual([
      ["MYS-1", A],
      ["MYS-2", B],
    ]);
  });

  it("treats an unresolved query in flight (undefined) as not resolved", () => {
    // While the lookup is pending the caller passes `null`; the identifier must
    // NOT be linkable yet, or a slow/absent issue would briefly become a link.
    expect(
      deserializeResolvedPairs(serializeResolvedPairs(["MYS-1"], [null])),
    ).toEqual([]);
  });

  it("keeps the identifier as the KEY (the link's visible label)", () => {
    const [pair] = deserializeResolvedPairs(
      serializeResolvedPairs(["MYS-2109"], [{ id: A }]),
    );
    expect(pair![0]).toBe("MYS-2109");
    // And the value is the UUID, never the identifier — the link target must be
    // the UUID or realtime/cache keys break.
    expect(pair![1]).toBe(A);
    expect(pair![1]).not.toBe("MYS-2109");
  });

  it("is stable across equal inputs — the memo depends on this string", () => {
    // The caller memoizes preprocess on this serialization; two calls with the
    // same resolutions must produce the same string or the memo never bails out
    // and preprocess re-runs on every render.
    const one = serializeResolvedPairs(["MYS-1"], [{ id: A }]);
    const two = serializeResolvedPairs(["MYS-1"], [{ id: A }]);
    expect(one).toBe(two);
  });

  it("changes when a resolution changes", () => {
    const before = serializeResolvedPairs(["MYS-1"], [null]);
    const after = serializeResolvedPairs(["MYS-1"], [{ id: A }]);
    expect(before).not.toBe(after);
  });

  it("handles an empty candidate list", () => {
    expect(deserializeResolvedPairs(serializeResolvedPairs([], []))).toEqual([]);
  });

  it("toResolvedMap yields exactly the confirmed identifiers", () => {
    const map = toResolvedMap(
      serializeResolvedPairs(["MYS-1", "MYS-99999"], [{ id: A }, null]),
    );
    expect([...map.keys()]).toEqual(["MYS-1"]);
    expect(map.get("MYS-1")).toBe(A);
    expect(map.has("MYS-99999")).toBe(false);
  });
});
