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

export function MemberList({ serverId, role, currentUserId, onMessageMember }: { serverId: string; role: Role; currentUserId: string; onMessageMember: (userId: string, name: string | null) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [profilePopover, setProfilePopover] = useState<{ userId: string; anchor: Anchor } | null>(null)

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
    setError('')
    const response = await fetch(`/api/servers/${serverId}/members/${memberId}`, { method: 'DELETE' })
    if (response.ok) {
      loadMembers()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <aside className="flex w-56 flex-col gap-1 border-l border-hairline bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold tracking-tight text-text-muted uppercase">Members</h3>
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 rounded-lg p-1.5 text-sm text-text">
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
            {member.id !== currentUserId && (
              <button onClick={() => onMessageMember(member.id, member.name)} className="shrink-0 rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text" title="Send a direct message">
                Message
              </button>
            )}
            {canKickMember(role) && member.role !== 'OWNER' && (
              <button onClick={() => kickMember(member.id)} className="ml-auto shrink-0 rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-danger hover:text-danger" title="Kick member">
                Kick
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-danger">{error}</p>}
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
