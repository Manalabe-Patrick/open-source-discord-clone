'use client'

import { useEffect, useState } from 'react'
import { PresenceDot } from '@/components/PresenceDot'
import { Avatar } from '@/components/Avatar'
import { UserProfilePopover } from '@/components/UserProfilePopover'
import { getSocket } from '@/lib/socket'

type Conversation = { id: string; otherUser: { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' } }
type Anchor = { top: number; left: number }

export function DMSidebar({
  currentUserId,
  activeOtherUserId,
  onSelect,
  onMessageUser,
  refreshKey,
}: {
  currentUserId: string
  activeOtherUserId: string | null
  onSelect: (otherUserId: string, otherUserName: string | null) => void
  onMessageUser: (userId: string, name: string | null) => void
  refreshKey: number
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [profilePopover, setProfilePopover] = useState<{ userId: string; anchor: Anchor } | null>(null)

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

  useEffect(() => {
    const socket = getSocket()
    function handleProfileUpdate({ userId, name, image }: { userId: string; name: string | null; image: string | null }) {
      setConversations((prev) => prev.map((c) => (c.otherUser.id === userId ? { ...c, otherUser: { ...c.otherUser, name, image } } : c)))
    }
    socket.on('profile:update', handleProfileUpdate)
    return () => {
      socket.off('profile:update', handleProfileUpdate)
    }
  }, [])

  return (
    <aside className="flex w-64 flex-col gap-2 border-r border-hairline bg-surface p-4">
      <h2 className="font-display text-lg font-semibold tracking-tight text-text">Direct Messages</h2>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {conversations.map((conversation) => (
          <li key={conversation.id} role="group" className={`flex items-center gap-1 rounded-lg text-sm font-medium transition-colors ${activeOtherUserId === conversation.otherUser.id ? 'bg-surface-raised text-text' : 'text-text-muted hover:bg-surface-raised hover:text-text'}`}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                const rect = e.currentTarget.getBoundingClientRect()
                setProfilePopover({ userId: conversation.otherUser.id, anchor: { top: rect.top, left: rect.right + 12 } })
              }}
              aria-label={`View ${conversation.otherUser.name ?? 'Unknown'}'s profile`}
              className="shrink-0 pl-2"
            >
              <Avatar name={conversation.otherUser.name} image={conversation.otherUser.image} size="h-6 w-6" textSize="text-xs" />
            </button>
            <button onClick={() => onSelect(conversation.otherUser.id, conversation.otherUser.name)} className="flex min-w-0 flex-1 items-center gap-2 p-2 pl-1 text-left">
              <PresenceDot status={conversation.otherUser.status} />
              <span className="truncate">{conversation.otherUser.name ?? 'Unknown'}</span>
            </button>
          </li>
        ))}
        {conversations.length === 0 && <p className="text-xs text-text-muted">No conversations yet — message someone from a server&apos;s member list.</p>}
      </ul>
      {profilePopover && (
        <UserProfilePopover
          userId={profilePopover.userId}
          anchor={profilePopover.anchor}
          currentUserId={currentUserId}
          onClose={() => setProfilePopover(null)}
          onMessageUser={onMessageUser}
        />
      )}
    </aside>
  )
}
