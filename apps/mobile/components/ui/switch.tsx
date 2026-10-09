import { cn } from '@/lib/utils';
import * as SwitchPrimitives from '@rn-primitives/switch';
import { Platform } from 'react-native';

/**
 * The switch's box, as NUMBERS rather than utility classes.
 *
 * `h-[1.15rem] w-8` (and the thumb's `size-4`) are NativeWind arbitrary-value
 * classes. On the release bundle they did not resolve for these two primitives
 * and the switch laid out at ZERO size: a Pixel 5 UI dump showed
 * `android.widget.Switch` nodes present but with `bounds="[0,0][0,0]"` and
 * `visible: false`, so every switch in the app was invisible — the workspace
 * wakeup defaults, the notification preferences, the issue wakeup rows. The
 * tap target survived only as an accessibility node.
 *
 * Inline dimensions are what the rest of this app already uses where a size is
 * load-bearing (`presence-dot.tsx`, `avatar-stack.tsx`), and they do not depend
 * on the class pipeline resolving an arbitrary value.
 */
const TRACK_WIDTH = 51;
const TRACK_HEIGHT = 31;
const THUMB_SIZE = 27;
const THUMB_INSET = 2;

function Switch({
  className,
  style,
  ...props
}: React.ComponentProps<typeof SwitchPrimitives.Root>) {
  // RN lets `style` be a function of the pressable state. `Switch` is a press
  // target, so that form is legal here even though no caller in this app uses
  // it — the spread types it that way, and silently dropping it would ignore a
  // caller's sizing.
  const resolved = typeof style === 'function' ? style({ pressed: false }) : style;
  return (
    <SwitchPrimitives.Root
      style={[
        {
          width: TRACK_WIDTH,
          height: TRACK_HEIGHT,
          borderRadius: TRACK_HEIGHT / 2,
          // The thumb travels from inset to (width - thumb - inset); the
          // distance is derived so a change to either number cannot leave the
          // thumb parked outside the track.
          paddingHorizontal: THUMB_INSET,
          justifyContent: 'center',
        },
        resolved,
      ]}
      className={cn(
        'shrink-0 flex-row items-center border border-transparent shadow-sm shadow-black/5',
        Platform.select({
          web: 'focus-visible:border-ring focus-visible:ring-ring/50 peer inline-flex outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed',
        }),
        props.checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      <SwitchPrimitives.Thumb
        style={{
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: THUMB_SIZE / 2,
          // Positioned by the flex row rather than a translate class: the
          // arbitrary translate did not resolve either, which is what left the
          // thumb overlapping the track's left edge in both states.
          marginLeft: props.checked
            ? TRACK_WIDTH - THUMB_SIZE - THUMB_INSET * 2
            : 0,
        }}
        className={cn(
          'bg-background rounded-full',
          Platform.select({
            web: 'pointer-events-none block ring-0 transition-transform',
          }),
          props.checked
            ? 'dark:bg-primary-foreground'
            : 'dark:bg-foreground'
        )}
      />
    </SwitchPrimitives.Root>
  );
}

export { Switch };
