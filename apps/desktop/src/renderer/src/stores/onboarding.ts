import { create } from "zustand"
import { persist } from "zustand/middleware"

interface AcknowledgementsState {
  fileSystem: boolean
  shellExecution: boolean
  llmRequests: boolean
  localStorage: boolean
}

interface OnboardingStore {
  completed: boolean
  forceOnboarding: boolean
  acknowledgements: AcknowledgementsState
  allAcknowledged: boolean
  providerConfigured: boolean
  clientConnected: boolean
  setAcknowledgement: (key: keyof AcknowledgementsState, value: boolean) => void
  setProviderConfigured: (configured: boolean) => void
  setClientConnected: (connected: boolean) => void
  completeOnboarding: () => void
  initForceFlag: () => Promise<void>
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      completed: false,
      forceOnboarding: false,

      acknowledgements: {
        fileSystem: false,
        shellExecution: false,
        llmRequests: false,
        localStorage: false,
      },
      allAcknowledged: false,
      providerConfigured: false,
      clientConnected: false,

      setAcknowledgement: (key, value) => {
        const acknowledgements = { ...get().acknowledgements, [key]: value }
        const allAcknowledged = Object.values(acknowledgements).every(Boolean)
        set({ acknowledgements, allAcknowledged })
      },

      setProviderConfigured: (configured) => set({ providerConfigured: configured }),

      setClientConnected: (connected) => set({ clientConnected: connected }),

      completeOnboarding: () => set({ completed: true }),

      initForceFlag: async () => {
        const flags = await window.electronAPI.app.getFlags()
        if (flags.forceOnboarding) {
          set({ forceOnboarding: true })
        }
      },
    }),
    {
      name: 'multica-onboarding',
      partialize: (state) => ({ completed: state.completed }),
    }
  )
)
