# Tools System

[中文文档](./README.zh-CN.md)

The tools system provides LLM agents with capabilities to interact with the external world. Tools are the "hands and feet" of an agent - without tools, an LLM can only generate text responses.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tool Definition                          │
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
│                    4-Layer Policy Filter                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 1: Profile                                         │  │
│  │ Base tool set: minimal | coding | web | full             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 2: Global Allow/Deny                               │  │
│  │ User customization via CLI or config                     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 3: Provider-Specific                               │  │
│  │ Different rules for different LLM providers              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Layer 4: Subagent Restrictions                           │  │
│  │ Limited tools for spawned child agents                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Filtered Tools                             │
│              (passed to pi-agent-core)                          │
└─────────────────────────────────────────────────────────────────┘
```

## Available Tools

| Tool          | Name            | Description                                   |
| ------------- | --------------- | --------------------------------------------- |
| Read          | `read`          | Read file contents                            |
| Write         | `write`         | Write content to files                        |
| Edit          | `edit`          | Edit existing files                           |
| Glob          | `glob`          | Find files by pattern                         |
| Exec          | `exec`          | Execute shell commands                        |
| Process       | `process`       | Manage long-running processes                 |
| Web Fetch     | `web_fetch`     | Fetch and extract content from URLs           |
| Web Search    | `web_search`    | Search the web (requires API key)             |
| Memory Get    | `memory_get`    | Retrieve a value from persistent memory       |
| Memory Set    | `memory_set`    | Store a value in persistent memory            |
| Memory Delete | `memory_delete` | Delete a value from persistent memory         |
| Memory List   | `memory_list`   | List all keys in persistent memory            |

> **Note**: Memory tools require a `profileId` to be specified. They store data in the profile's memory directory.

## Tool Groups

Groups provide shortcuts for allowing/denying multiple tools at once:

| Group           | Tools                                             |
| --------------- | ------------------------------------------------- |
| `group:fs`      | read, write, edit, glob                           |
| `group:runtime` | exec, process                                     |
| `group:web`     | web_search, web_fetch                             |
| `group:memory`  | memory_get, memory_set, memory_delete, memory_list|
| `group:core`    | All of the above (excluding memory)               |

## Tool Profiles

Profiles are predefined tool sets for common use cases:

| Profile   | Description             | Tools                              |
| --------- | ----------------------- | ---------------------------------- |
| `minimal` | No tools (chat-only)    | None                               |
| `coding`  | File system + execution | group:fs, group:runtime            |
| `web`     | Coding + web access     | group:fs, group:runtime, group:web |
| `full`    | No restrictions         | All tools                          |

## Usage

### CLI Usage

All commands use the unified `multica` CLI (or `pnpm multica` during development).

```bash
# Use a specific profile
multica run --tools-profile coding "list files"

# Minimal profile with specific tools allowed
multica run --tools-profile minimal --tools-allow exec "run ls"

# Deny specific tools
multica run --tools-deny exec,process "read file.txt"

# Use tool groups
multica run --tools-allow group:fs "read config.json"
```

### Programmatic Usage

```typescript
import { Agent } from './runner.js';

const agent = new Agent({
   tools: {
      // Layer 1: Base profile
      profile: 'coding',

      // Layer 2: Global customization
      allow: ['web_fetch'], // Add web_fetch to coding profile
      deny: ['exec'], // But deny exec

      // Layer 3: Provider-specific rules
      byProvider: {
         google: {
            deny: ['exec', 'process'], // Google models can't use runtime tools
         },
      },
   },

   // Layer 4: Subagent mode
   isSubagent: false,
});
```

### Inspecting Tool Configuration

Use the tools CLI to inspect and test configurations:

```bash
# List all available tools
multica tools list

# List tools after applying a profile
multica tools list --profile coding

# List tools with deny rules
multica tools list --profile coding --deny exec

# Show all tool groups
multica tools groups

# Show all profiles
multica tools profiles
```

## Policy System Details

### Layer 1: Profile

The profile determines the base set of available tools. If not specified, all tools are available.

```typescript
// In groups.ts
export const TOOL_PROFILES = {
   minimal: { allow: [] }, // No tools
   coding: { allow: ['group:fs', 'group:runtime'] }, // FS + execution
   web: { allow: ['group:fs', 'group:runtime', 'group:web'] }, // + web
   full: {}, // No restrictions
};
```

### Layer 2: Global Allow/Deny

User-specified allow/deny lists that modify the profile's tool set:

-  `allow`: Only these tools are available (additive to profile)
-  `deny`: These tools are blocked (takes precedence over allow)

### Layer 3: Provider-Specific

Different LLM providers may have different capabilities or restrictions:

```typescript
{
  byProvider: {
    google: { deny: ["exec"] },      // Gemini can't execute commands
    anthropic: { allow: ["*"] },     // Claude has full access
  }
}
```

### Layer 4: Subagent Restrictions

When `isSubagent: true`, additional restrictions are applied to prevent spawned agents from accessing sensitive tools like session management.

## Adding New Tools

1. Create a new file in `src/agent/tools/` (e.g., `my-tool.ts`)

2. Define the tool using TypeBox for the schema:

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const MyToolSchema = Type.Object({
   param1: Type.String({ description: 'Parameter description' }),
   param2: Type.Optional(Type.Number()),
});

export function createMyTool(): AgentTool<typeof MyToolSchema> {
   return {
      name: 'my_tool',
      label: 'My Tool',
      description: 'What this tool does',
      parameters: MyToolSchema,
      execute: async (toolCallId, args) => {
         // Implementation
         return { result: 'success' };
      },
   };
}
```

3. Register the tool in `src/agent/tools.ts`:

```typescript
import { createMyTool } from './tools/my-tool.js';

export function createAllTools(cwd: string): AgentTool<any>[] {
   // ... existing tools
   const myTool = createMyTool();

   return [
      ...baseTools,
      myTool as AgentTool<any>,
      // ...
   ];
}
```

4. Add the tool to appropriate groups in `groups.ts`:

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
   'group:my_category': ['my_tool', 'other_tool'],
   // ...
};
```

## Testing

Run the policy system tests:

```bash
pnpm test src/agent/tools/policy.test.ts
```

## Agent Profile Integration

Tools configuration can be defined in Agent Profile's `config.json`, allowing different agents to have different tool capabilities:

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

Each Agent's Profile can define its own tools configuration in `config.json`:

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

See [Profile README](../profile/README.md) for full documentation.

### Config Priority

When both Profile config and CLI options are provided:

1. **Profile `config.json`** - Base configuration
2. **CLI options** - Override/extend profile settings

```bash
# Profile has tools.profile = "coding"
# CLI adds --tools-deny exec
# Result: coding profile without exec tool
multica run --profile my-agent --tools-deny exec "list files"
```

## Future Tools

The following tools are planned for future implementation:

- **Browser** - Simplified web automation (screenshot, click, type)
- **Session Management** - `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`
- **Image** - Image generation and manipulation
- **Cron** - Scheduled task execution
- **Message** - Inter-agent communication
- **Canvas** - Visual output generation
