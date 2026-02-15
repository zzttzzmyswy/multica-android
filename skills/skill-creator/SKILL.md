---
name: Skill Creator
description: Create, edit, and manage custom skills to extend agent capabilities. Also activates inactive skills by guiding users through API key setup. Use when the user asks to create a new skill, build a custom capability, extend the agent's functionality, or when an inactive skill matches the user's intent.
version: 1.2.0
metadata:
  emoji: "🛠️"
  always: true
  tags:
    - meta
    - skills
    - developer-tools
---

## Instructions

You can create, edit, and manage skills to extend your own capabilities or help users build custom skills. You also activate inactive skills by guiding users through API key configuration.

## Activating Inactive Skills

When a user's request matches an **inactive skill** (listed under "Installed But Inactive Skills" in your system prompt), follow this flow:

1. **Inform the user**: Tell them the skill exists but needs setup
2. **Explain what's missing**: Reference the diagnostic info (e.g., "The Gmail skill requires a GMAIL_API_KEY")
3. **Guide them to get the key**: Provide the setup URL from the diagnostic hints
4. **Accept the key in chat**: Ask the user to paste the API key directly in the conversation
5. **Write the `.env` file**: Use the `write` tool to create the skill's `.env` file:
   ```
   ~/.super-multica/skills/<skill-id>/.env
   ```
   Content format:
   ```
   # API key for <Skill Name>
   <ENV_VAR_NAME>=<pasted-key>
   ```
6. **Confirm activation**: The skill system auto-reloads on file changes. Tell the user the skill is now active and proceed with their original request.

**IMPORTANT**: The user's API key is written to a local file only. Never log, echo, or transmit the key anywhere else.

### Example Conversation

```
User: "Help me check my latest emails"
Agent: "I have a Gmail skill installed, but it needs an API key to work.
        You can get one from: console.cloud.google.com (enable the Gmail API).
        Once you have the key, paste it here and I'll configure it for you."
User: "AIzaSyB..."
Agent: *writes ~/.super-multica/skills/gmail/.env*
Agent: "Done! Gmail is now active. Let me check your emails..."
```

## Creating New Skills When No Match Exists

If the user asks for a capability that doesn't match any existing or inactive skill:

1. **Suggest creating a new skill** if the capability is well-defined and repeatable
2. Briefly describe what the skill would do and ask for confirmation
3. Follow the **Skill Creation Process** below to create it
4. If the new skill needs API keys, guide the user through obtaining and configuring them

## Skill Creation Process

**ALWAYS follow these steps in order when creating a new skill:**

1. Understand what the skill should do
2. Initialize the skill using `init_skill.py`
3. Edit the generated SKILL.md
4. Test the skill

### Step 1: Understand the Skill

Before creating, clarify:
- What functionality should the skill provide?
- When should it be triggered?
- Does it need helper scripts?

### Step 2: Initialize the Skill

**CRITICAL: Never create skills in the current working directory.**

**Choose the correct directory based on context:**
- **If running under a profile**: Create in `~/.super-multica/agent-profiles/<profile-id>/skills/` (profile-specific)
- **If no profile**: Create in `~/.super-multica/skills/` (global)

```bash
# For profile-specific skill (when running under a profile):
mkdir -p ~/.super-multica/agent-profiles/<profile-id>/skills/<skill-name>

# For global skill (when no profile is active):
mkdir -p ~/.super-multica/skills/<skill-name>
```

Create SKILL.md with proper structure:

```bash
# Replace <SKILL_DIR> with the appropriate path from above
cat > <SKILL_DIR>/SKILL.md << 'EOF'
---
name: <Skill Name>
description: <What this skill does and when to use it>
version: 1.0.0
metadata:
  emoji: "🔧"
  tags:
    - custom
---

## Instructions

<Instructions for using this skill>
EOF

# (Optional) Create scripts directory if needed
mkdir -p <SKILL_DIR>/scripts
```

**Example - Creating a translator skill (global):**
```bash
mkdir -p ~/.super-multica/skills/translator

cat > ~/.super-multica/skills/translator/SKILL.md << 'EOF'
---
name: Translator
description: Translate text between languages. Use when user asks to translate text.
version: 1.0.0
metadata:
  emoji: "🌐"
  tags:
    - language
---

## Instructions

When asked to translate text:
1. Identify source and target languages
2. Provide accurate, natural translations
3. For ambiguous terms, offer alternatives
EOF
```

### Step 3: Edit the Skill

After initialization, edit the `SKILL.md` file in the skill directory:

1. Update the `description` - This is the primary trigger mechanism
2. Write clear `## Instructions` - What the agent should do
3. Add helper scripts to `scripts/` if needed
4. Add reference docs to `references/` if needed

### Step 4: Test the Skill

The skill is automatically loaded (hot-reload). Verify with:
```bash
pnpm skills:cli list | grep <skill-name>
```

**IMPORTANT: Do NOT create .skill package files.** Skills are loaded directly from the directory structure. There is no packaging step needed.

## SKILL.md Format

Every skill must have a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: Skill Display Name
description: Brief description of what this skill does
version: 1.0.0
metadata:
  emoji: "🔧"
  tags:
    - category1
  requires:
    bins: [required-binary]
    env: [REQUIRED_ENV_VAR]
---

## Instructions

Detailed instructions for using this skill...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name for the skill |
| `description` | Yes | Short description (triggers skill selection) |
| `version` | No | Semantic version |
| `metadata.emoji` | No | Emoji for display |
| `metadata.tags` | No | Categorization tags |
| `metadata.requires.bins` | No | Required binaries (all must exist) |
| `metadata.requires.anyBins` | No | Alternative binaries (one must exist) |
| `metadata.requires.env` | No | Required environment variables |

## Directory Structure

Skills are stored in two locations:

```
# Global skills (available to all profiles)
~/.super-multica/skills/
├── my-skill/
│   └── SKILL.md
└── another-skill/
    ├── SKILL.md
    ├── scripts/
    │   └── helper.py
    └── references/
        └── api-docs.md

# Profile-specific skills (only for this profile)
~/.super-multica/agent-profiles/<profile-id>/skills/
└── profile-only-skill/
    └── SKILL.md
```

## Editing Existing Skills

To modify an existing skill:

1. Read the current SKILL.md file
2. Make changes to frontmatter or instructions
3. Save - changes take effect immediately (hot-reload)

## Listing and Removing Skills

```bash
# List all skills
pnpm skills:cli list

# Check skill status
pnpm skills:cli status <skill-name>

# Remove a global skill
pnpm skills:cli remove <skill-name>
# or
rm -rf ~/.super-multica/skills/<skill-name>

# Remove a profile-specific skill
rm -rf ~/.super-multica/agent-profiles/<profile-id>/skills/<skill-name>
```

## Skills with API Key Requirements

When creating a skill that needs an API key:

1. Declare env requirements in the SKILL.md frontmatter:
   ```yaml
   metadata:
     requires:
       env: [SERVICE_API_KEY]
   ```

2. After creating the SKILL.md, write the `.env` file in the same directory:
   ```
   # API key for <Service Name>
   SERVICE_API_KEY=<key-value>
   ```

3. The skill becomes eligible immediately (hot-reload is automatic).

### .env File Format

Each skill stores its credentials in `~/.super-multica/skills/<skill-id>/.env`:

```
# Lines starting with # are comments
KEY_NAME=value
ANOTHER_KEY="value with spaces"
```

Rules:
- One key per line, `KEY=VALUE` format
- Quotes are optional (stripped automatically)
- Each skill has its own `.env` — no centralized credential file

## Best Practices

1. **Correct directory** - Never create skills in the current working directory
2. **Clear description** - Include "when to use" triggers in the description
3. **Concise instructions** - Keep SKILL.md under 500 lines
4. **Test scripts** - Run helper scripts to verify they work
5. **Single responsibility** - Each skill should do one thing well
6. **Proactive activation** - When you see an inactive skill matching user intent, suggest activating it

## Skill Precedence

Skills load from two sources (highest priority wins):
1. Profile-specific skills (`~/.super-multica/agent-profiles/<id>/skills/`)
2. Global skills (`~/.super-multica/skills/`)

Profile skills override global skills with the same ID.
