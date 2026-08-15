/**
 * Pinned items page (push screen). Title comes from the native Stack header
 * declared in `(app)/[workspace]/_layout.tsx`; the list body is the shared
 * `<PinnedScreen>` used by the "Pinned" bottom-tab too. The tab host draws
 * its own `<Header>`, so this push screen keeps no in-body title row.
 */
import { PinnedScreen } from "@/components/pin/pinned-screen";

export default function PinsPage() {
  return <PinnedScreen />;
}