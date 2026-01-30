#!/usr/bin/env python3
"""
Skill Initializer - Creates a new skill in the managed skills directory

Usage:
    init_skill.py <skill-name> [--resources scripts,references]

Examples:
    init_skill.py my-translator
    init_skill.py code-formatter --resources scripts
    init_skill.py api-helper --resources scripts,references

The skill will be created at: ~/.super-multica/skills/<skill-name>/
"""

import argparse
import os
import re
import sys
from pathlib import Path

# Fixed output directory - always use managed skills directory
MANAGED_SKILLS_DIR = Path.home() / ".super-multica" / "skills"

MAX_SKILL_NAME_LENGTH = 64
ALLOWED_RESOURCES = {"scripts", "references"}

SKILL_TEMPLATE = """---
name: {skill_name}
description: {description}
version: 1.0.0
metadata:
  emoji: "{emoji}"
  tags:
    - {tag}
---

## Instructions

{instructions}
"""

EXAMPLE_SCRIPT = '''#!/usr/bin/env python3
"""
Helper script for {skill_name}

Replace this with your actual implementation.
"""

def main():
    print("Hello from {skill_name}!")
    # TODO: Add your script logic here

if __name__ == "__main__":
    main()
'''

EXAMPLE_REFERENCE = """# Reference Documentation for {skill_title}

Add detailed reference documentation here.

## Overview

[Describe what this reference covers]

## Details

[Add detailed information]
"""


def normalize_skill_name(skill_name: str) -> str:
    """Normalize a skill name to lowercase hyphen-case."""
    normalized = skill_name.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", normalized)
    normalized = normalized.strip("-")
    normalized = re.sub(r"-{2,}", "-", normalized)
    return normalized


def title_case_skill_name(skill_name: str) -> str:
    """Convert hyphenated skill name to Title Case for display."""
    return " ".join(word.capitalize() for word in skill_name.split("-"))


def parse_resources(raw_resources: str) -> list[str]:
    if not raw_resources:
        return []
    resources = [item.strip() for item in raw_resources.split(",") if item.strip()]
    invalid = sorted({item for item in resources if item not in ALLOWED_RESOURCES})
    if invalid:
        allowed = ", ".join(sorted(ALLOWED_RESOURCES))
        print(f"[ERROR] Unknown resource type(s): {', '.join(invalid)}")
        print(f"   Allowed: {allowed}")
        sys.exit(1)
    return list(dict.fromkeys(resources))  # dedupe while preserving order


def create_resource_dirs(skill_dir: Path, skill_name: str, skill_title: str, resources: list[str]):
    for resource in resources:
        resource_dir = skill_dir / resource
        resource_dir.mkdir(exist_ok=True)

        if resource == "scripts":
            example_script = resource_dir / "helper.py"
            example_script.write_text(EXAMPLE_SCRIPT.format(skill_name=skill_name))
            example_script.chmod(0o755)
            print(f"  [OK] Created {resource}/helper.py")
        elif resource == "references":
            example_ref = resource_dir / "reference.md"
            example_ref.write_text(EXAMPLE_REFERENCE.format(skill_title=skill_title))
            print(f"  [OK] Created {resource}/reference.md")


def init_skill(skill_name: str, description: str, emoji: str, tag: str,
               instructions: str, resources: list[str]) -> Path | None:
    """
    Initialize a new skill directory with SKILL.md.

    Returns:
        Path to created skill directory, or None if error
    """
    # Ensure managed skills directory exists
    MANAGED_SKILLS_DIR.mkdir(parents=True, exist_ok=True)

    # Determine skill directory path
    skill_dir = MANAGED_SKILLS_DIR / skill_name

    # Check if directory already exists
    if skill_dir.exists():
        print(f"[ERROR] Skill directory already exists: {skill_dir}")
        print(f"   To edit, modify files directly in {skill_dir}")
        print(f"   To recreate, first run: rm -rf {skill_dir}")
        return None

    # Create skill directory
    try:
        skill_dir.mkdir(parents=True, exist_ok=False)
        print(f"[OK] Created skill directory: {skill_dir}")
    except Exception as e:
        print(f"[ERROR] Error creating directory: {e}")
        return None

    # Create SKILL.md from template
    skill_content = SKILL_TEMPLATE.format(
        skill_name=skill_name,
        description=description,
        emoji=emoji,
        tag=tag,
        instructions=instructions
    )

    skill_md_path = skill_dir / "SKILL.md"
    try:
        skill_md_path.write_text(skill_content)
        print("  [OK] Created SKILL.md")
    except Exception as e:
        print(f"[ERROR] Error creating SKILL.md: {e}")
        return None

    # Create resource directories if requested
    if resources:
        skill_title = title_case_skill_name(skill_name)
        try:
            create_resource_dirs(skill_dir, skill_name, skill_title, resources)
        except Exception as e:
            print(f"[ERROR] Error creating resource directories: {e}")
            return None

    # Print summary
    print(f"\n[SUCCESS] Skill '{skill_name}' created at {skill_dir}")
    print("\nThe skill is now active (hot-reload enabled).")
    print("Test it by running: pnpm skills:cli list")

    return skill_dir


def main():
    parser = argparse.ArgumentParser(
        description="Create a new skill in ~/.super-multica/skills/",
    )
    parser.add_argument("skill_name", help="Skill name (will be normalized to hyphen-case)")
    parser.add_argument(
        "--description", "-d",
        default="[TODO: Add description]",
        help="Skill description"
    )
    parser.add_argument(
        "--emoji", "-e",
        default="🔧",
        help="Emoji for the skill (default: 🔧)"
    )
    parser.add_argument(
        "--tag", "-t",
        default="custom",
        help="Primary tag for the skill (default: custom)"
    )
    parser.add_argument(
        "--instructions", "-i",
        default="[TODO: Add instructions for when and how to use this skill]",
        help="Instructions content"
    )
    parser.add_argument(
        "--resources", "-r",
        default="",
        help="Comma-separated list: scripts,references"
    )
    args = parser.parse_args()

    raw_skill_name = args.skill_name
    skill_name = normalize_skill_name(raw_skill_name)

    if not skill_name:
        print("[ERROR] Skill name must include at least one letter or digit.")
        sys.exit(1)

    if len(skill_name) > MAX_SKILL_NAME_LENGTH:
        print(
            f"[ERROR] Skill name '{skill_name}' is too long ({len(skill_name)} characters). "
            f"Maximum is {MAX_SKILL_NAME_LENGTH} characters."
        )
        sys.exit(1)

    if skill_name != raw_skill_name:
        print(f"Note: Normalized skill name from '{raw_skill_name}' to '{skill_name}'")

    resources = parse_resources(args.resources)

    print(f"Creating skill: {skill_name}")
    print(f"   Location: {MANAGED_SKILLS_DIR / skill_name}")
    if resources:
        print(f"   Resources: {', '.join(resources)}")
    print()

    result = init_skill(
        skill_name=skill_name,
        description=args.description,
        emoji=args.emoji,
        tag=args.tag,
        instructions=args.instructions,
        resources=resources
    )

    sys.exit(0 if result else 1)


if __name__ == "__main__":
    main()
