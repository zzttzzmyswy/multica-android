import { createHashRouter, RouterProvider } from 'react-router-dom'
import HomePage from './pages/home'
import ChatPage from './pages/chat'

const router = createHashRouter([
  { path: '/', element: <HomePage /> },
  { path: '/chat', element: <ChatPage /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
