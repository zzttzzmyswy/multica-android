import { describe, it, expect } from "vitest";
import { MAX_FILE_SIZE } from "../upload";

describe("upload constants", () => {
  it("exports MAX_FILE_SIZE as 100MB", () => {
    expect(MAX_FILE_SIZE).toBe(100 * 1024 * 1024);
  });
});
