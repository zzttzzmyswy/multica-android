import { useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'

export default function ChatPage() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold">Chat</h1>
      <Button variant="outline" onClick={() => navigate('/')}>
        Back to Home
      </Button>
    </div>
  )
}
