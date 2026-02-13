import { LoginForm } from './login-form'

// Disable static prerendering - LoginForm uses useSearchParams
export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
      <LoginForm />
    </div>
  )
}
