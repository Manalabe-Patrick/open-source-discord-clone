'use client'

import { useEffect, useState } from 'react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type UserInfo = { id: string; name: string | null; image: string | null; status: 'ONLINE' | 'IDLE' | 'OFFLINE' }
type FriendsData = {
  friends: UserInfo[]
  incoming: { id: string; requester: UserInfo }[]
  outgoing: { id: string; addressee: UserInfo }[]
}

const STATUS_COLOR: Record<UserInfo['status'], string> = {
  ONLINE: 'bg-green-500',
  IDLE: 'bg-yellow-500',
  OFFLINE: 'bg-gray-400',
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
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="mb-2 font-bold">Add a friend</h2>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Friend's email"
            className="rounded border p-2 text-sm"
          />
          <button onClick={sendRequest} className="rounded bg-indigo-600 p-2 text-sm text-white">Send request</button>
        </div>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>

      {data.incoming.length > 0 && (
        <div>
          <h3 className="mb-2 font-bold">Pending requests</h3>
          <ul className="flex flex-col gap-1">
            {data.incoming.map((request) => (
              <li key={request.id} className="flex items-center gap-2 text-sm">
                <span>{request.requester.name ?? 'Unknown'}</span>
                <button onClick={() => respond(request.id, 'accept')} className="rounded border p-1 text-xs">Accept</button>
                <button onClick={() => respond(request.id, 'decline')} className="rounded border p-1 text-xs">Decline</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.outgoing.length > 0 && (
        <div>
          <h3 className="mb-2 font-bold">Sent requests</h3>
          <ul className="flex flex-col gap-1">
            {data.outgoing.map((request) => (
              <li key={request.id} className="text-sm text-gray-500">{request.addressee.name ?? 'Unknown'} (pending)</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-bold">Friends</h3>
        <ul className="flex flex-col gap-1">
          {data.friends.map((friend) => (
            <li key={friend.id} className="flex items-center gap-2 text-sm">
              <span className={`h-2 w-2 rounded-full ${STATUS_COLOR[friend.status]}`} />
              <span>{friend.name ?? 'Unknown'}</span>
              <button onClick={() => onMessageFriend(friend.id, friend.name)} className="ml-auto rounded border p-1 text-xs">Message</button>
            </li>
          ))}
          {data.friends.length === 0 && <p className="text-xs text-gray-500">No friends yet.</p>}
        </ul>
      </div>
    </div>
  )
}
