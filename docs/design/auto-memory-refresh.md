# Auto Memory Refresh 实现方案

## 概述

在上下文压缩（compaction）发生之前，自动触发一个特殊的 agent turn，让 agent 分析即将被删除的消息，提取关键信息并写入 memory 文件，防止重要上下文丢失。

## OpenClaw 的实现分析

### 核心机制

OpenClaw 采用 **Pre-compaction Memory Flush** 策略：

```
Session 运行中，token 累积
        ↓
totalTokens >= (contextWindow - reserveTokens - softThreshold)?
        ↓ YES
触发 Memory Flush Turn（特殊的 agent 对话轮次）
        ↓
Agent 分析会话，将重要信息保存到 memory/YYYY-MM-DD.md
        ↓
然后才执行 Compaction（删除旧消息）
```

### 关键设计点

1. **Soft Threshold（软阈值）**
   - 默认值：`4000 tokens`
   - 触发条件：`totalTokens >= contextWindow - reserveTokens - softThreshold`
   - 在真正达到 compaction 阈值之前就触发 memory flush

2. **Memory Flush Prompt**
   ```
   Pre-compaction memory flush. Store durable memories now
   (use memory/YYYY-MM-DD.md; create memory/ if needed).
   If nothing to store, reply with [SILENT].
   ```

3. **防重复机制**
   - 使用 `memoryFlushCompactionCount` 追踪
   - 确保每次 compaction 周期只触发一次 flush

4. **Memory 文件结构**
   ```
   ~/.super-multica/agent-profiles/<profile-id>/
   ├── memory.md          # 主 memory 文件
   └── memory/
       ├── 2024-01-15.md   # 日期分片
       ├── 2024-01-16.md
       └── topics/
           └── project-x.md  # 主题分片
   ```

---

## Super Multica 实现方案

### Phase 1: 核心实现

#### 1.1 新增配置项

**文件：** `src/agent/session/session-manager.ts`

```typescript
export type SessionManagerOptions = {
  // ... existing options ...

  // Memory Flush 配置
  /** 是否启用自动 memory flush（默认：true） */
  enableMemoryFlush?: boolean | undefined;
  /** Memory flush 软阈值（在 compaction 前多少 tokens 触发），默认 4000 */
  memoryFlushSoftTokens?: number | undefined;
};
```

#### 1.2 新增 Memory Flush 模块

**文件：** `src/agent/memory/memory-flush.ts`

```typescript
/** Memory flush 配置 */
export type MemoryFlushSettings = {
  /** 软阈值（tokens），在达到 compaction 阈值前多少 tokens 触发 */
  softThresholdTokens: number;
  /** Memory flush 使用的系统 prompt */
  systemPrompt: string;
  /** Memory flush 使用的用户 prompt */
  userPrompt: string;
};

export const DEFAULT_MEMORY_FLUSH_SETTINGS: MemoryFlushSettings = {
  softThresholdTokens: 4000,
  systemPrompt: `You are in a pre-compaction memory flush turn. The session is approaching context limit and old messages will be deleted soon.

Your task: Review the conversation and extract any important information that should be preserved in long-term memory. Focus on:
- User preferences and settings
- Key decisions made
- Important technical details or solutions
- Project-specific knowledge
- Anything the user would want remembered in future sessions

Use the memory_write tool to save important information. If there's nothing worth saving, respond with [SILENT].`,

  userPrompt: `[SYSTEM] Pre-compaction memory flush triggered. Please review recent conversation and save any important information to memory before context compression occurs.`,
};

/** 检查是否应该触发 memory flush */
export function shouldRunMemoryFlush(params: {
  currentTokens: number;
  contextWindowTokens: number;
  reserveTokens: number;
  softThresholdTokens: number;
  lastMemoryFlushCompactionCount?: number;
  currentCompactionCount: number;
}): boolean {
  const {
    currentTokens,
    contextWindowTokens,
    reserveTokens,
    softThresholdTokens,
    lastMemoryFlushCompactionCount,
    currentCompactionCount,
  } = params;

  // 如果当前 compaction 周期已经 flush 过，不再触发
  if (lastMemoryFlushCompactionCount === currentCompactionCount) {
    return false;
  }

  // 计算 flush 阈值
  const flushThreshold = contextWindowTokens - reserveTokens - softThresholdTokens;

  return currentTokens >= flushThreshold;
}
```

#### 1.3 扩展 SessionEntry 类型

**文件：** `src/agent/session/types.ts`

```typescript
export type SessionMeta = {
  // ... existing fields ...

  /** 上次 memory flush 的时间戳 */
  memoryFlushAt?: number;
  /** 上次 memory flush 时的 compaction 计数 */
  memoryFlushCompactionCount?: number;
  /** Compaction 次数 */
  compactionCount?: number;
};
```

#### 1.4 修改 Agent Runner

**文件：** `src/agent/runner.ts`

```typescript
// 在 maybeCompact 之前检查并执行 memory flush
private async maybeCompact() {
  const messages = this.agent.state.messages.slice();

  // Phase 0: Check if memory flush is needed
  if (this.enableMemoryFlush) {
    const shouldFlush = shouldRunMemoryFlush({
      currentTokens: this.estimateCurrentTokens(messages),
      contextWindowTokens: this.contextWindowGuard.tokens,
      reserveTokens: this.reserveTokens,
      softThresholdTokens: this.memoryFlushSoftTokens,
      lastMemoryFlushCompactionCount: this.session.getMeta()?.memoryFlushCompactionCount,
      currentCompactionCount: this.session.getCompactionCount(),
    });

    if (shouldFlush) {
      await this.runMemoryFlush();
    }
  }

  // 继续原有的 compaction 逻辑...
  if (!this.session.needsCompaction(messages)) return;
  // ...
}

private async runMemoryFlush() {
  this.emitMulticaEvent({ type: "memory_flush_start" });

  try {
    // 创建一个临时的 agent turn 来执行 memory flush
    const flushResult = await this.executeMemoryFlushTurn();

    // 更新 session metadata
    this.session.saveMeta({
      ...this.session.getMeta(),
      memoryFlushAt: Date.now(),
      memoryFlushCompactionCount: this.session.getCompactionCount(),
    });

    this.emitMulticaEvent({
      type: "memory_flush_end",
      saved: flushResult.memoriesSaved,
    });
  } catch (error) {
    console.error("[Agent] Memory flush failed:", error);
    // Memory flush 失败不阻塞 compaction
  }
}

private async executeMemoryFlushTurn(): Promise<{ memoriesSaved: number }> {
  // 使用特殊的 system prompt 和 user prompt
  // 让 agent 分析当前会话并保存重要信息
  // 只允许使用 memory_write 工具

  const originalSystemPrompt = this.agent.state.systemPrompt;
  const originalTools = this.agent.state.tools;

  try {
    // 临时切换到 memory flush 模式
    this.agent.setSystemPrompt(this.memoryFlushSettings.systemPrompt);
    this.agent.setTools([this.memoryWriteTool]); // 只允许 memory_write

    // 执行一个 agent turn
    await this.agent.run(this.memoryFlushSettings.userPrompt);

    // 统计保存了多少 memory
    return { memoriesSaved: this.countMemoryWriteCalls() };
  } finally {
    // 恢复原始设置
    this.agent.setSystemPrompt(originalSystemPrompt);
    this.agent.setTools(originalTools);
  }
}
```

#### 1.5 新增 Memory Flush Events

**文件：** `src/agent/events.ts`

```typescript
/** Memory flush 开始事件 */
export type MemoryFlushStartEvent = {
  type: "memory_flush_start";
};

/** Memory flush 结束事件 */
export type MemoryFlushEndEvent = {
  type: "memory_flush_end";
  /** 保存的 memory 条目数 */
  saved: number;
};

/** Union of all Multica-specific events */
export type MulticaEvent =
  | CompactionStartEvent
  | CompactionEndEvent
  | MemoryFlushStartEvent
  | MemoryFlushEndEvent;
```

---

### Phase 2: Memory 文件管理

#### 2.1 Memory 文件结构

```
~/.super-multica/agent-profiles/<profile-id>/
├── identity.md       # 身份设定（已有）
├── memory.md         # 主 memory 文件（已有）
├── memory/           # Memory 分片目录（新增）
│   ├── 2024-01-15.md # 日期分片
│   ├── 2024-01-16.md
│   └── ...
└── sessions/         # Session 记录（已有）
```

#### 2.2 Memory Write Tool 增强

**文件：** `src/agent/tools/memory/memory-write.ts`

```typescript
// 支持写入日期分片
export function resolveMemoryPath(
  profileDir: string,
  targetFile?: string
): string {
  if (!targetFile) {
    // 默认写入今天的日期分片
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const memoryDir = path.join(profileDir, 'memory');
    ensureDirSync(memoryDir);
    return path.join(memoryDir, `${today}.md`);
  }

  // 支持指定文件
  if (targetFile.startsWith('memory/')) {
    return path.join(profileDir, targetFile);
  }

  return path.join(profileDir, 'memory.md');
}
```

---

### Phase 3: 前端集成

#### 3.1 SDK 事件类型

**文件：** `packages/sdk/src/types.ts`

```typescript
export type LocalChatEvent =
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | MemoryFlushStartEvent  // 新增
  | MemoryFlushEndEvent;   // 新增
```

#### 3.2 Zustand Store

**文件：** `packages/store/src/agent-store.ts`

```typescript
interface AgentState {
  // ... existing state ...

  /** 是否正在进行 memory flush */
  memoryFlushing: boolean;
  /** 上次 memory flush 信息 */
  lastMemoryFlush: {
    timestamp: number;
    saved: number;
  } | null;
}
```

#### 3.3 Desktop UI 提示

在 compaction 提示之前显示 "正在保存重要记忆..."

---

## 实现顺序

1. **Step 1**: 新增 `memory-flush.ts` 模块，定义类型和判断逻辑
2. **Step 2**: 扩展 `SessionMeta` 类型，添加 flush 相关字段
3. **Step 3**: 新增 `MemoryFlushStartEvent` 和 `MemoryFlushEndEvent` 事件
4. **Step 4**: 修改 `Agent` 类，添加 `runMemoryFlush` 方法
5. **Step 5**: 修改 `maybeCompact` 流程，在 compaction 前检查并执行 flush
6. **Step 6**: 增强 `memory_write` tool，支持日期分片
7. **Step 7**: SDK 和 Store 集成
8. **Step 8**: Desktop UI 提示

---

## 配置项汇总

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableMemoryFlush` | boolean | true | 是否启用自动 memory flush |
| `memoryFlushSoftTokens` | number | 4000 | 在 compaction 阈值前多少 tokens 触发 |

---

## 与现有功能的关系

```
Token 累积
    ↓
达到 Memory Flush 阈值？ ──────────────────────┐
    ↓ YES                                      │
Memory Flush Turn（新功能）                     │
    ├─ Agent 分析会话                          │
    ├─ 调用 memory_write 保存重要信息           │
    └─ 更新 memoryFlushCompactionCount         │
    ↓                                          │
达到 Compaction 阈值？ ←───────────────────────┘
    ↓ YES                                   ↓ NO
┌─────────────────────────────┐              │
│ Tool Result Pruning（已实现）│              │
│   Soft-trim / Hard-clear    │              │
└─────────────────────────────┘              │
    ↓                                        │
Message Compaction                           │
    ├─ 删除旧消息                             │
    └─ 或生成摘要                             │
    ↓                                        │
继续会话 ←──────────────────────────────────┘
```

---

## 风险和注意事项

1. **Token 消耗**: Memory flush turn 本身会消耗 tokens，需要控制 prompt 长度
2. **循环触发**: 需要 `memoryFlushCompactionCount` 防止重复触发
3. **Tool 限制**: Flush turn 应该只允许 `memory_write`，防止执行其他操作
4. **超时处理**: Flush turn 需要有超时机制，不能阻塞太久
5. **静默响应**: 如果没有需要保存的内容，agent 应该返回 `[SILENT]` 跳过

---

## 测试计划

1. **单元测试**: `shouldRunMemoryFlush` 判断逻辑
2. **集成测试**: Memory flush turn 执行流程
3. **E2E 测试**: 完整的 flush → compaction 流程
4. **边界测试**:
   - 连续多次 compaction 只触发一次 flush
   - Flush 失败不阻塞 compaction
   - Agent 返回 [SILENT] 时正常跳过
