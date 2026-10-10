/**
 * Iteration 220 (MYS-2056): the scalar-property and filterable-type
 * predicates in the shared core layer.
 *
 * Why these live in core rather than in the mobile filter module: mobile kept
 * its own hardcoded filterable list (`select | multi_select | checkbox |
 * actor | multi_actor`) and silently dropped the four SCALAR types — text,
 * number, date and url had no filter row at all, while web's
 * `isFilterablePropertyType` offered all eight. Reading the shared predicate
 * is what keeps the two from drifting again; these assertions pin its
 * membership so a future edit cannot quietly narrow it back.
 *
 * `NO_PROPERTY_VALUE` is the "No value" sentinel. It is pinned here because
 * its exact spelling is a WIRE contract: the server's `noPropertyValue`
 * constant compiles it to a key-absence predicate, so a client that spelled it
 * differently would filter on a literal string instead of on absence.
 */
import { describe, expect, it } from "vitest";
import {
  NO_PROPERTY_VALUE,
  isFilterablePropertyType,
  isScalarPropertyType,
} from "./property";

describe("isScalarPropertyType", () => {
  it("accepts exactly text / number / date / url", () => {
    for (const type of ["text", "number", "date", "url"]) {
      expect(isScalarPropertyType(type)).toBe(true);
    }
  });

  it("rejects the non-scalar types", () => {
    for (const type of [
      "select",
      "multi_select",
      "checkbox",
      "actor",
      "multi_actor",
      "",
      "future_type",
    ]) {
      expect(isScalarPropertyType(type)).toBe(false);
    }
  });
});

describe("isFilterablePropertyType", () => {
  it("admits every type the filter menu offers, scalars included", () => {
    // The set web's filter menu offers. The four scalars are the ones mobile
    // used to drop.
    for (const type of [
      "select",
      "multi_select",
      "checkbox",
      "text",
      "number",
      "date",
      "url",
      "actor",
      "multi_actor",
    ]) {
      expect(isFilterablePropertyType(type)).toBe(true);
    }
  });

  it("does not become filterable by default", () => {
    // Deliberately an explicit enumeration rather than `isKnownPropertyType`:
    // a type a newer server adds must opt into filtering, because a type whose
    // values this build cannot read would otherwise render a filter row that
    // matches nothing.
    expect(isFilterablePropertyType("multi_text")).toBe(false);
    expect(isFilterablePropertyType("multi_url")).toBe(false);
    expect(isFilterablePropertyType("future_type")).toBe(false);
    expect(isFilterablePropertyType("")).toBe(false);
  });
});

describe("NO_PROPERTY_VALUE", () => {
  it("is the wire spelling the server's key-absence predicate reads", () => {
    // server/internal/handler/property.go: noPropertyValue = "__none__"
    expect(NO_PROPERTY_VALUE).toBe("__none__");
  });
});
