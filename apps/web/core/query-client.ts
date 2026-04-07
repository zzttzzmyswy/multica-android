import { QueryClient } from "@tanstack/react-query";

let _queryClient: QueryClient | null = null;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 10 * 60 * 1000, // 10 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** Called by QueryProvider on mount to register the singleton. */
export function setQueryClient(client: QueryClient) {
  _queryClient = client;
}

/** Access QueryClient outside React tree (WS handlers, Zustand actions). */
export function getQueryClient(): QueryClient {
  if (!_queryClient) throw new Error("QueryClient not initialized");
  return _queryClient;
}
