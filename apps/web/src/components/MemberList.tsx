'use client'

import { useEffect, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { canKickMember, type Role } from '@repo/permissions'

type Member = { id: string; name: string | null; image: string | null; role: Role; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }

const STATUS_COLOR: Record<Member['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
}

export function MemberList({ serverId, role, currentUserId, onMessageMember }: { serverId: string; role: Role; currentUserId: string; onMessageMember: (userId: string, name: string | null) => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')

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
    socket.on('presence:update', handlePresenceUpdate)

    return () => {
      cancelled = true
      socket.off('presence:update', handlePresenceUpdate)
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
    <aside className="flex w-48 flex-col gap-1 border-l p-3">
      <h3 className="font-bold">Members</h3>
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-2 text-sm">
            <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[member.status]}`} title={member.status} />
            <span>{member.name ?? 'Unknown'}</span>
            {member.role !== 'MEMBER' && <span className="text-xs text-gray-500">({member.role})</span>}
            {member.id !== currentUserId && (
              <button onClick={() => onMessageMember(member.id, member.name)} className="rounded border p-1 text-xs" title="Send a direct message">
                Message
              </button>
            )}
            {canKickMember(role) && member.role !== 'OWNER' && (
              <button onClick={() => kickMember(member.id)} className="ml-auto rounded border p-1 text-xs" title="Kick member">
                Kick
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </aside>
  )
}
