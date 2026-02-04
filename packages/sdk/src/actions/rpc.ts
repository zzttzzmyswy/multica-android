/** RPC Actions - 请求/响应模式 */

export const RequestAction = "request" as const;
export const ResponseAction = "response" as const;

/** 请求帧 payload */
export interface RequestPayload<T = unknown> {
  /** 请求 ID，由客户端生成，服务端原样回传到 ResponsePayload.requestId */
  requestId: string;
  /** 调用的方法名 */
  method: string;
  /** 方法参数 */
  params?: T;
}

/** 响应帧 payload - 成功 */
export interface ResponseSuccessPayload<T = unknown> {
  /** 与请求消息 ID 匹配 */
  requestId: string;
  /** 是否成功 */
  ok: true;
  /** 返回数据 */
  payload: T;
}

/** 响应帧 payload - 失败 */
export interface ResponseErrorPayload {
  /** 与请求消息 ID 匹配 */
  requestId: string;
  /** 是否成功 */
  ok: false;
  /** 错误信息 */
  error: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

/** 响应帧 payload（联合类型） */
export type ResponsePayload<T = unknown> =
  | ResponseSuccessPayload<T>
  | ResponseErrorPayload;

/** 类型守卫：判断响应是否成功 */
export function isResponseSuccess<T>(
  response: ResponsePayload<T>
): response is ResponseSuccessPayload<T> {
  return response.ok === true;
}

/** 类型守卫：判断响应是否失败 */
export function isResponseError(
  response: ResponsePayload
): response is ResponseErrorPayload {
  return response.ok === false;
}

// ============ RPC Method Types ============

/** getAgentMessages - request params */
export interface GetAgentMessagesParams {
  agentId: string;
  offset?: number;
  limit?: number;
}

/** Content block types from the agent engine */
export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
}

export interface ToolCallBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ImageContentBlock {
  type: "image";
  url: string;
}

/** Agent message returned by getAgentMessages (mirrors pi-ai Message) */
export type AgentMessageItem =
  | { role: "user"; content: string | (TextContentBlock | ImageContentBlock)[]; timestamp: number }
  | { role: "assistant"; content: (TextContentBlock | ThinkingContentBlock | ToolCallBlock)[]; timestamp: number }
  | { role: "tool_result"; toolCallId: string; content: (TextContentBlock | ImageContentBlock)[]; isError: boolean; timestamp: number }

/** getAgentMessages - response payload */
export interface GetAgentMessagesResult {
  messages: AgentMessageItem[];
  total: number;
  offset: number;
  limit: number;
}

/** getHubInfo - no params needed */
export interface GetHubInfoResult {
  hubId: string;
  url: string;
  connectionState: string;
  agentCount: number;
}

/** listAgents - no params needed */
export interface ListAgentsResult {
  agents: { id: string; closed: boolean }[];
}

/** createAgent - request params */
export interface CreateAgentParams {
  id?: string;
}

/** createAgent - response payload */
export interface CreateAgentResult {
  id: string;
}

/** deleteAgent - request params */
export interface DeleteAgentParams {
  id: string;
}

/** deleteAgent - response payload */
export interface DeleteAgentResult {
  ok: boolean;
}

/** updateGateway - request params */
export interface UpdateGatewayParams {
  url: string;
}

/** updateGateway - response payload */
export interface UpdateGatewayResult {
  url: string;
  connectionState: string;
}

/** verify - request params */
export interface VerifyParams {
  token?: string;
}

/** verify - response payload */
export interface VerifyResult {
  hubId: string;
  agentId: string;
}
