'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'

export default function LoginPage() {
  const router = useRouter()
  const [error, setError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const result = await signIn('credentials', { email, password, redirect: false })
    if (result?.ok) {
      router.push('/')
    } else {
      setError('Invalid email or password')
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="flex w-80 flex-col gap-3">
        <h1 className="text-xl font-bold">Log in</h1>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <input name="email" type="email" placeholder="Email" required className="rounded border p-2" />
        <input name="password" type="password" placeholder="Password" required className="rounded border p-2" />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-white">Log in</button>
        <button type="button" onClick={() => signIn('google')} className="rounded border p-2">
          Continue with Google
        </button>
      </form>
    </main>
  )
}
