'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { useSocketConnectionStatus } from '@/lib/useSocketConnectionStatus'
import { canDeleteMessage, type Role } from '@repo/permissions'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { Avatar } from '@/components/Avatar'

type Message = {
  id: string
  content: string
  channelId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}

const TYPING_STOP_DELAY_MS = 2000
const GROUP_WINDOW_MS = 5 * 60 * 1000

function isGrouped(message: Message, previous: Message | undefined) {
  if (!previous || previous.author.id !== message.author.id) return false
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS
}

export function ChatPanel({ serverId, channelId, role, currentUserId }: { serverId: string; channelId: string; role: Role; currentUserId: string }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set())
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
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
          const liveOnly = prev.filter((m) => m.channelId === channelId && !historyIds.has(m.id))
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
    if (!content.trim() && !attachmentUrl) return
    setError('')

    const socket = getSocket()
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
    socket.emit('typing:stop', { channelId })

    socket.emit('message:new', { channelId, content, attachmentUrl: attachmentUrl ?? undefined }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
    setContent('')
    setAttachmentUrl(null)
  }

  async function attachImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/uploads/message-image', { method: 'POST', body: formData })
      if (response.ok) {
        const { url } = await response.json()
        setAttachmentUrl(url)
      } else {
        setError(await parseErrorResponse(response))
      }
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  function deleteMessage(messageId: string) {
    getSocket().emit('message:delete', { channelId, messageId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      {connectionStatus === 'disconnected' && (
        <p className="bg-danger px-3 py-1 text-center text-xs font-medium text-white">Reconnecting to chat…</p>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message, index) => {
          const grouped = isGrouped(message, messages[index - 1])
          return (
            <div
              key={message.id}
              className={`group flex items-start gap-3 rounded-lg px-2 -mx-2 transition-colors hover:bg-surface ${grouped ? 'py-0.5' : 'mt-3 py-1'}`}
            >
              <div className="flex w-10 shrink-0 justify-center">
                {!grouped && <Avatar name={message.author.name} image={message.author.image} />}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div>
                    <span className="font-display font-semibold text-text">{message.author.name ?? 'Unknown'}</span>{' '}
                    <span className="font-mono text-xs text-text-muted">{new Date(message.createdAt).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text">{message.content}</p>
                    {message.attachmentUrl && <img src={message.attachmentUrl} alt="attachment" className="mt-1 max-w-xs rounded-lg border border-hairline" />}
                  </div>
                  {canDeleteMessage(role, message.author.id === currentUserId) && (
                    <button onClick={() => deleteMessage(message.id)} className="shrink-0 rounded-md p-1 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-danger" title="Delete message">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {typingUserIds.size > 0 && (
        <p className="px-4 text-xs text-text-muted italic">
          {typingUserIds.size === 1 ? 'Someone is typing…' : `${typingUserIds.size} people are typing…`}
        </p>
      )}
      {error && <p className="px-4 text-xs text-danger">{error}</p>}
      <form onSubmit={sendMessage} className="flex items-center gap-2 border-t border-hairline bg-surface p-3">
        <input
          type="file"
          accept="image/*"
          onChange={attachImage}
          disabled={uploading}
          className="text-xs text-text-muted file:mr-2 file:rounded-md file:border-0 file:bg-surface-raised file:px-2 file:py-1 file:text-xs file:font-medium file:text-text hover:file:bg-hairline disabled:opacity-50"
        />
        {attachmentUrl && <span className="shrink-0 self-center text-xs font-medium text-online">Image attached</span>}
        <input
          value={content}
          onChange={handleContentChange}
          placeholder="Message"
          className="flex-1 rounded-full border border-hairline bg-canvas px-4 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
          Send
        </button>
      </form>
    </div>
  )
}
