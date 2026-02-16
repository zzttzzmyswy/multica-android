import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "@multica/utils";

export interface AgentRecord {
  id: string;
  createdAt: number;
  profileId?: string;
}

export interface ConversationRecord {
  id: string;
  agentId: string;
  createdAt: number;
  profileId?: string;
}

export interface HubStoreSnapshot {
  version: 2;
  agents: AgentRecord[];
  conversations: ConversationRecord[];
}

const AGENTS_DIR = join(DATA_DIR, "agents");
const AGENTS_FILE = join(AGENTS_DIR, "agents.json");
const warnedLegacyApis = new Set<string>();

function warnLegacyApi(apiName: string): void {
  if (warnedLegacyApis.has(apiName)) return;
  warnedLegacyApis.add(apiName);
  console.warn(
    `[agent-store] Deprecated legacy API "${apiName}" was used. ` +
    "Migrate callers to conversation-first APIs (loadHubStoreSnapshot/upsertConversationRecord).",
  );
}

function ensureDir(): void {
  if (!existsSync(AGENTS_DIR)) {
    mkdirSync(AGENTS_DIR, { recursive: true });
  }
}

function defaultSnapshot(): HubStoreSnapshot {
  return {
    version: 2,
    agents: [],
    conversations: [],
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeCreatedAt(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  return Date.now();
}

function normalizeAgentRecords(input: unknown): AgentRecord[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Map<string, AgentRecord>();
  for (const item of input) {
    if (!isRecordLike(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    const id = item.id.trim();
    if (dedup.has(id)) continue;
    dedup.set(id, {
      id,
      createdAt: normalizeCreatedAt(item.createdAt),
      ...(typeof item.profileId === "string" && item.profileId.trim() ? { profileId: item.profileId.trim() } : {}),
    });
  }
  return Array.from(dedup.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function normalizeConversationRecords(input: unknown): ConversationRecord[] {
  if (!Array.isArray(input)) return [];
  const dedup = new Map<string, ConversationRecord>();
  for (const item of input) {
    if (!isRecordLike(item) || typeof item.id !== "string" || !item.id.trim()) continue;
    if (typeof item.agentId !== "string" || !item.agentId.trim()) continue;
    const id = item.id.trim();
    if (dedup.has(id)) continue;
    dedup.set(id, {
      id,
      agentId: item.agentId.trim(),
      createdAt: normalizeCreatedAt(item.createdAt),
      ...(typeof item.profileId === "string" && item.profileId.trim() ? { profileId: item.profileId.trim() } : {}),
    });
  }
  return Array.from(dedup.values()).sort((a, b) => a.createdAt - b.createdAt);
}

function normalizeSnapshot(raw: unknown): { snapshot: HubStoreSnapshot; migrated: boolean } {
  // Legacy format: AgentRecord[]
  if (Array.isArray(raw)) {
    const legacyAgents = normalizeAgentRecords(raw);
    const conversations: ConversationRecord[] = legacyAgents.map((record) => ({
      id: record.id,
      agentId: record.id,
      createdAt: record.createdAt,
      ...(record.profileId ? { profileId: record.profileId } : {}),
    }));
    return {
      snapshot: {
        version: 2,
        agents: legacyAgents,
        conversations,
      },
      migrated: true,
    };
  }

  if (!isRecordLike(raw)) {
    return { snapshot: defaultSnapshot(), migrated: false };
  }

  const agents = normalizeAgentRecords(raw.agents);
  const conversations = normalizeConversationRecords(raw.conversations);
  const agentMap = new Map<string, AgentRecord>(agents.map((agent) => [agent.id, agent]));
  const normalizedConversations: ConversationRecord[] = [];

  for (const conversation of conversations) {
    if (!agentMap.has(conversation.agentId)) {
      agentMap.set(conversation.agentId, {
        id: conversation.agentId,
        createdAt: conversation.createdAt,
        ...(conversation.profileId ? { profileId: conversation.profileId } : {}),
      });
    }
    normalizedConversations.push(conversation);
  }

  // Ensure each agent has a main conversation for compatibility fallback.
  for (const agent of agentMap.values()) {
    const hasConversation = normalizedConversations.some((conversation) => conversation.agentId === agent.id);
    if (hasConversation) continue;
    normalizedConversations.push({
      id: agent.id,
      agentId: agent.id,
      createdAt: agent.createdAt,
      ...(agent.profileId ? { profileId: agent.profileId } : {}),
    });
  }

  return {
    snapshot: {
      version: 2,
      agents: Array.from(agentMap.values()).sort((a, b) => a.createdAt - b.createdAt),
      conversations: normalizedConversations.sort((a, b) => a.createdAt - b.createdAt),
    },
    migrated: (raw.version as unknown) !== 2,
  };
}

export function saveHubStoreSnapshot(snapshot: HubStoreSnapshot): void {
  ensureDir();
  writeFileSync(AGENTS_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
}

export function loadHubStoreSnapshot(): HubStoreSnapshot {
  if (!existsSync(AGENTS_FILE)) return defaultSnapshot();
  try {
    const content = readFileSync(AGENTS_FILE, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    const normalized = normalizeSnapshot(parsed);
    if (normalized.migrated) {
      saveHubStoreSnapshot(normalized.snapshot);
    }
    return normalized.snapshot;
  } catch {
    return defaultSnapshot();
  }
}

export function upsertAgentRecord(record: AgentRecord): void {
  const snapshot = loadHubStoreSnapshot();
  const existing = snapshot.agents.filter((item) => item.id !== record.id);
  existing.push(record);
  snapshot.agents = existing.sort((a, b) => a.createdAt - b.createdAt);
  saveHubStoreSnapshot(snapshot);
}

export function removeAgentRecordById(agentId: string): void {
  const snapshot = loadHubStoreSnapshot();
  const agents = snapshot.agents.filter((agent) => agent.id !== agentId);
  const conversations = snapshot.conversations.filter((conversation) => conversation.agentId !== agentId);
  if (agents.length === snapshot.agents.length && conversations.length === snapshot.conversations.length) {
    return;
  }
  saveHubStoreSnapshot({
    ...snapshot,
    agents,
    conversations,
  });
}

export function upsertConversationRecord(record: ConversationRecord): void {
  const snapshot = loadHubStoreSnapshot();
  const conversations = snapshot.conversations.filter((item) => item.id !== record.id);
  conversations.push(record);

  const hasAgent = snapshot.agents.some((agent) => agent.id === record.agentId);
  const agents = hasAgent
    ? snapshot.agents
    : [
      ...snapshot.agents,
      {
        id: record.agentId,
        createdAt: record.createdAt,
        ...(record.profileId ? { profileId: record.profileId } : {}),
      },
    ];

  saveHubStoreSnapshot({
    version: 2,
    agents: agents.sort((a, b) => a.createdAt - b.createdAt),
    conversations: conversations.sort((a, b) => a.createdAt - b.createdAt),
  });
}

export function removeConversationRecordById(conversationId: string): void {
  const snapshot = loadHubStoreSnapshot();
  const conversations = snapshot.conversations.filter((conversation) => conversation.id !== conversationId);
  if (conversations.length === snapshot.conversations.length) {
    return;
  }

  const activeAgentIds = new Set(conversations.map((conversation) => conversation.agentId));
  const agents = snapshot.agents.filter((agent) => activeAgentIds.has(agent.id));
  saveHubStoreSnapshot({
    ...snapshot,
    agents,
    conversations,
  });
}

// Legacy compatibility wrappers
// NOTE: In legacy mode, each agent record is treated as both agent and main conversation.
export function loadAgentRecords(): AgentRecord[] {
  warnLegacyApi("loadAgentRecords");
  return loadHubStoreSnapshot().agents;
}

export function saveAgentRecords(records: AgentRecord[]): void {
  warnLegacyApi("saveAgentRecords");
  const agents = normalizeAgentRecords(records);
  const conversations = agents.map((record) => ({
    id: record.id,
    agentId: record.id,
    createdAt: record.createdAt,
    ...(record.profileId ? { profileId: record.profileId } : {}),
  }));
  saveHubStoreSnapshot({
    version: 2,
    agents,
    conversations,
  });
}

export function addAgentRecord(record: AgentRecord): void {
  warnLegacyApi("addAgentRecord");
  upsertAgentRecord(record);
  upsertConversationRecord({
    id: record.id,
    agentId: record.id,
    createdAt: record.createdAt,
    ...(record.profileId ? { profileId: record.profileId } : {}),
  });
}

export function removeAgentRecord(id: string): void {
  warnLegacyApi("removeAgentRecord");
  // Legacy API accepts either agent id or conversation id.
  const snapshot = loadHubStoreSnapshot();
  const conversation = snapshot.conversations.find((item) => item.id === id);
  if (conversation) {
    removeConversationRecordById(conversation.id);
  }
  removeAgentRecordById(id);
}
