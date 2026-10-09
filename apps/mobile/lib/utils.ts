import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The type scale's steps are role-named (`text-body`, `text-caption`), which
 * makes them invisible to tailwind-merge: `text-<x>` is ambiguous between a
 * size and a colour, and its built-in table lists only Tailwind's DEFAULT
 * sizes. Unconfigured, it files every role step under text-colour and then
 * drops whichever of `text-body` / `text-muted-foreground` came first as a
 * conflict — silently.
 *
 * Measured on this app before the registration below:
 *
 *     cn("text-caption", "text-muted-foreground")  ->  "text-muted-foreground"
 *
 * The size vanished, so those six "secondary caption" sites rendered at the
 * inherited 16px — larger than the body text they were captioning — with
 * nothing in the source to explain it. Registering the steps as font-size
 * restores the real conflict groups: size beats size, colour beats colour,
 * and the two coexist.
 *
 * Keep this list in sync with the `fontSize` steps in tailwind.config.js,
 * which mirror `packages/ui/styles/tokens.css`. `lib/type-scale.test.ts`
 * fails if the two lists diverge.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "micro",
            "caption",
            "label",
            "body",
            "body-lg",
            "title-sm",
            "title",
            "title-lg",
            "display-sm",
            "display",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
