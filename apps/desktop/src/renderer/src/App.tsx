import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import Layout from './pages/layout'
import HomePage from './pages/home'
import ChatPage from './pages/chat'
import ToolsPage from './pages/tools'
import SkillsPage from './pages/skills'
import ChannelsPage from './pages/channels'
import CronsPage from './pages/crons'
import OnboardingLayout from './pages/onboarding/layout'
import PermissionsStep from './pages/onboarding/permissions'
import SetupStep from './pages/onboarding/setup'
import TryItStep from './pages/onboarding/try-it'
import ConnectStep from './pages/onboarding/connect'
import { useOnboardingStore } from './stores/onboarding'

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const completed = useOnboardingStore((s) => s.completed)
  if (!completed) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

const router = createHashRouter([
  {
    path: '/onboarding',
    element: <OnboardingLayout />,
    children: [
      { index: true, element: <PermissionsStep /> },
      { path: 'setup', element: <SetupStep /> },
      { path: 'connect', element: <ConnectStep /> },
      { path: 'try-it', element: <TryItStep /> },
    ],
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
  return <RouterProvider router={router} />
}
