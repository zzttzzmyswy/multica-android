export type ToolExecutionRecord = {
  toolName: string;
  isError: boolean;
  details: Record<string, unknown> | null;
};

export type WebToolUsage = {
  searchCalls: number;
  searchSuccess: number;
  searchSuccessWithResults: number;
  fetchCalls: number;
  fetchSuccess: number;
};

function hasToolError(details: Record<string, unknown> | null): boolean {
  return details?.error === true;
}

function getSearchResultCount(details: Record<string, unknown> | null): number {
  if (!details) return 0;
  const countRaw = details.count;
  if (typeof countRaw === "number" && Number.isFinite(countRaw)) {
    return Math.max(0, Math.floor(countRaw));
  }

  const results = details.results;
  if (Array.isArray(results)) {
    return results.length;
  }

  return 0;
}

function isSuccessfulExecution(record: ToolExecutionRecord): boolean {
  if (record.isError) return false;
  if (hasToolError(record.details)) return false;
  return true;
}

export function summarizeWebToolUsage(records: ToolExecutionRecord[]): WebToolUsage {
  const usage: WebToolUsage = {
    searchCalls: 0,
    searchSuccess: 0,
    searchSuccessWithResults: 0,
    fetchCalls: 0,
    fetchSuccess: 0,
  };

  for (const record of records) {
    const toolName = record.toolName.trim().toLowerCase();

    if (toolName === "web_search") {
      usage.searchCalls += 1;
      if (isSuccessfulExecution(record)) {
        usage.searchSuccess += 1;
        if (getSearchResultCount(record.details) > 0) {
          usage.searchSuccessWithResults += 1;
        }
      }
      continue;
    }

    if (toolName === "web_fetch") {
      usage.fetchCalls += 1;
      if (isSuccessfulExecution(record)) {
        usage.fetchSuccess += 1;
      }
    }
  }

  return usage;
}

export function shouldEnforceWebFetchAfterSearch(params: {
  usage: WebToolUsage;
  webSearchAvailable: boolean;
  webFetchAvailable: boolean;
}): boolean {
  const { usage, webSearchAvailable, webFetchAvailable } = params;

  if (!webSearchAvailable || !webFetchAvailable) return false;
  if (usage.searchSuccessWithResults <= 0) return false;
  if (usage.fetchSuccess > 0) return false;

  return true;
}
