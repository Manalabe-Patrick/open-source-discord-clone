'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

export default function SignupPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

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
      return
    }

    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.ok) {
      router.push('/')
    } else {
      setError('Account created, but login failed. Try logging in manually.')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="flex w-80 flex-col gap-3">
        <h1 className="text-xl font-bold">Sign up</h1>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <input name="name" placeholder="Name" required className="rounded border p-2" />
        <input name="email" type="email" placeholder="Email" required className="rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required minLength={8} className="rounded border p-2" />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-white">Sign up</button>
      </form>
    </main>
  )
}
