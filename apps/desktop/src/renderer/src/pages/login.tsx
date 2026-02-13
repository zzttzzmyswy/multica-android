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
    <div className="flex h-screen flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-xs space-y-6">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2">
          <MulticaIcon bordered noSpin size="md" />
          <span className="text-base font-brand">Multica</span>
        </div>

        {/* Sign In */}
        <div className="space-y-4 text-center">
          <p className="text-base text-muted-foreground">Sign in to continue</p>
          <Button onClick={startLogin} className="w-full" size="lg">
            Sign In
          </Button>
        </div>

        {/* Helper */}
        <p className="text-center text-xs text-muted-foreground/60">
          Opens browser for authentication
        </p>
      </div>
    </div>
  )
}
