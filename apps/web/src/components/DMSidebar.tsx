'use client'

import { useEffect, useState } from 'react'

type Conversation = { id: string; otherUser: { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' } }

const STATUS_COLOR: Record<Conversation['otherUser']['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function DMSidebar({
  activeOtherUserId,
  onSelect,
  refreshKey,
}: {
  activeOtherUserId: string | null
  onSelect: (otherUserId: string, otherUserName: string | null) => void
  refreshKey: number
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const response = await fetch('/api/dms')
      if (response.ok && !cancelled) {
        setConversations(await response.json())
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <aside className="flex w-60 flex-col gap-2 border-r p-3">
      <h2 className="font-bold">Direct Messages</h2>
      <ul className="flex flex-col gap-1">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              onClick={() => onSelect(conversation.otherUser.id, conversation.otherUser.name)}
              className={`flex w-full items-center gap-2 rounded p-2 text-left ${activeOtherUserId === conversation.otherUser.id ? 'bg-indigo-100' : ''}`}
            >
              <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[conversation.otherUser.status]}`} />
              {conversation.otherUser.name ?? 'Unknown'}
            </button>
          </li>
        ))}
        {conversations.length === 0 && <p className="text-xs text-gray-500">No conversations yet — message someone from a server&apos;s member list.</p>}
      </ul>
    </aside>
  )
}
