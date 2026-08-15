#!/usr/bin/env node
/**
 * Multica Android build guard — verify every assembled APK / AAB actually
 * ships the native core libraries it needs to launch.
 *
 * Background: two consecutive release builds shipped a per-ABI APK that was
 * missing a native module (a stale / partial incremental build), which only
 * surfaced at install time as a launch crash. This script closes that loop:
 * after `assembleRelease` / `bundleRelease`, run it and it fails the build if
 * any artifact is missing a key `.so`.
 *
 * Usage:
 *   node scripts/verify-apk.mjs                       # auto-discover release APKs/AABs
 *   node scripts/verify-apk.mjs path/to/app.apk ...   # explicit list
 *
 * Checks the 5 libs the Hermes + Expo module + reanimated runtime needs to
 * boot. libhermesvm (Hermes VM) is the important one — a build without it
 * crashes before JS runs. All checks are structural (zip listing), matching
 * how a missing native lib manifests in the artifact.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// The 5 libs whose absence means "this APK cannot boot this app".
const REQUIRED_LIBS = [
  "libexpo-modules-core.so",
  "libappmodules.so",
  "libhermesvm.so",
  "libreanimated.so",
  "libworklets.so",
];

/** List native `.so` **basenames** inside a zip/APK/AAB via `unzip -l`. */
function listSoFiles(archive) {
  const out = execFileSync("unzip", ["-l", archive], { encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim().split(/\s+/).pop() ?? "")
    .filter((name) => name.includes("/lib") && name.endsWith(".so"))
    .map((name) => name.split("/").pop()); // lib/arm64-v8a/x.so -> x.so
}

/** Default discovery: release per-ABI APKs + release AAB from build outputs. */
function discoverArtifacts() {
  const candidates = [];
  const apkGlob = "android/app/build/outputs/apk/release";
  if (existsSync(apkGlob)) {
    for (const f of ["app-arm64-v8a-release.apk", "app-armeabi-v7a-release.apk",
      "app-x86-release.apk", "app-x86_64-release.apk"]) {
      const p = `${apkGlob}/${f}`;
      if (existsSync(p)) candidates.push(p);
    }
  }
  const aabGlob = "android/app/build/outputs/bundle/release";
  if (existsSync(aabGlob)) {
    for (const f of ["app-release.aab"]) {
      const p = `${aabGlob}/${f}`;
      if (existsSync(p)) candidates.push(p);
    }
  }
  return candidates;
}

function main(artifacts) {
  const targets = artifacts.length > 0 ? artifacts : discoverArtifacts();
  if (targets.length === 0) {
    console.error(
      "[verify-apk] No release APK/AAB found — run assembleRelease first, or pass paths explicitly.",
    );
    process.exit(1);
  }

  let allOk = true;
  let checked = 0;
  for (const archive of targets) {
    if (!existsSync(archive)) {
      console.error(`[verify-apk] ${archive} does not exist`);
      allOk = false;
      continue;
    }
    let names;
    try {
      names = listSoFiles(archive);
    } catch (e) {
      console.error(`[verify-apk] could not read ${archive}: ${e.message}`);
      allOk = false;
      continue;
    }
    checked++;
    const missing = REQUIRED_LIBS.filter((lib) => !names.includes(lib));
    if (missing.length === 0) {
      console.log(`[verify-apk] OK  ${archive} (${names.length} native libs)`);
    } else {
      allOk = false;
      console.error(`[verify-apk] FAIL ${archive} missing: ${missing.join(", ")}`);
    }
  }

  if (!allOk) {
    console.error("[verify-apk] Missing native libs in one or more artifacts. Stopping the build.");
    process.exit(1);
  }
  console.log(`[verify-apk] Verified ${checked} artifact${checked === 1 ? "" : "s"} — all required native libs present.`);
}

main(process.argv.slice(2));