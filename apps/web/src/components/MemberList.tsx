'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canKickMember, type Role } from '@repo/permissions'
import { PresenceDot } from '@/components/PresenceDot'
import { Avatar } from '@/components/Avatar'
import { UserProfilePopover } from '@/components/UserProfilePopover'

type Member = { id: string; name: string | null; image: string | null; role: Role; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }
type Anchor = { top: number; left: number }
type ContextMenu = { memberId: string; memberName: string | null; canMessage: boolean; canKick: boolean; top: number; left: number }

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.076-.16-3.02-.455L3 21l1.5-4.5C3.55 15.07 3 13.585 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
    </svg>
  )
}

function KickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="7" r="3.25" />
      <path d="M3.5 19c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
      <path d="M15.5 6.5l5 5M20.5 6.5l-5 5" />
    </svg>
  )
}

export function MemberList({ serverId, role, currentUserId, onMessageMember }: { serverId: string; role: Role; currentUserId: string; onMessageMember: (userId: string, name: string | null) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [profilePopover, setProfilePopover] = useState<{ userId: string; anchor: Anchor } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)

  function openProfile(e: React.MouseEvent<HTMLButtonElement>, userId: string) {
    const rect = e.currentTarget.getBoundingClientRect()
    setProfilePopover({ userId, anchor: { top: rect.top, left: rect.right + 12 } })
  }

  async function loadMembers() {
    const response = await fetch(`/api/servers/${serverId}/members`)
    if (response.ok) {
      setMembers(await response.json())
    }
  }

  useEffect(() => {
    let cancelled = false

    async function initialLoad() {
      const response = await fetch(`/api/servers/${serverId}/members`)
      if (response.ok && !cancelled) {
        setMembers(await response.json())
      }
    }
    initialLoad()

    const socket = getSocket()
    function handlePresenceUpdate({ userId, status }: { userId: string; status: Member['status'] }) {
      setMembers((prev) => prev.map((member) => (member.id === userId ? { ...member, status } : member)))
    }
    function handleProfileUpdate({ userId, name, image }: { userId: string; name: string | null; image: string | null }) {
      setMembers((prev) => prev.map((member) => (member.id === userId ? { ...member, name, image } : member)))
    }
    socket.on('presence:update', handlePresenceUpdate)
    socket.on('profile:update', handleProfileUpdate)

    return () => {
      cancelled = true
      socket.off('presence:update', handlePresenceUpdate)
      socket.off('profile:update', handleProfileUpdate)
    }
  }, [serverId])

  async function kickMember(memberId: string) {
    setContextMenu(null)
    setError('')
    const response = await fetch(`/api/servers/${serverId}/members/${memberId}`, { method: 'DELETE' })
    if (response.ok) {
      loadMembers()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  function openContextMenu(e: React.MouseEvent, member: Member) {
    const canMessage = member.id !== currentUserId
    const canKick = canKickMember(role) && member.role !== 'OWNER' && member.id !== currentUserId
    if (!canMessage && !canKick) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({
      memberId: member.id,
      memberName: member.name,
      canMessage,
      canKick,
      top: rect.top,
      left: Math.max(8, Math.min(rect.right + 8, window.innerWidth - 216)),
    })
  }

  return (
    <aside className="flex w-56 flex-col gap-1 border-l border-hairline bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-text-muted uppercase">Members</h3>
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm text-text" onContextMenu={(e) => openContextMenu(e, member)}>
            <button onClick={(e) => openProfile(e, member.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <div className="relative shrink-0">
                <Avatar name={member.name} image={member.image} size="h-7 w-7" textSize="text-xs" />
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-surface">
                  <PresenceDot status={member.status} title={member.status} />
                </span>
              </div>
              <span className="truncate">{member.name ?? 'Unknown'}</span>
            </button>
            {member.role !== 'MEMBER' && <span className="shrink-0 font-mono text-[10px] text-text-muted">{member.role}</span>}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-xl"
            style={{ top: Math.min(contextMenu.top, window.innerHeight - 110), left: contextMenu.left }}
          >
            <div className="truncate px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{contextMenu.memberName ?? 'Unknown'}</div>
            {contextMenu.canMessage && (
              <button
                onClick={() => {
                  const { memberId, memberName } = contextMenu
                  setContextMenu(null)
                  onMessageMember(memberId, memberName)
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-raised"
              >
                <MessageIcon className="h-4 w-4" /> Message
              </button>
            )}
            {contextMenu.canKick && (
              <button onClick={() => kickMember(contextMenu.memberId)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10">
                <KickIcon className="h-4 w-4" /> Kick Member
              </button>
            )}
          </div>
        </>
      )}
      {profilePopover && (
        <UserProfilePopover
          userId={profilePopover.userId}
          anchor={profilePopover.anchor}
          currentUserId={currentUserId}
          onClose={() => setProfilePopover(null)}
          onMessageUser={onMessageMember}
        />
      )}
    </aside>
  )
}
