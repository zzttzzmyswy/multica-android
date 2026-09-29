# Building the Android client

`apps/mobile` was an iOS-only app; the Android build is newer and carries a few
host requirements that are invisible from a fresh checkout. This is the single
place that records them.

Everything here was reproduced on the build host (`zztArch`, JDK/Gradle/SDK
below) while producing the `v0.6.x` release APKs.

## Toolchain

| Piece | Version | Notes |
|---|---|---|
| Node | v26.x | |
| pnpm | 11.x | repo pins `pnpm@10.28.2` in `packageManager` |
| JDK | **17** | `/usr/lib/jvm/java-17-openjdk` — see below |
| Gradle | 9.0.0 | wrapper-pinned in the generated `android/` |
| Android SDK | platforms 34/35/36, build-tools 35.0.0 + 36.0.0, ndk 28.2, platform-tools | |

**`java` on `PATH` is not necessarily 17** — on this host it was 27. A JDK that
new is not merely discouraged, it breaks the build: AGP transforms
`$ANDROID_HOME/platforms/android-36/core-for-system-modules.jar` with `jlink`,
and 27's `jlink` fails, taking down every module's `compileReleaseJavaWithJavac`
with `Failed to transform core-for-system-modules.jar`. Set `JAVA_HOME`
explicitly to 17.

## Environment

```bash
export ANDROID_HOME=/home/zzt/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk
export GRADLE_USER_HOME=/mnt/sda1/zzt/gradle-home
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

`GRADLE_USER_HOME` matters for more than caching: that directory is pre-warmed
with the Gradle 9.0.0 distribution (~286 MB unpacked) and a ~9.7 GB dependency
cache. Pointing it elsewhere makes the wrapper re-download the distribution
first, which has stalled on this host's network.

## Build

The Gradle wrapper is inside the **generated** `android/` directory, not next to
`package.json`, so regenerate and enter it first:

```bash
cd apps/mobile
npx dotenv -e .env.production -- cross-env APP_ENV=production \
  npx expo prebuild --platform android

cd android
./gradlew assembleRelease     # per-ABI APKs -> app/build/outputs/apk/release/
./gradlew bundleRelease       # AAB
```

### `APP_ENV` is not optional — it picks the package id

`apps/mobile/app.config.ts` derives the Android `applicationId` from `APP_ENV`:

| `APP_ENV` | package id |
|---|---|
| unset / `development` | `ai.multica.mobile.dev` |
| `staging` | `ai.multica.mobile.staging` |
| `production` | `ai.multica.mobile` |

A release APK built without `APP_ENV=production` **succeeds and installs
cleanly** — it is simply the wrong app, a `.dev` alongside the real one. Check
the artifact, not the exit code:

```bash
"$ANDROID_HOME"/build-tools/35.0.0/aapt2 dump packagename \
  android/app/build/outputs/apk/release/app-arm64-v8a-release.apk   # -> ai.multica.mobile
```

`android/` is gitignored (Expo prebuild output) — regenerate it with the
prebuild command above, which re-applies every config plugin below.

### Changing `APP_ENV` needs a clean, or the Java compile fails

Switching `APP_ENV` between builds leaves the *previous* package id baked into
generated autolinking source, and the next build dies on it:

```
error: 程序包 ai.multica.mobile.dev 不存在
  if (ai.multica.mobile.dev.BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
```

The stale file is `app/build/generated/autolinking/src/main/java/com/facebook/
react/ReactNativeApplicationEntryPoint.java`. Removing the generated Gradle
output and rebuilding clears it. Keep `app/.cxx` — that directory holds the
compiled native objects for all four ABIs (~12 min to rebuild) and is keyed
independently of the package id, so it survives the switch usefully:

```bash
cd apps/mobile/android
rm -rf app/build build .gradle    # not app/.cxx
./gradlew assembleRelease
```

(`./gradlew clean` was not tried here — this is the command that was actually
observed to work, so it is the one recorded.)

### Verify the artifact before shipping

```bash
cd apps/mobile          # the script resolves android/... relative to its cwd
node scripts/verify-apk.mjs
```

Checks each APK/AAB actually contains the native libs the app needs to boot
(`libhermesvm.so` among them). Two consecutive releases once shipped an APK
missing a native module — a stale incremental build — which only surfaced as a
launch crash on-device.

## Why the build config lives in `plugins/`

Because `android/` is gitignored, anything written into the generated tree is
lost at the next prebuild. Every build-affecting fix therefore lives in tracked
source, as an Expo config plugin that re-splices itself on each prebuild:

| Plugin | Fixes |
|---|---|
| `with-gradle-jvmargs.js` | Gradle daemon metaspace ceiling |
| `with-abi-splits.js` | Per-ABI APK splits, R8/shrink defaults, install-unknown-sources permission, dead-font stripping |
| `with-fbjni-version-pin.js` | `com.facebook.fbjni` drift that produced a startup crash |
| `with-onig-prebuilt-path.js` | shiki-engine linking the host's `libonig.so` into an aarch64 target |
| `with-mermaid-asset.js`, `with-katex-asset.js` | WebView runtimes copied into APK assets |
| `with-brand-icons.js` | Notification small icon |

### The metaspace ceiling

The prebuild template writes:

```
org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
```

Iteration 183 recorded an all-ABI `assembleRelease` failing on its closing tasks
with the daemon reporting it had run out of JVM metaspace, and adopted a
hand-passed `-Dorg.gradle.jvmargs="-Xmx8g -XX:MaxMetaspaceSize=2g"` as the fix.

**That failure did not reproduce here.** Four all-ABI release builds at the
template's 512m ceiling reached `BUILD SUCCESSFUL` with no metaspace message in
the log — one from a fully cleaned tree (native dirs and `.cxx` removed), then
three consecutive incremental runs sharing a single daemon. So 512m is not by
itself insufficient on this host; treat the 183 failure as possibly
machine-state-dependent rather than a property of the configuration.

The splice in `plugins/with-gradle-jvmargs.js` is kept anyway, because it is
cheap and one-directional: it only ever *raises* a ceiling that is below 1 GiB,
`-Xmx` is a ceiling rather than a reservation, and it leaves a deliberately
raised value alone. It costs nothing when the smaller value would have worked,
and it removes the failure mode from the class of things that can go wrong.
It is **not** a documented repro—if you are chasing a real build failure, do not
assume this was it.

If you need to override anyway:

```bash
./gradlew assembleRelease -Dorg.gradle.jvmargs="-Xmx8g -XX:MaxMetaspaceSize=2g"
```

Do **not** edit the generated `gradle.properties` — the next prebuild overwrites
it, which is how this kept coming back.

### The copied-tree trap

If you build in a checkout that was produced by copying another checkout
(`cp -a`, `rsync`, a snapshot restore), Gradle's native-library merge can fail
with a duplicate-`.so` error whose reported input paths point at the **original**
directory:

```
> 2 files found with path 'lib/arm64-v8a/libworklets.so' from inputs:
   - /…/iter183/node_modules/.pnpm/react-native-reanimated@…/android/build/…
   - /…/iter184/node_modules/.pnpm/expo-modules-core@…/android/build/…
```

Nothing is actually wrong with the dependency graph. The copied
`node_modules/**/android/build/` directories are *generated Gradle output* that
baked in absolute paths from the machine and directory they were first built in;
one of them still resolves `libworklets.so` through the old tree, so the same
library arrives twice. Delete the generated native build dirs and rebuild:

```bash
find node_modules/.pnpm -maxdepth 5 -type d -name build -path "*/android/*" -prune -exec rm -rf {} +
rm -rf apps/mobile/android/{app/build,build,.gradle}
```

A fresh `pnpm install` avoids this entirely; copying a tree does not.

## Installing on a device

```bash
adb connect <host>:5555
cd android
./gradlew installRelease        # or: adb install -r <apk>
```

Confirm what actually landed rather than trusting `Success`:

```bash
adb shell dumpsys package ai.multica.mobile | grep -E 'versionCode|versionName'
```

Debug and dev variants use the `ai.multica.mobile.dev` package id, so they can
coexist with a release install — which is also why installing the wrong variant
does not fail, it just adds a second app.
