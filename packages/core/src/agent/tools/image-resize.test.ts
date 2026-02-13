import { describe, it, expect } from "vitest";
import { wrapReadToolWithImageResize } from "./image-resize.js";

describe("image-resize", () => {
  function makeMockReadTool(content: any[]) {
    return {
      name: "read",
      description: "test",
      parameters: {} as any,
      execute: async () => ({ content }),
    };
  }

  it("should pass through non-image content unchanged", async () => {
    const tool = makeMockReadTool([
      { type: "text", text: "Hello world" },
    ]);
    const wrapped = wrapReadToolWithImageResize(tool as any);
    const result = await wrapped.execute({} as any) as any;
    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe("Hello world");
  });

  it("should pass through small images unchanged", async () => {
    const smallBase64 = Buffer.alloc(100, 0x41).toString("base64");
    const tool = makeMockReadTool([
      { type: "image", data: smallBase64 },
    ]);
    const wrapped = wrapReadToolWithImageResize(tool as any);
    const result = await wrapped.execute({} as any) as any;
    expect(result.content[0].data).toBe(smallBase64);
  });

  it("should pass through results without content arrays", async () => {
    const tool = {
      name: "read",
      description: "test",
      parameters: {} as any,
      execute: async () => ({ text: "plain" }),
    };
    const wrapped = wrapReadToolWithImageResize(tool as any);
    const result = await wrapped.execute({} as any) as any;
    expect(result.text).toBe("plain");
  });

  it("should handle execution errors gracefully", async () => {
    const tool = {
      name: "read",
      description: "test",
      parameters: {} as any,
      execute: async () => { throw new Error("file not found"); },
    };
    const wrapped = wrapReadToolWithImageResize(tool as any);
    await expect(wrapped.execute({} as any)).rejects.toThrow("file not found");
  });
});
