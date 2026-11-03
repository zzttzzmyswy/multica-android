# Dependency patches

`patches/*.patch` are applied by pnpm at install time (`pnpm.patchedDependencies`
in the root `package.json`). Each one exists because a bug we hit is fixed
upstream but not yet in any published release — the patch is the smallest
change that carries the fix, and the entry below says when to delete it.

## `react-native-enriched-markdown@0.5.0.patch`

Three independent defects, all of the same family: **what Yoga measures differs
from what the TextView draws**, so a block's content overflows its own bottom
edge onto whatever follows it. Two are upstream bugs carried from `main`; one is
ours to avoid. No published release contains any of the upstream parts.

### The bug

Block margins are implemented as spacer lines: `applyMarginBottom` (and the
list renderer) append a lone `"\n"` and put a `MarginBottomSpan` on it. The
enclosing block also puts a `LineHeightSpan` over its whole range, spacer
included. Both implement `android.text.style.LineHeightSpan` and mutate the same
`FontMetricsInt` in place, so a spacer's height is decided by whichever runs
LAST — and Android does not call a line's height spans in the same order in the
two layouts this view has:

- the shadow node's `StaticLayout` in `MeasurementStore`, which is what Yoga
  measures the view from;
- the `TextView`'s own layout, which is what actually draws.

So Yoga sizes the block from one spacer height while the TextView draws
another. Every spacer contributes the difference, and the overflow is drawn
past the block's bottom edge — on top of whatever follows it. Upstream issue
[#1060](https://github.com/software-mansion/enriched-markdown/issues/1060).

### Half 1 — paragraphs (`spans/LineHeightSpan.kt`)

A long chat reply drew over the next bubble: the last line and the "replied in
Ns" caption ended up underneath the user's follow-up. Any assistant message
wrapping over several CJK paragraphs reproduces it.

**Fix.** Skip spacer lines in `LineHeightSpan`, so `MarginBottomSpan` owns them
in both orders. This is upstream
[#1062](https://github.com/software-mansion/enriched-markdown/pull/1062)'s
approach (that PR was closed unmerged; the guard it proposes is the right one).

### Half 2 — lists (`renderer/ListRenderer.kt`, `utils/text/span/SpanFlags.kt`)

A long issue comment's last **bullet** drew over the reaction bar's emoji
button. Reproduced on 0.6.117 (which already had half 1), so this half is
genuinely separate.

Half 1 does not cover it: a list sets its line-height span AFTER its items, and
the items' own `MarginBottomSpan`s are already on the text. Skipping spacers in
`LineHeightSpan` does not change *which* span wins — the order still differs
between the two layouts.

**Fix.** Give the list-wide `LineHeightSpan` the maximum span priority
(`SPAN_FLAGS_LINE_HEIGHT_PRIORITY`), so it iterates FIRST in both layouts and
the items' margin spans always land on top of it. That is exactly upstream
[#1102](https://github.com/software-mansion/enriched-markdown/pull/1102)
(merged 2026-10-30).

### Half 3 — the real cause: drawing breaks lines differently (`utils/text/view/TextViewSetup.kt`)

A comment's last line drew over the reaction bar's emoji button, and only some
comments did it.

**Cause.** The measuring `StaticLayout` in `MeasurementStore` sets
`BREAK_STRATEGY_HIGH_QUALITY`. The `TextView` that actually draws never set a
break strategy, so it used the platform default `BREAK_STRATEGY_SIMPLE`. For
Latin text the two usually agree; for **CJK**, which may break between almost
any two characters, they pick different break points — so the same text at the
same width can render a different **number of lines**. Yoga sized the block from
the measuring pass, the TextView drew taller, and the overflow landed past the
block's bottom edge, on the reaction bar.

This also explains why the bug looked content-dependent and why five earlier
hypotheses (spacer lines, list span priority, `LinkSpan` font reset, wrapped
list items, content height) were all disproved: the defect only appears when
the two strategies happen to disagree on a given text.

**Fix.** Set the same break strategy on the drawing view, so both layouts break
identically. The guard test pins both sides together: changing one without the
other brings the whole family of measure-vs-draw bugs back.

### Delete this patch when

a published `react-native-enriched-markdown` contains **all** of:

- `isSpacerLine` in `spans/LineHeightSpan.kt`,
- `SPAN_FLAGS_LINE_HEIGHT_PRIORITY` in `renderer/ListRenderer.kt`, and
- a `TextViewSetup` that sets the same `breakStrategy` the measuring side uses
  (this one is ours, not upstream's — check the measuring side still agrees).

As of this writing the latest release is v1.1.1 (2026-10-06) and the fixes
landed 2026-10-30, so no release has them — including the
`1.2.0-nightly-20261031` build, checked directly.
`apps/mobile/lib/markdown/spacer-line-patch.test.ts` asserts both halves are
applied and fails once the installed version carries the upstream fix, which is
the signal to drop the patch.
