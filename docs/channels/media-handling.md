# Channel Media Handling

How multimedia messages (voice, image, video, document) from messaging platforms are processed before reaching the Agent.

## Core Principle

All media is converted to text before the Agent sees it. The Agent only ever receives plain text via `agent.write()`.

```
Platform message (voice/image/video/doc)
  → Plugin: detect type + download file
  → Manager: convert to text (API transcription / vision description)
  → Agent receives text via agent.write()
```

## Reference Architecture (OpenClaw)

OpenClaw supports 6 platforms (Telegram, Discord, LINE, Signal, iMessage, Slack). All share the same media processing pipeline.

### Per-Platform Layer (different for each platform)

Each platform detects media type using its own API:

| Platform | Detection Method |
|----------|-----------------|
| Telegram | `msg.voice`, `msg.audio`, `msg.photo`, `msg.video`, `msg.document` |
| Discord | `attachment.content_type` MIME prefix (`audio/`, `image/`, `video/`) |
| LINE | `message.type` field (`"audio"`, `"image"`, `"video"`, `"file"`) |
| Signal | `attachment.contentType` MIME prefix |
| iMessage | `attachment.mime_type` MIME prefix |
| Slack | Any file attachment (MIME-based detection happens later) |

Each platform downloads the file using its own API, saves to local disk, and tags it:
- `<media:audio>` for voice/audio
- `<media:image>` for images
- `<media:video>` for video
- `<media:document>` for files

### Shared Layer (`applyMediaUnderstanding()`)

One function handles all conversions, called automatically before the Agent sees the message:

1. Reads local file path + MIME type
2. Selects conversion method based on type:
   - **audio** → transcription (whisper local / OpenAI API / Groq / Deepgram / Google)
   - **image** → vision model description (Gemini / OpenAI / Anthropic)
   - **video** → vision model description
3. Replaces placeholder with formatted text:
   - Audio: `[Audio]\nTranscript:\n<transcribed text>`
   - Image: `[Image]\nDescription:\n<description text>`
4. If conversion fails (no provider configured), the raw placeholder stays in the message

### Transcription Provider Priority

Auto-detection order:
1. sherpa-onnx-offline (local)
2. whisper-cli / whisper.cpp (local)
3. whisper Python CLI (local)
4. gemini CLI (local)
5. API providers: OpenAI → Groq → Deepgram → Google

### Skill Integration

Whisper skills declare requirements in `SKILL.md` metadata:
```yaml
requires:
  bins: ["whisper"]  # must exist in PATH
```

If the binary is missing, the skill is filtered out — the Agent never sees it. If present, the Agent can use it for transcription.

---

## Our Implementation

All media is converted to text in the Manager layer (`routeMedia()`) before reaching the Agent, matching OpenClaw's `applyMediaUnderstanding()` pattern.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Platform Plugin (e.g. telegram.ts)                  │
│                                                      │
│  bot.on("message:voice") → detect type               │
│  bot.api.getFile() → download to local disk           │
│  Emit ChannelMessage with media attachment            │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  Channel Manager (manager.ts → routeMedia())         │
│                                                      │
│  Download file via plugin.downloadMedia()            │
│  audio → transcribeAudio() → text                    │
│  image → describeImage() → text                      │
│  video → describeVideo() (ffmpeg frame + vision) → text │
│  document → file path info                           │
│  All results → agent.write(text)                     │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  Agent receives plain text only                      │
│  e.g. "[Voice Message]\nTranscript: ..."             │
│  e.g. "[Image]\nDescription: ..."                    │
│  e.g. "[Video]\nDescription: ..."                    │
└─────────────────────────────────────────────────────┘
```

### Media Processing Modules

| Type | Module | Method | API |
|------|--------|--------|-----|
| audio | `src/media/transcribe.ts` | `transcribeAudio()` | Local whisper/whisper-cli → OpenAI Whisper API (`whisper-1`) |
| image | `src/media/describe-image.ts` | `describeImage()` | OpenAI Vision API (`gpt-4o-mini`) |
| video | `src/media/describe-video.ts` | `describeVideo()` | ffmpeg frame extraction + Vision API |
| document | (inline in manager) | — | File path info only |

### Agent Output Format

| Type | Success | No API Key |
|------|---------|------------|
| audio | `[Voice Message]\nTranscript: <text>` | `[audio message received]\nFile: <path>` |
| image | `[Image]\nDescription: <text>` | `[image message received]\nFile: <path>` |
| video | `[Video]\nDescription: <text>` | `[video message received]\nFile: <path>` |
| document | `[document message received]\nFile: <path>` | same |

### Audio Transcription Priority

`transcribeAudio()` tries providers in order, matching OpenClaw's local-first approach:

1. **Local whisper/whisper-cli** — Free, no latency, works offline. Detected via `which` and cached.
2. **OpenAI Whisper API** (`whisper-1`) — Requires API key in `credentials.json5`.
3. **null** — No provider available. Placeholder stays in message, agent naturally responds (e.g. suggests installing whisper).

### Whisper Skill (Agent Fallback)

The `skills/whisper/SKILL.md` skill is a secondary safety net. If transcription returned null (no local binary, no API key), the agent receives a placeholder with the file path. If whisper is installed, the skill tells the agent how to transcribe it via the exec tool.

### File Map

| File | Role |
|------|------|
| `src/channels/types.ts` | `ChannelMediaAttachment`, `ChannelMessage.media`, `ChannelPlugin.downloadMedia` |
| `src/channels/plugins/telegram.ts` | Detect voice/audio/photo/video/document + download via Grammy API |
| `src/channels/manager.ts` | `routeMedia()` — download, convert, `agent.write(text)` |
| `src/media/transcribe.ts` | Audio → text (local whisper → OpenAI Whisper API) |
| `src/media/describe-image.ts` | Image → text via OpenAI Vision API (gpt-4o-mini) |
| `src/media/describe-video.ts` | Video → extract frame (ffmpeg) → text via Vision API |
| `src/shared/paths.ts` | `MEDIA_CACHE_DIR` (`~/.super-multica/cache/media/`) |
| `skills/whisper/SKILL.md` | Local whisper CLI fallback skill |

### Future Work

| Task | Scope |
|------|-------|
| Groq / Deepgram fallback for audio | `src/media/transcribe.ts` |
| Multi-provider vision support (Gemini, Anthropic) | `src/media/describe-image.ts` |
| Document text extraction (PDF, DOCX) | `src/media/` |
| Media cache cleanup (delete old files) | `src/shared/` |
| Outbound media (send images/audio back to channels) | `types.ts`, plugins |
