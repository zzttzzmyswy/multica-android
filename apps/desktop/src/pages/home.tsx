import { useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen items-center justify-center">
      <Button onClick={() => navigate('/chat')}>Open Chat</Button>
    </div>
  )
}
