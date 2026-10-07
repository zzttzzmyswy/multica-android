import { describe, expect, it } from "vitest";
import { formatBytes } from "./format-bytes";

/**
 * The size string a file shows beside its name.
 *
 * Pinned to web's three branches exactly
 * (`packages/views/common/format-bytes.ts`): a byte count below a kilobyte
 * stays in bytes with no decimal, kilobytes round to a whole number, and
 * megabytes keep one decimal. Two clients rendering the same attachment must
 * not disagree about how big it is, and the rounding is where they would.
 */
describe("formatBytes", () => {
  it("keeps sub-kilobyte sizes in bytes, unrounded", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("rounds kilobytes to a whole number", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(6 * 1024)).toBe("6 KB");
    // 412.4 KB — web rounds rather than truncating.
    expect(formatBytes(412 * 1024 + 410)).toBe("412 KB");
  });

  it("keeps one decimal for megabytes", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
  });
});
