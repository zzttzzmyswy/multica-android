# Android UI polish review

Use the draft PR's exact commit as the review baseline. A production Metro
bundle confirms the JavaScript and assets export, not Android installation,
gestures, keyboard behavior, or TalkBack. Record width, system font size, app
text size, locale, theme, build SHA and fixture for each device result.

## Host checks

From the repository root after installing the mobile workspace dependencies:

```sh
cd apps/mobile
pnpm exec vitest run --maxWorkers=4 --hookTimeout=30000
pnpm exec tsc --noEmit
CI=1 EXPO_NO_TELEMETRY=1 pnpm exec expo export --platform android --max-workers 2 --output-dir /tmp/multica-android-polish-export
```

The longer Vitest hook timeout accommodates NativeWind stylesheet compilation.
If the icon generation script reports its known missing `sharp` dependency,
record that separately; do not treat an unrelated missing tool as verified
type safety for that script. An Android package and emulator are not produced
by the export command.

## Device pass

Start with 320–360 dp, a typical phone around 390 dp, English and Chinese, then
repeat the crowded screens with large Android text and the app's larger text
setting. Check dark mode, high contrast and reduced motion, and use TalkBack
to confirm button names, selection and disabled indicators. For the first
visual pass, the signed-out **Demo** works offline with public-safe fixtures;
it shows Issue, Inbox, Chat and run sections without touching live data.

Use a disposable test account and workspace for the remaining checks. Do not
archive real agents, mutate the user's inbox, or install an update as part of
this pass.

| Surface | Verify |
| --- | --- |
| Sign-in/server | Offline and HTTP 504 are distinct; 504 keeps the code and current server. No default means no Switch action. A LAN browser/share link retains its port. |
| Issue creation/detail | A deferred property save blocks the second tap and mode switch. Long titles and action menus remain reachable. Long-press and select part of a comment, then copy just the selection. |
| Board/Gantt | Long lane labels show their count and separate actions. Check drag, hide and restore. Turn on Show completed with no visible rows and verify row/header alignment on scroll. |
| Search and threads | Check query typing, the separately announced Clear action, long previews and jump targets. Tombstoned intermediate replies do not inflate the visible count. |
| Chat | Queue enough items to scroll without hiding the composer. A failed Edit or Remove does not send, remove or restore text. Exercise the shortcuts and partial-copy gesture on a long assistant message. |
| Downloads / agent directory | Use a small fixture with unknown total, a failing retry, and a long filename. Verify bytes/status and action names. Filter the agent list while one selected agent changes availability; check the selection and confirmation count. |
| Project / Inbox | Fail an initial resource fetch, then retry; fail a refresh with cached rows. In a fixture, reject one archive while another succeeds; only the failed group should roll back. |
| Appearance | Compare light/dark and larger text; with either app or Android reduced motion active, check action sheets and fullscreen previews open without an animated transition. |

Keep screenshots free of live workspace names, credentials, and private
conversation content. For native build setup see [Android build](./android-build.md);
do not use a release identity for a side-by-side review build.
