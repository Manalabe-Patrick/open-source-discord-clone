'use client'

import { useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type Channel = { id: string; name: string }

export function ChannelList({
  serverId,
  channels,
  onChannelsChanged,
}: {
  serverId: string
  channels: Channel[]
  onChannelsChanged: () => void
}) {
  const [name, setName] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function createChannel() {
    if (!name.trim()) return
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      setName('')
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex w-52 flex-col gap-2 border-r p-3">
      <h3 className="font-bold"># Channels</h3>
      <ul className="flex flex-col gap-1">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              onClick={() => setSelectedChannel(channel.id)}
              className={`w-full rounded p-1 text-left text-sm ${selectedChannel === channel.id ? 'bg-indigo-100' : ''}`}
            >
              # {channel.name}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="mt-2 flex flex-col gap-1">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New channel name" className="rounded border p-1 text-sm" />
        <button onClick={createChannel} className="rounded border p-1 text-sm">Create channel</button>
      </div>
      {selectedChannel && (
        <p className="mt-4 text-xs text-gray-500">
          Chat UI for channel {selectedChannel} arrives in Phase 3.
        </p>
      )}
    </div>
  )
}
