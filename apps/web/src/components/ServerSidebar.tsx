'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type Server = { id: string; name: string }

export function ServerSidebar({
  servers,
  activeServerId,
  onSelect,
  onCreated,
  onLeft,
}: {
  servers: Server[]
  activeServerId: string | null
  onSelect: (serverId: string) => void
  onCreated: (server: Server) => void
  onLeft: (serverId: string) => void
}) {
  const [name, setName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [error, setError] = useState('')
  const [leaveError, setLeaveError] = useState('')

  async function createServer() {
    if (!name.trim()) return
    setError('')
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      const server = await response.json()
      onCreated(server)
      setName('')
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  async function joinServer() {
    if (!joinId.trim()) return
    setError('')
    const response = await fetch(`/api/servers/${joinId}/join`, { method: 'POST' })
    if (response.ok) {
      window.location.reload()
    } else {
      setError(await parseErrorResponse(response))
    }
    setJoinId('')
  }

  async function leaveServer(serverId: string) {
    setLeaveError('')
    const response = await fetch(`/api/servers/${serverId}/leave`, { method: 'POST' })
    if (response.ok) {
      onLeft(serverId)
    } else {
      setLeaveError(await parseErrorResponse(response))
    }
  }

  return (
    <aside className="flex w-60 flex-col gap-2 border-r p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-bold">Servers</h2>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="rounded border p-1 text-sm"
        >
          Log out
        </button>
      </div>
      <ul className="flex flex-col gap-1">
        {servers.map((server) => (
          <li key={server.id} className="flex items-center gap-1">
            <button
              onClick={() => onSelect(server.id)}
              className={`w-full rounded p-2 text-left ${activeServerId === server.id ? 'bg-indigo-100' : ''}`}
            >
              {server.name}
            </button>
            {activeServerId === server.id && (
              <button
                onClick={() => leaveServer(server.id)}
                className="rounded border p-1 text-xs whitespace-nowrap"
                title="Leave server"
              >
                Leave
              </button>
            )}
          </li>
        ))}
      </ul>
      {leaveError && <p className="text-xs text-red-500">{leaveError}</p>}
      <div className="mt-4 flex flex-col gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New server name" className="rounded border p-1 text-sm" />
        <button onClick={createServer} className="rounded bg-indigo-600 p-1 text-sm text-white">Create server</button>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Server ID to join" className="rounded border p-1 text-sm" />
        <button onClick={joinServer} className="rounded border p-1 text-sm">Join server</button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </aside>
  )
}
