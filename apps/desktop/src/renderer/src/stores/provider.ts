import { create } from 'zustand'

interface ProviderStore {
  // State
  providers: ProviderStatus[]
  current: CurrentProviderInfo | null
  loading: boolean
  error: string | null
  initialized: boolean

  // Actions
  fetch: () => Promise<void>
  setProvider: (providerId: string, modelId?: string) => Promise<{ ok: boolean; error?: string }>
  refresh: () => Promise<void>
}

export const useProviderStore = create<ProviderStore>()((set, get) => ({
  providers: [],
  current: null,
  loading: false,
  error: null,
  initialized: false,

  fetch: async () => {
    // Skip if already initialized
    if (get().initialized) return

    set({ loading: true, error: null })

    try {
      const [providerList, currentInfo] = await Promise.all([
        window.electronAPI.provider.list(),
        window.electronAPI.provider.current(),
      ])

      set({
        providers: providerList,
        current: currentInfo,
        initialized: true,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      console.error('[ProviderStore] Failed to load providers:', message)
    } finally {
      set({ loading: false })
    }
  },

  refresh: async () => {
    set({ loading: true, error: null })

    try {
      const [providerList, currentInfo] = await Promise.all([
        window.electronAPI.provider.list(),
        window.electronAPI.provider.current(),
      ])

      set({
        providers: providerList,
        current: currentInfo,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      console.error('[ProviderStore] Failed to refresh providers:', message)
    } finally {
      set({ loading: false })
    }
  },

  setProvider: async (providerId: string, modelId?: string) => {
    set({ error: null })

    try {
      const result = await window.electronAPI.provider.set(providerId, modelId)

      if (result.ok) {
        // Refresh to update current status
        await get().refresh()
        return { ok: true }
      } else {
        set({ error: result.error ?? 'Unknown error' })
        return { ok: false, error: result.error }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      return { ok: false, error: message }
    }
  },
}))
