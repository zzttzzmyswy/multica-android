# Dependency patches

`patches/*.patch` are applied by pnpm at install time (`pnpm.patchedDependencies`
in the root `package.json`). Each one exists because a bug we hit is fixed
upstream but not yet in any published release — the patch is the smallest
change that carries the fix, and the entry below says when to delete it.

## `react-native-enriched-markdown@0.5.0.patch`

**Bug.** In a long chat reply, the message's own text drew past the bottom of
its cell and the next bubble (the user's own follow-up) was laid out on top of
it. Repro is any assistant message long enough to wrap over several CJK
paragraphs: the last line — and the "replied in Ns" caption under it — ended up
underneath the following bubble.

**Cause.** Block margins are implemented as spacer lines: `applyMarginBottom`
appends a lone `"\n"` and puts a `MarginBottomSpan` on it. A paragraph also puts
a `LineHeightSpan` over its whole range, spacer included. Both implement
`android.text.style.LineHeightSpan` and mutate the same `FontMetricsInt` in
place, so a spacer's height is decided by whichever runs LAST — and Android
does not call a line's height spans in the same order in the two layouts this
view has:

- the shadow node's `StaticLayout` in `MeasurementStore` (what Yoga measures the
  view from) ends up with the spacer at `marginBottom`;
- the `TextView`'s own layout (what actually draws) ends up with the spacer at
  almost a full line.

Every spacer contributes the difference, so the view is measured shorter than
it draws and the overflow lands on the next sibling. Upstream issue
[#1060](https://github.com/software-mansion/enriched-markdown/issues/1060).

**Fix.** Skip spacer lines in `LineHeightSpan`, so `MarginBottomSpan` owns them
in both orders — exactly what upstream merged for the list case
([#1102](https://github.com/software-mansion/enriched-markdown/pull/1102),
2026-10-30) and proposed for the general case
([#1062](https://github.com/software-mansion/enriched-markdown/pull/1062)).

**Delete this patch when** a published `react-native-enriched-markdown`
contains `isSpacerLine` in `spans/LineHeightSpan.kt`. As of this writing the
latest release is v1.1.1 (2026-10-06) and the fix landed 2026-10-30, so no
release has it — including the `1.2.0-nightly-20261031` build, checked
directly. `lib/markdown/spacer-line-patch.test.ts` fails once the installed
version carries the upstream fix, which is the signal to drop the patch.
