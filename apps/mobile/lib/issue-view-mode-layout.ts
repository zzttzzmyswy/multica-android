/**
 * The toolbar reserves 16 dp on each side, and the selector adds 4 dp on
 * each side. Allow 54 dp at the default scale for the longest English label.
 * Step from five buttons to three or two instead of orphaning one button.
 */
export function issueViewModeColumns(windowWidth: number, effectiveFontScale: number): number {
  const width = Math.max(0, windowWidth - 40);
  const labelWidth = 54 * Math.max(1, effectiveFontScale);
  if (width >= 5 * labelWidth) return 5;
  if (width >= 3 * labelWidth) return 3;
  if (width >= 2 * labelWidth) return 2;
  return 1;
}
