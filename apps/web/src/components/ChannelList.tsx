'use client'

import { useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canDeleteChannel, type Role } from '@repo/permissions'

type Channel = { id: string; name: string }
type ContextMenu = { channelId: string; channelName: string; top: number; left: number }
type DeleteConfirm = { channelId: string; channelName: string; top: number; left: number }

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
      <path d="M6 7l1 12.5A2 2 0 0 0 9 21.5h6a2 2 0 0 0 2-2L18 7" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

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
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null)

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
    setDeleteConfirm(null)
    setError('')
    const response = await fetch(`/api/servers/${serverId}/channels/${channelId}`, { method: 'DELETE' })
    if (response.ok) {
      onChannelsChanged()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  function openContextMenu(e: React.MouseEvent, channel: Channel) {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({ channelId: channel.id, channelName: channel.name, top: rect.top, left: rect.right + 8 })
  }

  return (
    <div className="flex w-56 flex-col gap-2 border-r border-hairline bg-surface p-4">
      <h3 className="font-display text-sm font-semibold tracking-tight text-text-muted uppercase">Channels</h3>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {channels.map((channel) => (
          <li key={channel.id}>
            <button
              onClick={() => onSelectChannel(channel.id)}
              onContextMenu={canDeleteChannel(role) ? (e) => openContextMenu(e, channel) : undefined}
              className={`w-full truncate rounded-lg p-1.5 text-left text-sm font-medium transition-colors ${selectedChannelId === channel.id ? 'bg-surface-raised text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'}`}
            >
              <span className="text-text-muted">#</span> {channel.name}
            </button>
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

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-xl"
            style={{ top: Math.min(contextMenu.top, window.innerHeight - 110), left: contextMenu.left }}
          >
            <div className="truncate px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">#{contextMenu.channelName}</div>
            <button
              onClick={() => {
                const { channelId, channelName, top, left } = contextMenu
                setContextMenu(null)
                setDeleteConfirm({ channelId, channelName, top, left })
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
            >
              <TrashIcon className="h-4 w-4" /> Delete Channel
            </button>
          </div>
        </>
      )}

      {deleteConfirm && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDeleteConfirm(null)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-hairline bg-surface p-4 shadow-xl"
            style={{ top: Math.min(deleteConfirm.top, window.innerHeight - 170), left: deleteConfirm.left }}
          >
            <h3 className="font-display text-sm font-semibold tracking-tight text-text">Delete #{deleteConfirm.channelName}?</h3>
            <p className="mt-2 text-xs text-text-muted">This cannot be undone. All messages in this channel will be permanently deleted.</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-hairline p-2 text-sm font-medium text-text transition-colors hover:bg-surface-raised">
                Cancel
              </button>
              <button onClick={() => deleteChannel(deleteConfirm.channelId)} className="flex-1 rounded-lg bg-danger p-2 text-sm font-medium text-white transition-colors hover:bg-danger/90">
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
