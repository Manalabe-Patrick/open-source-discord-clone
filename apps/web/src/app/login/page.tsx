'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { AuthLayout, AuthLink, FormField, EyeIcon, EyeOffIcon, GoogleIcon } from '@/components/AuthLayout'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.ok) {
      router.push('/')
    } else {
      setError('Invalid email or password')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      headline="Everyone's already here."
      tagline="Your servers, your DMs, your people — right where you left them."
      title="Welcome back"
      subtitle="Log in to pick up where you left off."
      error={error}
      footer={
        <>
          Don&apos;t have an account? <AuthLink href="/signup">Sign up</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} method="post" className="flex flex-col gap-4">
        <FormField id="email" label="Email">
          <input
            id="email"
            name="email"
            type="email"
            placeholder="you@example.com"
            required
            className="rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 outline-none transition-colors focus:border-accent"
          />
        </FormField>
        <FormField id="password" label="Password">
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              required
              className="w-full rounded-xl border border-hairline bg-surface px-3.5 py-2.5 pr-10 text-sm text-text placeholder:text-text-muted/60 outline-none transition-colors focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-text-muted transition-colors hover:text-text"
            >
              {showPassword ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            </button>
          </div>
        </FormField>
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white transition-all hover:bg-accent-hover active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <div className="flex items-center gap-3 text-xs font-medium text-text-muted">
          <span className="h-px flex-1 bg-hairline" />
          or
          <span className="h-px flex-1 bg-hairline" />
        </div>
        <button
          type="button"
          onClick={() => signIn('google', { callbackUrl: '/' })}
          className="flex items-center justify-center gap-2 rounded-xl border border-hairline bg-surface py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-raised"
        >
          <GoogleIcon className="h-4 w-4" /> Continue with Google
        </button>
      </form>
    </AuthLayout>
  )
}
