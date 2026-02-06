import { createHashRouter, RouterProvider } from 'react-router-dom'
import Layout from './pages/layout'
import HomePage from './pages/home'
import ToolsPage from './pages/tools'
import SkillsPage from './pages/skills'
import CronsPage from './pages/crons'

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'chat' },
      { path: 'tools', element: <ToolsPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'crons', element: <CronsPage /> },
    ],
  },
])

export default function App() {
  return <RouterProvider router={router} />
}
