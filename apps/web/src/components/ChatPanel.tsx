'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useSocketConnectionStatus } from '@/lib/useSocketConnectionStatus'
import { canDeleteMessage, type Role } from '@repo/permissions'

type Message = {
  id: string
  content: string
  channelId: string
  createdAt: string
  author: { id: string; name: string | null; image: string | null }
}

const TYPING_STOP_DELAY_MS = 2000

export function ChatPanel({ serverId, channelId, role, currentUserId }: { serverId: string; channelId: string; role: Role; currentUserId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set())
  const connectionStatus = useSocketConnectionStatus()
  const bottomRef = useRef<HTMLDivElement>(null)
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const response = await fetch(`/api/servers/${serverId}/channels/${channelId}/messages`)
      if (response.ok && !cancelled) {
        // Merge (not replace) so a message:new event that arrives while this
        // fetch is still in flight isn't dropped or duplicated once history
        // resolves — dedupe by id, history first (already oldest-first),
        // then any live-only message not yet reflected in history.
        const history: Message[] = await response.json()
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id))
          const liveOnly = prev.filter((m) => !historyIds.has(m.id))
          return [...history, ...liveOnly]
        })
      }
    }
    loadHistory()

    const socket = getSocket()
    socket.emit('channel:join', { channelId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok && !cancelled) setError(response.error)
    })

    function handleNewMessage(message: Message) {
      if (message.channelId === channelId) {
        setMessages((prev) => [...prev, message])
      }
    }
    function handleTypingStart({ channelId: eventChannelId, userId }: { channelId: string; userId: string }) {
      if (eventChannelId !== channelId) return
      setTypingUserIds((prev) => new Set(prev).add(userId))
    }
    function handleTypingStop({ channelId: eventChannelId, userId }: { channelId: string; userId: string }) {
      if (eventChannelId !== channelId) return
      setTypingUserIds((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }

    function handleMessageDeleted({ channelId: eventChannelId, messageId }: { channelId: string; messageId: string }) {
      if (eventChannelId !== channelId) return
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
    }

    socket.on('message:new', handleNewMessage)
    socket.on('typing:start', handleTypingStart)
    socket.on('typing:stop', handleTypingStop)
    socket.on('message:delete', handleMessageDeleted)

    return () => {
      cancelled = true
      socket.emit('channel:leave', { channelId })
      socket.off('message:new', handleNewMessage)
      socket.off('typing:start', handleTypingStart)
      socket.off('typing:stop', handleTypingStop)
      socket.off('message:delete', handleMessageDeleted)
      setTypingUserIds(new Set())
    }
  }, [serverId, channelId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleContentChange(event: React.ChangeEvent<HTMLInputElement>) {
    setContent(event.target.value)

    const socket = getSocket()
    socket.emit('typing:start', { channelId })

    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    typingStopTimer.current = setTimeout(() => {
      socket.emit('typing:stop', { channelId })
    }, TYPING_STOP_DELAY_MS)
  }

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) return
    setError('')

    const socket = getSocket()
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    socket.emit('typing:stop', { channelId })

    socket.emit('message:new', { channelId, content }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
  }

  function deleteMessage(messageId: string) {
    getSocket().emit('message:delete', { channelId, messageId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
  }

  return (
    <div className="flex flex-1 flex-col">
      {connectionStatus === 'disconnected' && (
        <p className="bg-red-500 px-3 py-1 text-xs text-white">Reconnecting to chat…</p>
      )}
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-2 flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
              <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
              <p>{message.content}</p>
            </div>
            {canDeleteMessage(role, message.author.id === currentUserId) && (
              <button onClick={() => deleteMessage(message.id)} className="text-xs text-gray-400 hover:text-red-500" title="Delete message">
                ✕
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {typingUserIds.size > 0 && (
        <p className="px-3 text-xs text-gray-500 italic">
          {typingUserIds.size === 1 ? 'Someone is typing…' : `${typingUserIds.size} people are typing…`}
        </p>
      )}
      {error && <p className="px-3 text-xs text-red-500">{error}</p>}
      <form onSubmit={sendMessage} className="flex gap-2 border-t p-3">
        <input
          value={content}
          onChange={handleContentChange}
          placeholder="Message"
          className="flex-1 rounded border p-2 text-sm"
        />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-sm text-white">Send</button>
      </form>
    </div>
  )
}
