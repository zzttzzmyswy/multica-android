# 工具系统

[English](./README.md)

工具系统为 LLM Agent 提供与外部世界交互的能力。工具是 Agent 的"手和脚"——没有工具，LLM 只能生成文本响应。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        工具定义                                  │
│  (AgentTool from @mariozechner/pi-agent-core)                  │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │    name     │  │ description │  │ parameters  │             │
│  │   label     │  │   execute   │  │  (TypeBox)  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    4 层策略过滤器                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 1 层: Profile                                         │  │
│  │ 基础工具集: minimal | coding | web | full                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 2 层: 全局 Allow/Deny                                 │  │
│  │ 通过 CLI 或配置文件进行用户自定义                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 3 层: Provider 特定规则                                │  │
│  │ 不同 LLM Provider 有不同的规则                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 第 4 层: Subagent 限制                                   │  │
│  │ 子 Agent 的工具访问受限                                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      过滤后的工具                                │
│              (传递给 pi-agent-core)                             │
└─────────────────────────────────────────────────────────────────┘
```

## 可用工具

| 工具          | 名称            | 描述                                          |
| ------------- | --------------- | --------------------------------------------- |
| Read          | `read`          | 读取文件内容                                  |
| Write         | `write`         | 写入文件内容                                  |
| Edit          | `edit`          | 编辑现有文件                                  |
| Glob          | `glob`          | 按模式查找文件                                |
| Exec          | `exec`          | 执行 Shell 命令                               |
| Process       | `process`       | 管理长时间运行的进程                          |
| Web Fetch     | `web_fetch`     | 从 URL 获取并提取内容                         |
| Web Search    | `web_search`    | 搜索网络（需要 API Key）                      |
| Memory Get    | `memory_get`    | 从持久化内存中获取值                          |
| Memory Set    | `memory_set`    | 向持久化内存中存储值                          |
| Memory Delete | `memory_delete` | 从持久化内存中删除值                          |
| Memory List   | `memory_list`   | 列出持久化内存中的所有键                      |

> **注意**: Memory 工具需要指定 `profileId`。数据存储在 Profile 的 memory 目录中。

## 工具组

工具组提供了一次性允许/禁止多个工具的快捷方式：

| 组              | 工具                                              |
| --------------- | ------------------------------------------------- |
| `group:fs`      | read, write, edit, glob                           |
| `group:runtime` | exec, process                                     |
| `group:web`     | web_search, web_fetch                             |
| `group:memory`  | memory_get, memory_set, memory_delete, memory_list|
| `group:core`    | 以上所有（不包括 memory）                         |

## 工具配置文件

配置文件是为常见用例预定义的工具集：

| Profile   | 描述                | 工具                               |
| --------- | ------------------- | ---------------------------------- |
| `minimal` | 无工具（仅聊天）    | 无                                 |
| `coding`  | 文件系统 + 执行     | group:fs, group:runtime            |
| `web`     | 编码 + 网络访问     | group:fs, group:runtime, group:web |
| `full`    | 无限制              | 所有工具                           |

## 使用方法

### CLI 使用

所有命令使用统一的 `multica` CLI（开发时使用 `pnpm multica`）。

```bash
# 使用特定配置文件
multica run --tools-profile coding "list files"

# 最小配置文件 + 允许特定工具
multica run --tools-profile minimal --tools-allow exec "run ls"

# 禁止特定工具
multica run --tools-deny exec,process "read file.txt"

# 使用工具组
multica run --tools-allow group:fs "read config.json"
```

### 编程使用

```typescript
import { Agent } from './runner.js';

const agent = new Agent({
   tools: {
      // 第 1 层: 基础配置文件
      profile: 'coding',

      // 第 2 层: 全局自定义
      allow: ['web_fetch'], // 在 coding 配置文件基础上添加 web_fetch
      deny: ['exec'], // 但禁止 exec

      // 第 3 层: Provider 特定规则
      byProvider: {
         google: {
            deny: ['exec', 'process'], // Google 模型不能使用运行时工具
         },
      },
   },

   // 第 4 层: Subagent 模式
   isSubagent: false,
});
```

### 检查工具配置

使用 tools CLI 检查和测试配置：

```bash
# 列出所有可用工具
multica tools list

# 列出应用配置文件后的工具
multica tools list --profile coding

# 列出带有禁止规则的工具
multica tools list --profile coding --deny exec

# 显示所有工具组
multica tools groups

# 显示所有配置文件
multica tools profiles
```

## 策略系统详情

### 第 1 层: Profile

配置文件决定了可用工具的基础集合。如果未指定，则所有工具都可用。

```typescript
// 在 groups.ts 中
export const TOOL_PROFILES = {
   minimal: { allow: [] }, // 无工具
   coding: { allow: ['group:fs', 'group:runtime'] }, // 文件系统 + 执行
   web: { allow: ['group:fs', 'group:runtime', 'group:web'] }, // + 网络
   full: {}, // 无限制
};
```

### 第 2 层: 全局 Allow/Deny

用户指定的 allow/deny 列表，用于修改配置文件的工具集：

-  `allow`: 只有这些工具可用（在配置文件基础上添加）
-  `deny`: 这些工具被阻止（优先于 allow）

### 第 3 层: Provider 特定规则

不同的 LLM Provider 可能有不同的能力或限制：

```typescript
{
  byProvider: {
    google: { deny: ["exec"] },      // Gemini 不能执行命令
    anthropic: { allow: ["*"] },     // Claude 有完全访问权限
  }
}
```

### 第 4 层: Subagent 限制

当 `isSubagent: true` 时，会应用额外的限制，防止子 Agent 访问敏感工具（如会话管理）。

## 添加新工具

1. 在 `src/agent/tools/` 中创建新文件（例如 `my-tool.ts`）

2. 使用 TypeBox 定义工具的 Schema：

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const MyToolSchema = Type.Object({
   param1: Type.String({ description: '参数描述' }),
   param2: Type.Optional(Type.Number()),
});

export function createMyTool(): AgentTool<typeof MyToolSchema> {
   return {
      name: 'my_tool',
      label: 'My Tool',
      description: '这个工具做什么',
      parameters: MyToolSchema,
      execute: async (toolCallId, args) => {
         // 实现
         return { result: 'success' };
      },
   };
}
```

3. 在 `src/agent/tools.ts` 中注册工具：

```typescript
import { createMyTool } from './tools/my-tool.js';

export function createAllTools(cwd: string): AgentTool<any>[] {
   // ... 现有工具
   const myTool = createMyTool();

   return [
      ...baseTools,
      myTool as AgentTool<any>,
      // ...
   ];
}
```

4. 在 `groups.ts` 中将工具添加到适当的组：

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
   'group:my_category': ['my_tool', 'other_tool'],
   // ...
};
```

## 测试

运行策略系统测试：

```bash
pnpm test src/agent/tools/policy.test.ts
```

## Agent Profile 集成

工具配置可以在 Agent Profile 的 `config.json` 中定义，允许不同的 Agent 拥有不同的工具能力：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Super Multica Hub                          │
│                                                                 │
│   ┌───────────┐    ┌───────────┐    ┌───────────┐              │
│   │  Agent A  │    │  Agent B  │    │  Agent C  │              │
│   │  Profile: │    │  Profile: │    │  Profile: │              │
│   │  coder    │    │  reviewer │    │  devops   │              │
│   │           │    │           │    │           │              │
│   │  tools:   │    │  tools:   │    │  tools:   │              │
│   │  coding   │    │  minimal  │    │  full     │              │
│   └─────┬─────┘    └─────┬─────┘    └─────┬─────┘              │
│         │                │                │                     │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │  Client  │     │  Client  │     │  Client  │
    └──────────┘     └──────────┘     └──────────┘
```

每个 Agent 的 Profile 可以在 `config.json` 中定义自己的工具配置：

```json
{
   "tools": {
      "profile": "coding",
      "deny": ["exec"]
   },
   "provider": "anthropic",
   "model": "claude-sonnet-4-20250514"
}
```

详见 [Profile README](../profile/README.md)。

### 配置优先级

当同时提供 Profile 配置和 CLI 选项时：

1. **Profile `config.json`** - 基础配置
2. **CLI 选项** - 覆盖/扩展 Profile 设置

```bash
# Profile 有 tools.profile = "coding"
# CLI 添加 --tools-deny exec
# 结果: coding 配置文件但没有 exec 工具
multica run --profile my-agent --tools-deny exec "list files"
```

## 未来工具

以下工具计划在未来实现：

- **Browser** - 简化的网页自动化（截图、点击、输入）
- **Session Management** - `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`
- **Image** - 图像生成和处理
- **Cron** - 定时任务执行
- **Message** - Agent 间通信
- **Canvas** - 可视化输出生成
