export type ToolExecutionRecord = {
  toolName: string;
  isError: boolean;
  details: Record<string, unknown> | null;
};

export type WebToolUsage = {
  searchCalls: number;
  searchSuccess: number;
  searchSuccessWithResults: number;
  /** True when the latest successful search (with results) has no later successful fetch. */
  searchNeedsFollowupFetch: boolean;
  fetchCalls: number;
  fetchSuccess: number;
};

export type WebFetchRequirement = {
  requiredMinFetchSuccess: number;
  promptSuggestsResearchDepth: boolean;
  multiSourceCue: boolean;
  explicitMinFetchFromPrompt: number | null;
};

export type CrossTurnWebFetchGuardAnalysis = {
  shouldEnforce: boolean;
  explicitFetchRequest: boolean;
  userProvidesUrl: boolean;
  freshnessCue: boolean;
  webCue: boolean;
  userNeedsFreshWebEvidence: boolean;
  userBlocksWebFetch: boolean;
  assistantHasWebClaimSignal: boolean;
};

const URL_PATTERN = /https?:\/\/[^\s)]+/i;

const USER_EXPLICIT_FETCH_PATTERNS: RegExp[] = [
  /\b(re[-\s]?fetch|fetch (again|fresh)|verify with sources?|cite sources?|provide (sources?|links?))\b/i,
  /\b(revisit|revalidate|double-check)\b.*\b(source|link|url|web|website)\b/i,
  /(?:\u672c\u8f6e|\u8fd9\u4e00\u8f6e).*(?:\u91cd\u65b0|\u518d\u6b21).*(?:\u6293\u53d6|\u83b7\u53d6|\u62c9\u53d6)/,
  /(?:\u91cd\u65b0|\u518d\u6b21).*(?:\u6293\u53d6|\u83b7\u53d6).*(?:\u7f51\u9875|\u6b63\u6587|\u539f\u6587|\u94fe\u63a5)/,
  /(?:\u7ed9\u51fa|\u63d0\u4f9b).*(?:\u6765\u6e90|\u94fe\u63a5|\u5f15\u7528)/,
  /(?:\u6838\u5b9e|\u67e5\u8bc1|\u9a8c\u8bc1).*(?:\u6765\u6e90|\u7f51\u9875)/,
];

const USER_FRESHNESS_PATTERNS: RegExp[] = [
  /\b(latest|most recent|recent|today|current|up-to-date|newest|breaking)\b/i,
  /\b(news|update|updates)\b/i,
  /(?:\u6700\u65b0|\u6700\u8fd1|\u4eca\u5929|\u5f53\u524d|\u8fd1\u671f|\u52a8\u6001|\u65b0\u95fb|\u8d44\u8baf)/,
];

const USER_WEB_CONTEXT_PATTERNS: RegExp[] = [
  /\b(web|internet|online|url|urls|link|links|website|article|source|sources|news)\b/i,
  /(?:\u7f51\u9875|\u7f51\u7ad9|\u7f51\u7edc|\u4e92\u8054\u7f51|\u94fe\u63a5|\u6765\u6e90|\u65b0\u95fb|\u62a5\u9053|\u6587\u7ae0)/,
];

const USER_RESEARCH_DEPTH_PATTERNS: RegExp[] = [
  /\b(research|investigate|analysis|analyze|compare|comparison|deep[-\s]?dive|survey|report|review)\b/i,
  /(?:\u8c03\u7814|\u7814\u7a76|\u5206\u6790|\u6df1\u5ea6|\u5bf9\u6bd4|\u5bf9\u7167|\u6c47\u603b|\u76d8\u70b9|\u62a5\u544a|\u8bc4\u4f30|\u8bc4\u6d4b)/,
];

const USER_MULTI_SOURCE_PATTERNS: RegExp[] = [
  /\b(multiple|multi-source|across sources|different sources)\b/i,
  /(?:\u591a\u6765\u6e90|\u591a\u4e2a\u6765\u6e90|\u4e0d\u540c\u6765\u6e90|\u591a\u7f51\u7ad9)/,
  /(?:\u81f3\u5c11|\u4e0d\u5c11\u4e8e|\u6700\u5c11)\s*\d+\s*(?:\u4e2a|\u6761)?(?:\u6765\u6e90|\u94fe\u63a5|\u7f51\u5740|\u7f51\u9875|\u6587\u7ae0)/,
];

const USER_WEB_BLOCK_PATTERNS: RegExp[] = [
  /\b(do not|don't|no|without)\s+(browse|web|internet|web_search|web_fetch|fetch)\b/i,
  /\bonly\b.*\b(snippet|snippets)\b/i,
  /(?:\u4e0d\u8981|\u4e0d\u9700)\s*(?:\u8054\u7f51|\u6293\u53d6|\u641c\u7d22|\u83b7\u53d6\u7f51\u9875|web_fetch|web_search)/,
  /(?:\u4ec5|\u53ea).*(?:snippet|\u6458\u8981)/i,
];

const ASSISTANT_WEB_CLAIM_PATTERNS: RegExp[] = [
  /\b(according to|reported by|as reported|source|sources|citation|cited|press release)\b/i,
  /\b(reuters|bloomberg|associated press|ap news|financial times|wall street journal)\b/i,
  /(?:\u636e[^。\n]{0,24}(?:\u62a5\u9053|\u663e\u793a|\u79f0)|\u6765\u6e90|\u62a5\u9053\u79f0|\u516c\u544a|\u53d1\u5e03|\u5ba3\u5e03)/,
];

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  if (!text.trim()) return false;
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeMinFetchSuccess(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(4, Math.floor(raw)));
}

function extractExplicitMinFetchFromPrompt(prompt: string): number | null {
  const patterns: RegExp[] = [
    /\b(?:at least|minimum of|no less than)\s*(\d+)\s*(?:sources?|links?|urls?|articles?|pages?)\b/i,
    /(?:\u81f3\u5c11|\u4e0d\u5c11\u4e8e|\u6700\u5c11)\s*(\d+)\s*(?:\u4e2a|\u6761)?(?:\u6765\u6e90|\u94fe\u63a5|\u7f51\u5740|\u7f51\u9875|\u6587\u7ae0)/,
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) continue;
    return normalizeMinFetchSuccess(parsed);
  }

  return null;
}

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
    searchNeedsFollowupFetch: false,
    fetchCalls: 0,
    fetchSuccess: 0,
  };
  let pendingSearchWithResults = false;

  for (const record of records) {
    const toolName = record.toolName.trim().toLowerCase();

    if (toolName === "web_search") {
      usage.searchCalls += 1;
      if (isSuccessfulExecution(record)) {
        usage.searchSuccess += 1;
        if (getSearchResultCount(record.details) > 0) {
          usage.searchSuccessWithResults += 1;
          pendingSearchWithResults = true;
        }
      }
      continue;
    }

    if (toolName === "web_fetch") {
      usage.fetchCalls += 1;
      if (isSuccessfulExecution(record)) {
        usage.fetchSuccess += 1;
        pendingSearchWithResults = false;
      }
    }
  }

  usage.searchNeedsFollowupFetch = pendingSearchWithResults;
  return usage;
}

export function shouldEnforceWebFetchAfterSearch(params: {
  usage: WebToolUsage;
  webSearchAvailable: boolean;
  webFetchAvailable: boolean;
  requiredMinFetchSuccess?: number;
}): boolean {
  const {
    usage,
    webSearchAvailable,
    webFetchAvailable,
    requiredMinFetchSuccess = 1,
  } = params;

  if (!webSearchAvailable || !webFetchAvailable) return false;
  if (usage.searchSuccessWithResults <= 0) return false;
  if (usage.fetchSuccess <= 0) return true;
  if (usage.searchNeedsFollowupFetch) return true;
  if (usage.fetchSuccess < normalizeMinFetchSuccess(requiredMinFetchSuccess)) return true;

  return false;
}

export function resolveWebFetchRequirementFromPrompt(prompt: string): WebFetchRequirement {
  const normalizedPrompt = prompt ?? "";
  const promptSuggestsResearchDepth = hasAnyPattern(
    normalizedPrompt,
    USER_RESEARCH_DEPTH_PATTERNS,
  );
  const multiSourceCue = hasAnyPattern(normalizedPrompt, USER_MULTI_SOURCE_PATTERNS);
  const explicitMinFetchFromPrompt = extractExplicitMinFetchFromPrompt(normalizedPrompt);

  let requiredMinFetchSuccess = 1;
  if (promptSuggestsResearchDepth) requiredMinFetchSuccess = 2;
  if (multiSourceCue) requiredMinFetchSuccess = Math.max(requiredMinFetchSuccess, 2);
  if (explicitMinFetchFromPrompt !== null) {
    requiredMinFetchSuccess = Math.max(
      requiredMinFetchSuccess,
      explicitMinFetchFromPrompt,
    );
  }

  return {
    requiredMinFetchSuccess: normalizeMinFetchSuccess(requiredMinFetchSuccess),
    promptSuggestsResearchDepth,
    multiSourceCue,
    explicitMinFetchFromPrompt,
  };
}

export function analyzeCrossTurnWebFetchNeed(params: {
  usage: WebToolUsage;
  webFetchAvailable: boolean;
  userPrompt: string;
  assistantText: string;
}): CrossTurnWebFetchGuardAnalysis {
  const userPrompt = params.userPrompt ?? "";
  const assistantText = params.assistantText ?? "";

  const explicitFetchRequest = hasAnyPattern(
    userPrompt,
    USER_EXPLICIT_FETCH_PATTERNS,
  );
  const userProvidesUrl = URL_PATTERN.test(userPrompt);
  const freshnessCue = hasAnyPattern(userPrompt, USER_FRESHNESS_PATTERNS);
  const webCue = userProvidesUrl || hasAnyPattern(userPrompt, USER_WEB_CONTEXT_PATTERNS);
  const userNeedsFreshWebEvidence =
    explicitFetchRequest || userProvidesUrl || (freshnessCue && webCue);
  const userBlocksWebFetch = hasAnyPattern(userPrompt, USER_WEB_BLOCK_PATTERNS);
  const assistantHasWebClaimSignal =
    URL_PATTERN.test(assistantText) ||
    hasAnyPattern(assistantText, ASSISTANT_WEB_CLAIM_PATTERNS);

  const shouldEnforce =
    params.webFetchAvailable &&
    params.usage.fetchCalls === 0 &&
    params.usage.fetchSuccess === 0 &&
    !userBlocksWebFetch &&
    userNeedsFreshWebEvidence &&
    (explicitFetchRequest || userProvidesUrl || assistantHasWebClaimSignal);

  return {
    shouldEnforce,
    explicitFetchRequest,
    userProvidesUrl,
    freshnessCue,
    webCue,
    userNeedsFreshWebEvidence,
    userBlocksWebFetch,
    assistantHasWebClaimSignal,
  };
}
