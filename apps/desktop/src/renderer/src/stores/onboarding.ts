import { create } from "zustand"

interface AcknowledgementsState {
  fileSystem: boolean
  shellExecution: boolean
  llmRequests: boolean
  localStorage: boolean
}

interface OnboardingStore {
  completed: boolean
  acknowledgements: AcknowledgementsState
  allAcknowledged: boolean
  providerConfigured: boolean
  clientConnected: boolean
  setAcknowledgement: (key: keyof AcknowledgementsState, value: boolean) => void
  setProviderConfigured: (configured: boolean) => void
  setClientConnected: (connected: boolean) => void
  completeOnboarding: () => void
}

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  completed: false,

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
}))
