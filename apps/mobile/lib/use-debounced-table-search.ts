/**
 * Debounce for the Table's quick search, shared by the surfaces that mount it.
 *
 * The search term travels to the SERVER as the `q` window param (see
 * `buildIssueWindow`), so every keystroke would otherwise be its own request
 * and its own query-key entry. Web uses the same 250ms window
 * (`packages/views/issues/surface/use-issue-surface-controller.ts:148`), and
 * matching it keeps the two clients feeling the same on a slow connection.
 *
 * Trims on the way out, not on the way in: the input keeps whatever the user
 * typed (including a trailing space mid-word) while the value that reaches the
 * query is the trimmed one — an untrimmed `"abc "` would key a second, empty
 * result set identical to `"abc"`.
 */
import { useEffect, useState } from "react";

export function useDebouncedTableSearch(value: string, delayMs = 250): string {
  const [debounced, setDebounced] = useState(value.trim());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}
