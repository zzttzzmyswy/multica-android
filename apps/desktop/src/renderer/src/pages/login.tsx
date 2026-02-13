/**
 * Login Page - Shown when user is not authenticated
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@multica/ui/components/ui/button'
import { Loading } from '@multica/ui/components/ui/loading'
import { MulticaIcon } from '@multica/ui/components/multica-icon'
import { useAuthStore } from '../stores/auth'

export default function LoginPage() {
  const navigate = useNavigate()
  const { startLogin, isLoading, isAuthenticated } = useAuthStore()

  // Redirect to home when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      console.log('[LoginPage] Authenticated, redirecting to home...')
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, navigate])

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loading className="size-6" />
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background p-8 animate-in fade-in duration-300">
      <div className="w-full max-w-sm flex flex-col items-center text-center space-y-6">
        {/* Brand */}
        <div className="flex items-center gap-2">
          <MulticaIcon bordered animate size="md" />
          <h1 className="text-lg tracking-wide font-brand">Multica</h1>
        </div>

        {/* Tagline */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          An AI assistant that gets things done.
        </p>

        {/* Sign In */}
        <Button onClick={startLogin} size="lg" className="px-8">
          Sign In to Continue
        </Button>

        {/* Helper */}
        <p className="text-xs text-muted-foreground/60">
          Opens browser for authentication
        </p>
      </div>
    </div>
  )
}
