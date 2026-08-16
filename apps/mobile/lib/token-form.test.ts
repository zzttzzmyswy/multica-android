import { describe, expect, it } from "vitest";
import {
  isTokenExpiryValue,
  tokenCreateRequest,
  TOKEN_EXPIRY_VALUES,
} from "./token-form";

describe("tokenCreateRequest", () => {
  it("maps a 90-day expiry to expires_in_days = 90", () => {
    expect(tokenCreateRequest("My CLI", "90")).toEqual({
      name: "My CLI",
      expires_in_days: 90,
    });
  });

  it("maps 30 / 365 the same way", () => {
    expect(tokenCreateRequest(" ci ", "30").expires_in_days).toBe(30);
    expect(tokenCreateRequest("ci", "365").expires_in_days).toBe(365);
  });

  it("omits expires_in_days for never (web parity — server then creates a non-expiring token)", () => {
    expect(tokenCreateRequest("ci", "never")).toEqual({ name: "ci" });
    expect("expires_in_days" in tokenCreateRequest("ci", "never")).toBe(false);
  });

  it("trims the token name", () => {
    expect(tokenCreateRequest("  My CLI  ", "90").name).toBe("My CLI");
  });
});

describe("isTokenExpiryValue", () => {
  it("accepts only the four known expiry values", () => {
    for (const v of TOKEN_EXPIRY_VALUES) {
      expect(isTokenExpiryValue(v)).toBe(true);
    }
    expect(isTokenExpiryValue("7")).toBe(false);
    expect(isTokenExpiryValue("")).toBe(false);
  });
});