import { useEffect, useState } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import { TooltipProvider } from '@multica/ui/components/ui/tooltip'
import { Toaster } from './components/toaster'
import Layout from './pages/layout'
import HomePage from './pages/home'
import ChatPage from './pages/chat'
import ProfilePage from './pages/agent/profile'
import SkillsPage from './pages/agent/skills'
import ToolsPage from './pages/agent/tools'
import ClientsPage from './pages/clients'
import CronsPage from './pages/crons'
import OnboardingPage from './pages/onboarding'
import { useOnboardingStore } from './stores/onboarding'
import { useHubStore } from './stores/hub'
import { useProviderStore } from './stores/provider'
import { useChannelsStore } from './stores/channels'
import { useSkillsStore } from './stores/skills'
import { useToolsStore } from './stores/tools'
import { useCronJobsStore } from './stores/cron-jobs'

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const completed = useOnboardingStore((s) => s.completed)
  if (!completed) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

const router = createHashRouter([
  {
    path: '/onboarding',
    element: <OnboardingPage />,
  },
  {
    path: '/',
    element: <Layout />,
    children: [
      {
        index: true,
        element: (
          <OnboardingGuard>
            <HomePage />
          </OnboardingGuard>
        ),
      },
      { path: 'chat', element: <ChatPage /> },
      { path: 'agent/profile', element: <ProfilePage /> },
      { path: 'agent/skills', element: <SkillsPage /> },
      { path: 'agent/tools', element: <ToolsPage /> },
      { path: 'clients', element: <ClientsPage /> },
      { path: 'crons', element: <CronsPage /> },
    ],
  },
])

export default function App() {
  const [isHydrated, setIsHydrated] = useState(false)
  const setCompleted = useOnboardingStore((s) => s.setCompleted)

  useEffect(() => {
    async function hydrateOnboardingState() {
      try {
        const completed = await window.electronAPI.appState.getOnboardingCompleted()
        setCompleted(completed)
      } catch (err) {
        console.error('[App] Failed to load onboarding state:', err)
        setCompleted(false)
      } finally {
        setIsHydrated(true)
      }
    }

    hydrateOnboardingState()

    useHubStore.getState().init()
    useProviderStore.getState().fetch()
    useChannelsStore.getState().fetch()
    useSkillsStore.getState().fetch()
    useToolsStore.getState().fetch()
    useCronJobsStore.getState().fetch()
  }, [setCompleted])

  if (!isHydrated) {
    return (
      <ThemeProvider defaultTheme="system" storageKey="multica-theme">
        <div className="h-dvh bg-background" />
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider defaultTheme="system" storageKey="multica-theme">
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
