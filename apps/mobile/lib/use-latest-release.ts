/**
 * Latest-version probe against the GitHub Release feed.
 *
 * Fetches `releases/latest` for the fork, parses it with the pure helpers in
 * `lib/release-check.ts`, and compares the tag against the installed app
 * version (`Constants.expoConfig.version`, e.g. "0.1.0"). The `hasUpdate`
 * boolean is mirrored into the update store so non-fetching UI (the More
 * popover's About row) can show a badge without owning a query of its own.
 *
 * The probe is silent by design: network failures resolve to "no update"
 * rather than surfacing an error. The About page drives `refetch()` manually
 * and renders its own error copy.
 */
import { useEffect } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useUpdateStore } from "@/data/update-store";
import {
  GITHUB_RELEASES_API,
  isNewer,
  parseLatestRelease,
} from "@/lib/release-check";

/** Fallback when expoConfig.version is somehow absent — never blocks. */
const DEFAULT_VERSION = "0.0.0";

/**
 * Timeout for the release probe. GitHub can be slow or silently impaired on
 * cellular/emulator networks; without this the manual check would sit in the
 * "checking…" state forever (fetch never rejects). 15s is generous for the
 * payload (a tiny JSON doc) while keeping the UI responsive.
 */
const FETCH_TIMEOUT_MS = 15_000;

export const latestReleaseOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: ["github-latest-release"] as const,
    queryFn: async () => {
      console.log("[update] probe start", GITHUB_RELEASES_API);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn("[update] probe timed out, aborting");
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(GITHUB_RELEASES_API, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        console.log("[update] probe http", res.status);
        if (!res.ok) {
          throw new Error(`GitHub returned ${res.status}`);
        }
        return parseLatestRelease(await res.json());
      } catch (err) {
        console.warn(
          "[update] probe failed",
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
    // Release cadence is slower than users reload the probe; 10 minutes keeps
    // the silent startup check cheap while never showing stale "update
    // available" for more than one cycle after an install.
    staleTime: 10 * 60 * 1000,
    retry: 0,
    enabled,
  });

export function useLatestRelease(enabled: boolean) {
  const query = useQuery(latestReleaseOptions(enabled));

  const currentVersion =
    (Constants.expoConfig?.version as string | undefined) ?? DEFAULT_VERSION;
  const hasUpdate = query.data ? isNewer(query.data.tag_name, currentVersion) : false;

  const setHasUpdate = useUpdateStore((s) => s.setHasUpdate);
  useEffect(() => {
    setHasUpdate(hasUpdate);
  }, [hasUpdate, setHasUpdate]);

  return query;
}