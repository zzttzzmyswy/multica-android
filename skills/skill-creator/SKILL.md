---
name: Skill Creator
description: Create, edit, and manage custom skills to extend agent capabilities. Use when the user asks to create a new skill, build a custom capability, or extend the agent's functionality.
version: 1.1.0
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

**CRITICAL: Always use the init_skill.py script to create skills.** This ensures the skill is created in the correct location (`~/.super-multica/skills/`).

```bash
# Basic usage
python3 ~/.super-multica/skills/skill-creator/scripts/init_skill.py <skill-name>

# With description and resources
python3 ~/.super-multica/skills/skill-creator/scripts/init_skill.py my-skill \
  --description "What this skill does" \
  --resources scripts
```

**Script options:**
- `--description, -d` - Skill description
- `--emoji, -e` - Emoji for display (default: 🔧)
- `--tag, -t` - Primary tag (default: custom)
- `--resources, -r` - Create directories: `scripts`, `references`, or both

**Examples:**
```bash
# Simple skill
python3 scripts/init_skill.py translator -d "Translate text between languages"

# Skill with helper script
python3 scripts/init_skill.py pdf-rotator -d "Rotate PDF pages" -r scripts

# Skill with references
python3 scripts/init_skill.py api-helper -d "Help with API calls" -r scripts,references
```

The script path when running from the skill-creator directory:
```bash
python3 ~/.super-multica/skills/skill-creator/scripts/init_skill.py <skill-name>
```

### Step 3: Edit the Skill

After initialization, edit `~/.super-multica/skills/<skill-name>/SKILL.md`:

1. Update the `description` - This is the primary trigger mechanism
2. Write clear `## Instructions` - What the agent should do
3. Add helper scripts to `scripts/` if needed
4. Add reference docs to `references/` if needed

### Step 4: Test the Skill

The skill is automatically loaded (hot-reload). Verify with:
```bash
pnpm skills:cli list | grep <skill-name>
```

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

Skills are stored in `~/.super-multica/skills/`:

```
~/.super-multica/skills/
├── my-skill/
│   └── SKILL.md
├── another-skill/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── helper.py
│   └── references/
│       └── api-docs.md
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

# Remove a skill
pnpm skills:cli remove <skill-name>
# or
rm -rf ~/.super-multica/skills/<skill-name>
```

## Best Practices

1. **Use init_skill.py** - Never create skills manually in random directories
2. **Clear description** - Include "when to use" triggers in the description
3. **Concise instructions** - Keep SKILL.md under 500 lines
4. **Test scripts** - Run helper scripts to verify they work
5. **Single responsibility** - Each skill should do one thing well

## Skill Precedence

Skills from different sources (highest priority wins):
1. Profile-specific skills (`~/.super-multica/agent-profiles/<id>/skills/`)
2. User-installed skills (`~/.super-multica/skills/`)
3. Plugin skills (from npm packages)
4. Bundled skills (built into the application)
