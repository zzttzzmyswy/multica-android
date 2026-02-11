import { useEffect } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { ThemeProvider } from './components/theme-provider'
import Layout from './pages/layout'
import HomePage from './pages/home'
import ChatPage from './pages/chat'
import ToolsPage from './pages/tools'
import SkillsPage from './pages/skills'
import ChannelsPage from './pages/channels'
import CronsPage from './pages/crons'
import OnboardingPage from './pages/onboarding'
import { useOnboardingStore } from './stores/onboarding'
import { useProviderStore } from './stores/provider'
import { useChannelsStore } from './stores/channels'

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const completed = useOnboardingStore((s) => s.completed)
  const forceOnboarding = useOnboardingStore((s) => s.forceOnboarding)
  if (!completed || forceOnboarding) return <Navigate to="/onboarding" replace />
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
      { path: 'tools', element: <ToolsPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'channels', element: <ChannelsPage /> },
      { path: 'crons', element: <CronsPage /> },
    ],
  },
])

export default function App() {
  useEffect(() => {
    useOnboardingStore.getState().initForceFlag()
    // Prefetch global data at app startup
    useProviderStore.getState().fetch()
    useChannelsStore.getState().fetch()
  }, [])

  return (
    <ThemeProvider defaultTheme="system" storageKey="multica-theme">
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
