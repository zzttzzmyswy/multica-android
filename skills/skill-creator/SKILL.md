---
name: Skill Creator
description: Create, edit, and manage custom skills to extend agent capabilities
version: 1.0.0
metadata:
  emoji: "🛠️"
  always: true
  tags:
    - meta
    - skills
    - developer-tools
---

## Instructions

You can create, edit, and manage skills to extend your own capabilities or help users build custom skills.

### Skills Directory

Custom skills are stored in `~/.super-multica/skills/`. Each skill is a directory containing a `SKILL.md` file.

```
~/.super-multica/skills/
├── my-skill/
│   └── SKILL.md
├── another-skill/
│   ├── SKILL.md
│   └── scripts/
│       └── helper.py
```

### SKILL.md Format

Every skill must have a `SKILL.md` file with YAML frontmatter and Markdown instructions:

```markdown
---
name: Skill Display Name
description: Brief description of what this skill does
version: 1.0.0
metadata:
  emoji: "🔧"
  tags:
    - category1
    - category2
  requires:
    bins: [required-binary]
    env: [REQUIRED_ENV_VAR]
  os: [darwin, linux]
---

## Instructions

Detailed instructions that will be injected into your system prompt...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name for the skill |
| `description` | No | Short description |
| `version` | No | Semantic version |
| `metadata.emoji` | No | Emoji for display |
| `metadata.tags` | No | Categorization tags |
| `metadata.always` | No | If true, always include (skip eligibility) |
| `metadata.requires.bins` | No | Required binaries (all must exist) |
| `metadata.requires.anyBins` | No | Alternative binaries (one must exist) |
| `metadata.requires.env` | No | Required environment variables |
| `metadata.os` | No | Supported platforms: darwin, linux, win32 |

### Creating a Skill

To create a new skill:

1. Create the skill directory:
   ```bash
   mkdir -p ~/.super-multica/skills/<skill-name>
   ```

2. Write the SKILL.md file with proper frontmatter and instructions

3. The skill will be automatically loaded (hot-reload is enabled)

### Example: Creating a Translation Skill

```markdown
---
name: Translator
description: Translate text between languages
version: 1.0.0
metadata:
  emoji: "🌐"
  tags:
    - language
    - translation
---

## Instructions

When asked to translate text:

1. Identify the source and target languages
2. If source language is not specified, detect it from the text
3. Provide accurate, natural-sounding translations
4. For ambiguous terms, offer alternative translations with context
5. Preserve formatting (bullet points, paragraphs, etc.)

### Supported Languages

You can translate between any common languages including:
English, Chinese, Japanese, Korean, Spanish, French, German, etc.

### Example Usage

User: "Translate 'Hello, how are you?' to Chinese"
Response: "你好，你好吗？" (Nǐ hǎo, nǐ hǎo ma?)
```

### Example: Creating a Code Formatter Skill

```markdown
---
name: Code Formatter
description: Format and beautify code in various languages
version: 1.0.0
metadata:
  emoji: "✨"
  requires:
    anyBins: [prettier, black, gofmt]
  tags:
    - code
    - formatting
---

## Instructions

When asked to format code:

1. Detect the programming language
2. Apply language-specific formatting rules
3. Use available formatters when possible:
   - JavaScript/TypeScript: prettier
   - Python: black
   - Go: gofmt
4. If no formatter is available, apply standard conventions
```

### Editing a Skill

To modify an existing skill:

1. Read the current SKILL.md file
2. Make your changes to the frontmatter or instructions
3. Save the file - changes take effect immediately

### Listing Skills

To see available skills, check the skills directory:
```bash
ls ~/.super-multica/skills/
```

Or use the CLI:
```bash
pnpm skills:cli list
```

### Removing a Skill

To remove a skill:
```bash
rm -rf ~/.super-multica/skills/<skill-name>
```

Or use the CLI:
```bash
pnpm skills:cli remove <skill-name>
```

### Best Practices

1. **Clear Instructions**: Write specific, actionable instructions
2. **Examples**: Include usage examples in your skill
3. **Requirements**: Specify binaries/env vars if needed
4. **Versioning**: Update version when making changes
5. **Tags**: Use descriptive tags for organization
6. **Single Responsibility**: Each skill should do one thing well

### Including Scripts

Skills can include helper scripts in a `scripts/` subdirectory:

```
my-skill/
├── SKILL.md
└── scripts/
    ├── process.py
    └── helper.sh
```

Reference them in your instructions:
```markdown
To process data, run the helper script:
\`\`\`bash
python ~/.super-multica/skills/my-skill/scripts/process.py
\`\`\`
```

### Skill Precedence

Skills from different sources have different priorities (highest wins):
1. Profile-specific skills (`~/.super-multica/agent-profiles/<id>/skills/`)
2. User-installed skills (`~/.super-multica/skills/`)
3. Plugin skills (from npm packages)
4. Bundled skills (built into the application)

A user skill with the same ID as a bundled skill will override it.
