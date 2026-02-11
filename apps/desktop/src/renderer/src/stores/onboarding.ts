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
  currentStep: number
  acknowledgements: AcknowledgementsState
  allAcknowledged: boolean
  providerConfigured: boolean
  clientConnected: boolean
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  setAcknowledgement: (key: keyof AcknowledgementsState, value: boolean) => void
  setProviderConfigured: (configured: boolean) => void
  setClientConnected: (connected: boolean) => void
  completeOnboarding: () => void
}

export const useOnboardingStore = create<OnboardingStore>()(
  persist(
    (set, get) => ({
      completed: false,
      currentStep: 0,

      acknowledgements: {
        fileSystem: false,
        shellExecution: false,
        llmRequests: false,
        localStorage: false,
      },
      allAcknowledged: false,
      providerConfigured: false,
      clientConnected: false,

      setStep: (step) => set({ currentStep: step }),
      nextStep: () => set({ currentStep: Math.min(get().currentStep + 1, 4) }),
      prevStep: () => set({ currentStep: Math.max(get().currentStep - 1, 0) }),

      setAcknowledgement: (key, value) => {
        const acknowledgements = { ...get().acknowledgements, [key]: value }
        const allAcknowledged = Object.values(acknowledgements).every(Boolean)
        set({ acknowledgements, allAcknowledged })
      },

      setProviderConfigured: (configured) => set({ providerConfigured: configured }),

      setClientConnected: (connected) => set({ clientConnected: connected }),

      completeOnboarding: () => set({ completed: true, currentStep: 0 }),
    }),
    {
      name: 'multica-onboarding',
      partialize: (state) => ({ completed: state.completed }),
    }
  )
)
