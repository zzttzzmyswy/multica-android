---
name: Audio Transcription
description: Transcribe audio files using local Whisper CLI when automatic pre-processing is unavailable
version: 1.1.0
metadata:
  emoji: "🎙️"
  requires:
    anyBins:
      - whisper
      - whisper-cli
  install:
    - id: brew-whisper
      kind: brew
      formula: openai-whisper
      bins: [whisper]
      label: "Install OpenAI Whisper via Homebrew"
      os: [darwin]
  tags:
    - audio
    - transcription
    - media
userInvocable: false
disableModelInvocation: false
---

## Audio Transcription (Agent Fallback)

Voice messages from channels are pre-processed before reaching you. The transcription
priority is:

1. **Local whisper CLI** (free, offline) — requires `whisper` or `whisper-cli` in PATH
2. **OpenAI Whisper API** — requires an OpenAI API key in credentials
3. **No provider available** — you receive a raw file path instead of a transcript

When both providers are unavailable, you will receive `[audio message received]` with a
`File:` path instead of `[Voice Message]` with a transcript. Use local whisper to
transcribe manually:

```
whisper "<file_path>" --model base --output_format txt --output_dir /tmp
```

Then read the `.txt` file from `/tmp/` and respond based on the transcribed content.

### Setup

To enable automatic local transcription (recommended):

```bash
brew install openai-whisper
```

The first run will download the `base` model (~139MB) to `~/.cache/whisper/`.
No app restart is required — the binary is detected automatically on the next
voice message.
