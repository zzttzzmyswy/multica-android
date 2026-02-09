# Channel System

The Channel system connects external messaging platforms (Telegram, Discord, etc.) to the Hub's agent. Each platform is a **plugin** that translates platform-specific APIs into a unified interface.

> For media handling details (audio transcription, image/video description), see [media-handling.md](./media-handling.md).
> For message flow across all three I/O paths (Desktop / Web / Channel), see [message-paths.md](../message-paths.md).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  credentials.json5                                          │
│  { channels: { telegram: { default: { botToken } } } }     │
└──────────────────────┬──────────────────────────────────────┘
                       │ loadChannelsConfig()
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Channel Manager (manager.ts)                               │
│                                                             │
│  startAll() → iterate plugins → startAccount() per account  │
│  subscribeToAgent() → listen for AI replies                 │
│                                                             │
│  Incoming: routeIncoming() → routeMedia() → agent.write()  │
│  Outgoing: lastRoute → aggregator → plugin.outbound.*()    │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Plugin Registry (registry.ts)                              │
│  registerChannel(plugin) / listChannels() / getChannel(id)  │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Channel Plugins (e.g. telegram.ts)                         │
│                                                             │
│  config    — resolve account credentials                    │
│  gateway   — receive messages (polling / webhook)           │
│  outbound  — send replies back to platform                  │
│  downloadMedia() — download media files to local disk       │
└─────────────────────────────────────────────────────────────┘
```

## Plugin Interface

Each channel plugin implements `ChannelPlugin` (defined in `types.ts`):

```typescript
interface ChannelPlugin {
  readonly id: string;                          // "telegram", "discord", etc.
  readonly meta: { name: string; description: string };
  readonly chunkerConfig?: BlockChunkerConfig;  // override text chunking per platform
  readonly config: ChannelConfigAdapter;        // credential resolution
  readonly gateway: ChannelGatewayAdapter;      // receive messages
  readonly outbound: ChannelOutboundAdapter;    // send replies
  downloadMedia?(fileId: string, accountId: string): Promise<string>;  // optional
}
```

### Three Adapters

| Adapter | Role | Key Methods |
|---------|------|-------------|
| **config** | Resolve credentials from `credentials.json5` | `listAccountIds()`, `resolveAccount()`, `isConfigured()` |
| **gateway** | Receive inbound messages from the platform | `start(accountId, config, onMessage, signal)` |
| **outbound** | Send replies back to the platform | `sendText()`, `replyText()`, `sendTyping?()` |

### downloadMedia (optional)

Platforms that support media (voice, image, video, document) implement `downloadMedia()` to download files to `~/.super-multica/cache/media/` with UUID filenames. The Manager calls this before processing media.

## Message Flow

### Inbound (Platform → Agent)

```
User sends message in Telegram
  → grammy long-polling → onMessage callback
    → ChannelManager.routeIncoming()
      1. Update lastRoute (reply target)
      2. Start typing indicator
      3. If media: routeMedia() → download → transcribe/describe → text
      4. agent.write(text)
```

All media is converted to text before the agent sees it. See [media-handling.md](./media-handling.md) for details.

### Outbound (Agent → Platform)

```
Agent produces reply
  → agent.subscribe() in ChannelManager
    → Check: if (!lastRoute) return   // not from a channel, skip
    → message_start → create MessageAggregator
    → message_update → feed text to aggregator
    → message_end → aggregator flushes final block
      → Aggregator emits BlockReply chunks
        → Block 0: plugin.outbound.replyText()   // Telegram reply format
        → Block N: plugin.outbound.sendText()     // follow-up messages
```

The **MessageAggregator** buffers streaming LLM output and splits it into blocks at natural text boundaries (paragraphs, code blocks). This is necessary because messaging platforms cannot consume raw streaming deltas.

## lastRoute Pattern

The `lastRoute` tracks which channel last sent a message:

- **Channel message arrives** → `lastRoute` is set to that plugin + conversation
- **Desktop/Web message arrives** → `clearLastRoute()` is called
- **Agent replies** → if `lastRoute` is set, reply goes to that channel; otherwise skipped

This ensures replies go back to the originating channel. Desktop and Web always receive agent events independently via their own mechanisms (IPC / Gateway).

## Configuration

Channel credentials are stored in `~/.super-multica/credentials.json5` under the `channels` key:

```json5
{
  channels: {
    telegram: {
      default: {
        botToken: "123456:ABC-DEF..."
      }
    },
    // discord: { default: { botToken: "..." } },
  }
}
```

Each channel ID maps to accounts (keyed by account ID, typically `"default"`). The config adapter for each plugin knows how to extract and validate its credentials.

## Adding a New Plugin

1. Create `src/channels/plugins/<name>.ts` implementing `ChannelPlugin`
2. Register it in `src/channels/index.ts`:
   ```typescript
   import { <name>Channel } from "./plugins/<name>.js";
   registerChannel(<name>Channel);
   ```
3. Add the config shape to the `channels` section of `credentials.json5`

### Implementation Checklist

- [ ] `config` adapter: parse credentials from `credentials.json5`
- [ ] `gateway` adapter: connect to platform, normalize messages to `ChannelMessage`
- [ ] `outbound` adapter: `sendText`, `replyText`, optional `sendTyping`
- [ ] `downloadMedia` (if platform supports media): download to `MEDIA_CACHE_DIR`
- [ ] Group filtering: only respond to messages directed at the bot
- [ ] Graceful shutdown: respect the `AbortSignal` passed to `gateway.start()`

## File Map

| File | Role |
|------|------|
| `src/channels/types.ts` | All type definitions (`ChannelPlugin`, `ChannelMessage`, `DeliveryContext`, etc.) |
| `src/channels/manager.ts` | `ChannelManager` — bridges plugins to the Hub's agent |
| `src/channels/registry.ts` | Plugin registry (`registerChannel`, `listChannels`, `getChannel`) |
| `src/channels/config.ts` | Load channel config from `credentials.json5` |
| `src/channels/index.ts` | Bootstrap: register built-in plugins, re-export public API |
| `src/channels/plugins/telegram.ts` | Telegram plugin (grammy, long polling) |
| `src/channels/plugins/telegram-format.ts` | Markdown → Telegram HTML converter |
| `src/media/transcribe.ts` | Audio transcription (local whisper → OpenAI API) |
| `src/media/describe-image.ts` | Image description (OpenAI Vision API) |
| `src/media/describe-video.ts` | Video description (ffmpeg frame + Vision API) |
| `src/shared/paths.ts` | `MEDIA_CACHE_DIR` path constant |
| `src/hub/message-aggregator.ts` | Streaming text → block chunking for channel delivery |

## Current Plugins

| Plugin | Platform | Transport | Library |
|--------|----------|-----------|---------|
| `telegram` | Telegram | Long polling | grammy |

Planned: Discord, Feishu, LINE, etc.
