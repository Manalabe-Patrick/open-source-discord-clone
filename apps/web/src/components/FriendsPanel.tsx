'use client'

import { useEffect, useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { PresenceDot } from '@/components/PresenceDot'

type UserInfo = { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }
type FriendsData = {
  friends: UserInfo[]
  incoming: { id: string; requester: UserInfo }[]
  outgoing: { id: string; addressee: UserInfo }[]
}

export function FriendsPanel({ onMessageFriend }: { onMessageFriend: (userId: string, name: string | null) => void }) {
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] })
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')

  async function loadFriends() {
    const response = await fetch('/api/friends')
    if (response.ok) {
      setData(await response.json())
    }
  }

  useEffect(() => {
    loadFriends()
  }, [])

  async function sendRequest() {
    if (!email.trim()) return
    setError('')
    const response = await fetch('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (response.ok) {
      setEmail('')
      loadFriends()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  async function respond(requestId: string, action: 'accept' | 'decline') {
    setError('')
    const response = await fetch(`/api/friends/requests/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (response.ok) {
      loadFriends()
    } else {
      setError(await parseErrorResponse(response))
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto bg-canvas p-6">
      <div>
        <h2 className="mb-2 font-display font-semibold tracking-tight text-text">Add a friend</h2>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Friend's email"
            className="rounded-lg border border-hairline bg-surface p-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button onClick={sendRequest} className="rounded-lg bg-accent p-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">Send request</button>
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>

      {data.incoming.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-text-muted uppercase">Pending requests</h3>
          <ul className="flex flex-col gap-1">
            {data.incoming.map((request) => (
              <li key={request.id} className="flex items-center gap-2 rounded-lg bg-surface p-2 text-sm text-text">
                <span className="flex-1 truncate">{request.requester.name ?? 'Unknown'}</span>
                <button onClick={() => respond(request.id, 'accept')} className="rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-raised">Accept</button>
                <button onClick={() => respond(request.id, 'decline')} className="rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:border-danger hover:text-danger">Decline</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.outgoing.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold tracking-tight text-text-muted uppercase">Sent requests</h3>
          <ul className="flex flex-col gap-1">
            {data.outgoing.map((request) => (
              <li key={request.id} className="rounded-lg p-2 text-sm text-text-muted">{request.addressee.name ?? 'Unknown'} (pending)</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold tracking-tight text-text-muted uppercase">Friends</h3>
        <ul className="flex flex-col gap-1">
          {data.friends.map((friend) => (
            <li key={friend.id} className="flex items-center gap-2 rounded-lg bg-surface p-2 text-sm text-text">
              <PresenceDot status={friend.status} />
              <span className="truncate">{friend.name ?? 'Unknown'}</span>
              <button onClick={() => onMessageFriend(friend.id, friend.name)} className="ml-auto rounded-md border border-hairline px-2 py-1 text-xs font-medium text-text transition-colors hover:bg-surface-raised">Message</button>
            </li>
          ))}
          {data.friends.length === 0 && <p className="text-xs text-text-muted">No friends yet.</p>}
        </ul>
      </div>
    </div>
  )
}
