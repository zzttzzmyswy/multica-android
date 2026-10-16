#!/usr/bin/env bash
# Verify that a published release is traceable back to the commit it was built from.
#
# Why this exists: `gh release create` without `--target` builds the tag on the
# repository's DEFAULT branch. The v0.5.98 release was published that way, so
# `git checkout v0.5.98` handed back main's head — a tree whose app.config.ts
# still said version 0.5.46 — while the four APK assets were 0.5.98. The release
# page looked fine; only the source archive was wrong.
#
# Usage: verify-release-tag.sh <tag> [<expected-branch>]
#   e.g. verify-release-tag.sh v0.5.98 iter170-agent-channel-bind
#        verify-release-tag.sh mobile-v0.6.84 iter251-fix-update-version-compare
# Exit 0 = consistent, 1 = mismatch (details on stdout).
#
# Needs `gh` authenticated against the account owning the repo:
#   gh auth switch --user zzttzzmyswy
set -uo pipefail
REPO=zzttzzmyswy/multica-android
TAG="${1:?usage: verify-release-tag.sh <tag> [<expected-branch>]}"
BRANCH="${2:-}"
fail=0
bad() { echo "FAIL  $*"; fail=1; }

# The version a tag claims, derived the same way the app derives it: strip the
# release namespace (`mobile-`) and the `v` marker, keep the dotted numeric core.
#
# This used to be `${TAG#v}`, which is correct only while tags are bare `v*`.
# The Android channel moved to `mobile-v*` on 2026-10-11, and on
# `mobile-v0.6.84` that expansion is a no-op — so the check compared
# '0.6.84' against 'mobile-v0.6.84', failed, and reported a CORRECT tag as
# "tag is on the wrong commit". A verifier that cries wolf on every release
# since 2026-10-11 is worse than none: it trains the reader to ignore it.
# Mirrors `parseVersionSegments` in apps/mobile/lib/app-version.ts.
tag_version=$(printf '%s' "$TAG" | grep -oP '^(?:[A-Za-z][A-Za-z0-9]*-)*[vV]?\K[0-9]+(?:\.[0-9]+)*' | head -1)
if [ -z "$tag_version" ]; then
  bad "cannot read a version out of tag '$TAG' — refusing to guess what it claims"
  exit 1
fi
echo "tag $TAG claims version $tag_version"

# 1. The tag must exist. Resolve through the commits endpoint rather than
#    git/ref/tags: v0.5.95 is an annotated tag, so the raw ref hands back a tag
#    object whose sha is not a commit and would never match a branch head.
tag_sha=$(gh api "repos/$REPO/commits/$TAG" --jq '.sha' 2>/dev/null)
if [ -z "$tag_sha" ]; then
  bad "tag $TAG does not exist"
  exit 1
fi
echo "tag $TAG -> $tag_sha"

# 2. The tree the tag points at must be the version the tag claims. This is the
#    check that catches a tag left on the default branch — it needs no knowledge
#    of which iteration branch was intended.
app_version=$(gh api "repos/$REPO/contents/apps/mobile/app.config.ts?ref=$TAG" \
  --jq '.content' 2>/dev/null | base64 -d | grep -oP '^\s+version:\s*"\K[^"]+' | head -1)
if [ "$app_version" != "$tag_version" ]; then
  bad "app.config.ts at $TAG says version '$app_version', tag claims '$tag_version' — tag is on the wrong commit"
else
  echo "ok    app.config.ts version = $app_version"
fi

# 3. The release's target_commitish should name the branch that was built.
#    Note this field is NOT proof of anything on its own: a release created from
#    a tag that already exists reports "main" even when the tag is fine (that is
#    how v0.1.0–v0.5.91 look). Only a mismatch against an explicitly named branch
#    is treated as a failure — the tag-tree version check above is the real
#    detector for a tag left on the wrong commit.
#
#    A missing release is reported here rather than compared: `gh api` echoes the
#    404 BODY on stdout, so the old code compared the literal string
#    '{"message":"Not Found"...}' against a branch name, failed, and then fed
#    that same JSON to the arithmetic test in step 5 ("integer expected").
#    Detect the shape explicitly instead of trusting a truthiness test.
release_target=$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.target_commitish' 2>/dev/null)
if [ -z "$release_target" ] || printf '%s' "$release_target" | grep -q '"message"'; then
  bad "no release found for tag $TAG"
  release_target=""
else
  echo "info  release target_commitish = $release_target"
  if [ -n "$BRANCH" ] && [ "$release_target" != "$BRANCH" ]; then
    bad "release target is '$release_target', expected '$BRANCH'"
  fi
fi

# 4. If a branch was named, the tag must sit exactly on its head.
if [ -n "$BRANCH" ]; then
  branch_sha=$(git -C "$(dirname "$0")/multica" ls-remote --heads github "refs/heads/$BRANCH" 2>/dev/null | cut -f1)
  if [ -z "$branch_sha" ]; then
    bad "branch $BRANCH not found on github remote"
  elif [ "$branch_sha" != "$tag_sha" ]; then
    bad "tag is at $tag_sha but $BRANCH head is $branch_sha"
  else
    echo "ok    tag sits on $BRANCH head"
  fi
fi

# 5. A release with no assets is a half-published release.
assets=$(gh api "repos/$REPO/releases/tags/$TAG" --jq '.assets | length' 2>/dev/null)
if ! printf '%s' "${assets:-}" | grep -qP '^\d+$'; then
  bad "cannot read the asset count for $TAG (got '${assets:-}')"
elif [ "$assets" -lt 4 ]; then
  bad "release $TAG has $assets assets, expected 4 (one per ABI)"
else
  echo "ok    $assets assets attached"
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS  $TAG is traceable to its source"
else
  echo "----  $TAG has traceability problems (see FAIL lines)"
fi
exit "$fail"
