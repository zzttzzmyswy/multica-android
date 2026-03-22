export { ApiClient } from "./api-client";
export type { LoginResponse } from "./api-client";
export { WSClient } from "./ws-client";

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  [key: string]: unknown;
}
