'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { AuthLayout, AuthLink, FormField, EyeIcon, EyeOffIcon } from '@/components/AuthLayout'

export default function SignupPage() {
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
    const name = formData.get('name') as string

    const response = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    })

    if (!response.ok) {
      setError(await parseErrorResponse(response))
      setSubmitting(false)
      return
    }

    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.ok) {
      router.push('/')
    } else {
      setError('Account created, but login failed. Try logging in manually.')
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      headline="Where your people hang out."
      tagline="Create a server or join one, and start talking in seconds."
      title="Create an account"
      subtitle="Join a server, message friends, and hang out."
      error={error}
      footer={
        <>
          Already have an account? <AuthLink href="/login">Log in</AuthLink>
        </>
      }
    >
      <form onSubmit={handleSubmit} method="post" className="flex flex-col gap-4">
        <FormField id="name" label="Name">
          <input
            id="name"
            name="name"
            placeholder="Your name"
            required
            className="rounded-xl border border-hairline bg-surface px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 outline-none transition-colors focus:border-accent"
          />
        </FormField>
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
              placeholder="At least 8 characters"
              required
              minLength={8}
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
          {submitting ? 'Creating account…' : 'Sign up'}
        </button>
      </form>
    </AuthLayout>
  )
}
