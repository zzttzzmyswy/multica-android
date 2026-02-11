/**
 * Hook for managing LLM providers in the Desktop App.
 *
 * Uses the global ProviderStore for state management.
 * Data is fetched once at app startup and shared across all components.
 */
import { useCallback } from 'react'
import { useProviderStore } from '../stores/provider'

interface UseProviderReturn {
  /** All providers with their status */
  providers: ProviderStatus[]
  /** Only available (configured) providers */
  availableProviders: ProviderStatus[]
  /** Current provider and model info */
  current: CurrentProviderInfo | null
  /** Loading state */
  loading: boolean
  /** Error message if any */
  error: string | null
  /** Refresh provider list and current status */
  refresh: () => Promise<void>
  /** Switch to a different provider (and optionally model) */
  setProvider: (providerId: string, modelId?: string) => Promise<{ ok: boolean; error?: string }>
  /** Get metadata for a specific provider */
  getProviderMeta: (providerId: string) => ProviderStatus | undefined
}

export function useProvider(): UseProviderReturn {
  const {
    providers,
    current,
    loading,
    error,
    refresh,
    setProvider,
  } = useProviderStore()

  const availableProviders = providers.filter((p) => p.available)

  const getProviderMeta = useCallback(
    (providerId: string) => {
      return providers.find((p) => p.id === providerId)
    },
    [providers]
  )

  return {
    providers,
    availableProviders,
    current,
    loading,
    error,
    refresh,
    setProvider,
    getProviderMeta,
  }
}
