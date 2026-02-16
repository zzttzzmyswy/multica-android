---
name: Meta Skill Installer
description: Detect missing capabilities, search clawhub.ai for matching skills, run security review on candidate skills, and install safe skills into Multica. Use when a task cannot be completed with current skills/tools or when the user asks to discover/install/update skills from ClawHub.
version: 1.0.0
metadata:
  tags:
    - meta
    - skills
    - clawhub
    - security
  install:
    - id: node-clawhub
      kind: node
      package: clawhub
      bins: [clawhub]
      label: "Install ClawHub CLI"
userInvocable: true
disableModelInvocation: false
---

# Meta Skill Installer

Use this skill to close capability gaps by discovering and installing skills from ClawHub with a mandatory security gate.

## Safety Defaults

- Always run in this order: identify gap -> search -> stage install -> security review -> install to managed dir -> validate.
- Never install directly into the active skills directory before review.
- If risk is `dangerous`, stop and explain why.
- If risk is `needs-review`, ask for explicit user confirmation before final install.

## Resolve Paths and Commands

Use Multica managed skills path, not the current workspace:

```bash
DATA_DIR="${SMC_DATA_DIR:-$HOME/.super-multica}"
SKILLS_DIR="$DATA_DIR/skills"
META_SKILL_DIR="$SKILLS_DIR/meta-skill-installer"

if command -v clawhub >/dev/null 2>&1; then
  CLAWHUB_CMD=(clawhub)
else
  CLAWHUB_CMD=(npx -y clawhub)
fi
```

If neither command path works, install the CLI first (`npm i -g clawhub`) and retry.

## Workflow

### 1) Detect the Capability Gap

When the current task cannot be completed with existing skills/tools:

- Summarize the missing capability in one sentence.
- Convert it to a focused search query (tool + domain + action).
- Keep the original user intent and success criteria.

### 2) Search ClawHub

Run one or more searches and collect top candidates:

```bash
"${CLAWHUB_CMD[@]}" search "<query>" --limit 10
```

Candidate ranking rules:

- Primary: semantic relevance to the missing capability.
- Secondary: clearer SKILL description and narrower scope.
- Tertiary: lower operational risk (fewer privileged or remote-exec patterns).

### 3) Stage Install in Quarantine Directory

Install candidate skill into a temporary workdir first:

```bash
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/multica-skill-review.XXXXXX")"
"${CLAWHUB_CMD[@]}" install "<slug>" --workdir "$STAGING_DIR" --dir skills --version "<optional-version>" --force
```

Expected staged path:

```bash
"$STAGING_DIR/skills/<slug>"
```

### 4) Run Security Review

Use this skill's scanner script against the staged skill:

```bash
node "$META_SKILL_DIR/scripts/review-skill-security.mjs" "$STAGING_DIR/skills/<slug>"
```

Interpret scanner output:

- `riskLevel: safe` -> continue to install.
- `riskLevel: needs-review` -> present findings, ask user for explicit confirmation.
- `riskLevel: dangerous` -> block install by default.

### 5) Install to Multica Managed Skills Directory

Only after passing the review gate, install to the directory Multica actually loads:

```bash
mkdir -p "$SKILLS_DIR"
"${CLAWHUB_CMD[@]}" install "<slug>" --workdir "$DATA_DIR" --dir skills --version "<optional-version>" --force
```

If skill already exists, use update:

```bash
"${CLAWHUB_CMD[@]}" update "<slug>" --workdir "$DATA_DIR" --dir skills --version "<optional-version>" --force
```

### 6) Post-Install Validation

Validate presence and scan once more in the final location:

```bash
test -f "$SKILLS_DIR/<slug>/SKILL.md"
node "$META_SKILL_DIR/scripts/review-skill-security.mjs" "$SKILLS_DIR/<slug>"
```

Then retry the original user task with the new skill.

## Guardrails

- Never claim installation success without path-level verification.
- Never hide security findings; summarize concrete files and reasons.
- Prefer pinned versions when available, and report the installed version to the user.
- If the chosen skill requires secrets/API keys, pause after install and ask user to configure required env vars before using it.
