#!/usr/bin/env node
/**
 * Multica Android build guard — verify every assembled APK / AAB actually
 * ships the native core libraries it needs to launch, and that its manifest
 * package and embedded app config agree.
 *
 * Background: two consecutive release builds shipped a per-ABI APK that was
 * missing a native module (a stale / partial incremental build), which only
 * surfaced at install time as a launch crash. This script closes that loop:
 * after `assembleRelease` / `bundleRelease`, run it and it fails the build if
 * any artifact is missing a key `.so`.
 *
 * The package check closes a second, quieter hole. `expo prebuild` and
 * `./gradlew assembleRelease` are different processes and only the first is
 * given `APP_ENV`, which selects the package id. expo-constants'
 * createExpoConfig task re-evaluates app.config.ts in a fresh Node process at
 * Gradle time, so without plugins/with-app-config-env.js it fell back to
 * "development" and the iteration-186 APKs shipped a manifest naming
 * `ai.multica.mobile` beside an embedded config naming `ai.multica.mobile.dev`.
 * Everything reading `Constants.expoConfig` then saw the dev id on a production
 * install — invisible until the self-update flow's unknown-sources deep-link
 * scoped users to a package they did not have.
 *
 * Usage:
 *   node scripts/verify-apk.mjs                       # auto-discover release APKs/AABs
 *   node scripts/verify-apk.mjs path/to/app.apk ...   # explicit list
 *
 * All checks are structural (zip listing, aapt2 dump, JSON parse), matching how
 * each defect manifests in the artifact.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

/**
 * The package id Android will install the artifact under, read from its
 * manifest. Reviews the manifest rather than trusting anything expo wrote,
 * because the manifest is what the device actually uses.
 */
function readManifestPackage(archive) {
  const out = execFileSync(findAapt2(), ["dump", "packagename", archive], {
    encoding: "utf8",
  });
  // aapt2 prints the id, sometimes after a warning line.
  const line = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .pop();
  return line ?? null;
}

/**
 * Package id inside an artifact's embedded app config, which is what
 * expo-constants parses into `Constants.expoConfig` at runtime.
 *
 * An APK stores it at `assets/app.config`; an AAB nests every module under
 * `base/`. The entry is located by listing the archive first — `unzip -p` exits
 * non-zero when *any* requested path is absent even though it still prints the
 * ones that matched, so it cannot be asked for a list of candidates and judged
 * by its exit code. Absent is `undefined`, distinct from `null` for "present but
 * unreadable".
 */
const EMBEDDED_CONFIG_PATHS = ["assets/app.config", "base/assets/app.config"];

function readEmbeddedConfigPackage(archive) {
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim());
  const entry = EMBEDDED_CONFIG_PATHS.find((p) => entries.includes(p));
  if (!entry) return undefined; // this artifact carries no embedded app config

  const raw = execFileSync("unzip", ["-p", archive, entry], { encoding: "utf8" });
  try {
    return JSON.parse(raw)?.android?.package ?? null;
  } catch {
    return null;
  }
}

/**
 * Verdict for one artifact's package identity. Split out from `main` so the
 * decision can be exercised without building an APK.
 */
function checkPackageIdentity(manifestPackage, embeddedPackage) {
  if (embeddedPackage === undefined) {
    return { ok: true, note: `${manifestPackage}; no embedded app.config` };
  }
  if (embeddedPackage === null) {
    return {
      ok: false,
      error:
        "has an embedded assets/app.config that is unparseable or names no package",
    };
  }
  if (embeddedPackage !== manifestPackage) {
    return {
      ok: false,
      error:
        `package mismatch: manifest says ${manifestPackage}, embedded ` +
        `app.config says ${embeddedPackage}. A runtime reading ` +
        `Constants.expoConfig would act as ${embeddedPackage} on a ` +
        `${manifestPackage} install.`,
    };
  }
  return { ok: true, note: `package ${manifestPackage}` };
}

/** Newest installed aapt2, or a bare `aapt2` if the SDK layout is unfamiliar. */
function findAapt2() {
  const root = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (root) {
    const dir = path.join(root, "build-tools");
    if (existsSync(dir)) {
      const versions = readdirSync(dir)
        .filter((v) => existsSync(path.join(dir, v, "aapt2")))
        .sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true }),
        );
      if (versions.length > 0) return path.join(dir, versions[0], "aapt2");
    }
  }
  return "aapt2";
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
    if (missing.length > 0) {
      allOk = false;
      console.error(`[verify-apk] FAIL ${archive} missing: ${missing.join(", ")}`);
      continue;
    }

    // Package identity: the manifest decides what the device installs, and the
    // embedded config decides what the app believes it is. They must agree.
    let manifestPkg = null;
    try {
      manifestPkg = readManifestPackage(archive);
    } catch (e) {
      console.error(`[verify-apk] could not read manifest of ${archive}: ${e.message}`);
      allOk = false;
      continue;
    }
    const verdict = checkPackageIdentity(
      manifestPkg,
      readEmbeddedConfigPackage(archive),
    );
    if (!verdict.ok) {
      allOk = false;
      console.error(`[verify-apk] FAIL ${archive} ${verdict.error}`);
      continue;
    }
    console.log(
      `[verify-apk] OK  ${archive} (${names.length} native libs, ${verdict.note})`,
    );
  }

  if (!allOk) {
    console.error(
      "[verify-apk] One or more artifacts failed verification. Stopping the build.",
    );
    process.exit(1);
  }
  console.log(
    `[verify-apk] Verified ${checked} artifact${checked === 1 ? "" : "s"} — native libs present, package identity consistent.`,
  );
}

export {
  REQUIRED_LIBS,
  checkPackageIdentity,
  findAapt2,
  listSoFiles,
  readEmbeddedConfigPackage,
  readManifestPackage,
};

// Importable for tests; `main` runs only when invoked as a script.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
