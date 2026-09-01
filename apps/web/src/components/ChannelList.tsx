'use client'

import { useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canDeleteChannel, type Role } from '@repo/permissions'

type Channel = { id: string; name: string }

export function ChannelList({
  serverId,
  role,
  channels,
  selectedChannelId,
  onSelectChannel,
  onChannelsChanged,
}: {
  serverId: string
  role: Role
  channels: Channel[]
  selectedChannelId: string | null
  onSelectChannel: (channelId: string) => void
  onChannelsChanged: () => void
}) {
  const [name, setName] = useState('')
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

  async function deleteChannel(channelId: string) {
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels/${channelId}`, { method: 'DELETE' })
    if (response.ok) {
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex w-56 flex-col gap-2 border-r border-hairline bg-surface p-4">
      <h3 className="font-display text-sm font-semibold tracking-tight text-text-muted uppercase">Channels</h3>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {channels.map((channel) => (
          <li key={channel.id} className="flex items-center gap-1">
            <button
              onClick={() => onSelectChannel(channel.id)}
              className={`w-full truncate rounded-lg p-1.5 text-left text-sm font-medium transition-colors ${selectedChannelId === channel.id ? 'bg-surface-raised text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'}`}
            >
              <span className="text-text-muted">#</span> {channel.name}
            </button>
            {canDeleteChannel(role) && (
              <button
                onClick={() => deleteChannel(channel.id)}
                className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-danger hover:text-danger whitespace-nowrap"
                title="Delete channel"
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex flex-col gap-2 border-t border-hairline pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New channel name"
          className="rounded-lg border border-hairline bg-canvas p-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <button onClick={createChannel} className="rounded-lg border border-hairline p-2 text-sm font-medium text-text transition-colors hover:bg-surface-raised">
          Create channel
        </button>
      </div>
    </div>
  )
}
