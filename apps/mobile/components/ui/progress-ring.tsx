/**
 * Tiny circular progress ring — mobile port of web's
 * `packages/views/issues/components/progress-ring.tsx` (MYS-493). Renders
 * an open ring while in progress and fills to a solid arc when complete.
 *
 * Used on sub-issue rows to show "x/y of THIS sub-issue's own children are
 * done" without opening it. Web colors: primary while in progress, info
 * (blue) when complete — mirrored via THEME tokens so dark mode flips
 * automatically.
 */
import Svg, { Circle } from "react-native-svg";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

export function ProgressRing({
  done,
  total,
  size = 12,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const { colorScheme } = useColorScheme();
  const stroke = 1.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(done / total, 1) : 0;
  const offset = circumference * (1 - ratio);
  const isComplete = total > 0 && done >= total;
  const color = isComplete ? THEME[colorScheme].info : THEME[colorScheme].primary;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Track — same color at 25% opacity (web uses strokeOpacity 0.25). */}
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeOpacity={0.25}
        strokeWidth={stroke}
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        rotation={-90}
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  );
}