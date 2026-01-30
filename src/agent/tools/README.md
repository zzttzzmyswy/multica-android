# Tools System

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

| Tool | Name | Description |
|------|------|-------------|
| Read | `read` | Read file contents |
| Write | `write` | Write content to files |
| Edit | `edit` | Edit existing files |
| Glob | `glob` | Find files by pattern |
| Exec | `exec` | Execute shell commands |
| Process | `process` | Manage long-running processes |
| Web Fetch | `web_fetch` | Fetch and extract content from URLs |
| Web Search | `web_search` | Search the web (requires API key) |

## Tool Groups

Groups provide shortcuts for allowing/denying multiple tools at once:

| Group | Tools |
|-------|-------|
| `group:fs` | read, write, edit, glob |
| `group:runtime` | exec, process |
| `group:web` | web_search, web_fetch |
| `group:core` | All of the above |

## Tool Profiles

Profiles are predefined tool sets for common use cases:

| Profile | Description | Tools |
|---------|-------------|-------|
| `minimal` | No tools (chat-only) | None |
| `coding` | File system + execution | group:fs, group:runtime |
| `web` | Coding + web access | group:fs, group:runtime, group:web |
| `full` | No restrictions | All tools |

## Usage

### CLI Usage

```bash
# Use a specific profile
pnpm agent:cli --tools-profile coding "list files"

# Minimal profile with specific tools allowed
pnpm agent:cli --tools-profile minimal --tools-allow exec "run ls"

# Deny specific tools
pnpm agent:cli --tools-deny exec,process "read file.txt"

# Use tool groups
pnpm agent:cli --tools-allow group:fs "read config.json"
```

### Programmatic Usage

```typescript
import { Agent } from "./runner.js";

const agent = new Agent({
  tools: {
    // Layer 1: Base profile
    profile: "coding",

    // Layer 2: Global customization
    allow: ["web_fetch"],  // Add web_fetch to coding profile
    deny: ["exec"],        // But deny exec

    // Layer 3: Provider-specific rules
    byProvider: {
      google: {
        deny: ["exec", "process"],  // Google models can't use runtime tools
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
pnpm tools:cli list

# List tools after applying a profile
pnpm tools:cli list --profile coding

# List tools with deny rules
pnpm tools:cli list --profile coding --deny exec

# Show all tool groups
pnpm tools:cli groups

# Show all profiles
pnpm tools:cli profiles
```

## Policy System Details

### Layer 1: Profile

The profile determines the base set of available tools. If not specified, all tools are available.

```typescript
// In groups.ts
export const TOOL_PROFILES = {
  minimal: { allow: [] },                              // No tools
  coding: { allow: ["group:fs", "group:runtime"] },   // FS + execution
  web: { allow: ["group:fs", "group:runtime", "group:web"] },  // + web
  full: {},                                            // No restrictions
};
```

### Layer 2: Global Allow/Deny

User-specified allow/deny lists that modify the profile's tool set:
- `allow`: Only these tools are available (additive to profile)
- `deny`: These tools are blocked (takes precedence over allow)

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
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const MyToolSchema = Type.Object({
  param1: Type.String({ description: "Parameter description" }),
  param2: Type.Optional(Type.Number()),
});

export function createMyTool(): AgentTool<typeof MyToolSchema> {
  return {
    name: "my_tool",
    label: "My Tool",
    description: "What this tool does",
    parameters: MyToolSchema,
    execute: async (toolCallId, args) => {
      // Implementation
      return { result: "success" };
    },
  };
}
```

3. Register the tool in `src/agent/tools.ts`:

```typescript
import { createMyTool } from "./tools/my-tool.js";

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
  "group:my_category": ["my_tool", "other_tool"],
  // ...
};
```

## Debugging

Enable debug mode to see tool filtering in action:

```bash
pnpm agent:cli --tools-profile minimal --debug "your prompt"
```

This will output:
```
[debug] Tools config: {"profile":"minimal"}
[debug] Resolved 0 tools: (none)
```

## Testing

Run the policy system tests:

```bash
npx tsx src/agent/tools/policy.test.ts
```

## Roadmap

### Phase 1: Infrastructure (Done)
- [x] Tool policy system (`policy.ts`)
- [x] Tool groups definition (`groups.ts`)
- [x] CLI support (`--tools-profile`, `--tools-allow`, `--tools-deny`)
- [x] Tools inspection CLI (`pnpm tools:cli`)

### Phase 2: Config File Support
- [ ] `multica.json` tools section - configure tools via project config file
- [ ] Agent Profile tools integration - default tools config per profile

### Phase 3: Core Tools
- [ ] Browser tool - simplified web automation (screenshot, click, type)
- [ ] Session management tools - `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn`, `session_status`

### Phase 4: Enhanced Tools
- [ ] Memory tool - persistent key-value storage for agent memory
- [ ] Image tool - image generation and manipulation

### Phase 5: Advanced Features
- [ ] Cron tool - scheduled task execution
- [ ] Message tool - inter-agent communication
- [ ] Canvas tool - visual output generation
