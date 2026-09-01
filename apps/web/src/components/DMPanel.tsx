'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { Avatar } from '@/components/Avatar'
import { UserProfilePopover } from '@/components/UserProfilePopover'

type DMMessage = {
  id: string
  content: string
  dmConversationId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}

const GROUP_WINDOW_MS = 5 * 60 * 1000

function isGrouped(message: DMMessage, previous: DMMessage | undefined) {
  if (!previous || previous.author.id !== message.author.id) return false
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS
}

type Anchor = { top: number; left: number }

export function DMPanel({ otherUserId, otherUserName, currentUserId }: { otherUserId: string; otherUserName: string | null; currentUserId: string }) {
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [profilePopover, setProfilePopover] = useState<{ userId: string; anchor: Anchor } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    async function loadHistory() {
      const response = await fetch(`/api/dms/${otherUserId}/messages`)
      if (response.ok && !cancelled) {
        const history: DMMessage[] = await response.json()
        setMessages((prev) => {
          const historyIds = new Set(history.map((m) => m.id))
          const liveOnly = prev.filter((m) => !historyIds.has(m.id))
          return [...history, ...liveOnly]
        })
      }
    }
    loadHistory()

    const socket = getSocket()
    socket.emit('dm:join', { otherUserId }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok && !cancelled) setError(response.error)
    })

    function handleNewMessage(message: DMMessage) {
      setMessages((prev) => [...prev, message])
    }
    function handleMessageDeleted({ messageId }: { dmConversationId: string; messageId: string }) {
      setMessages((prev) => prev.filter((message) => message.id !== messageId))
    }
    function handleProfileUpdate({ userId, name, image }: { userId: string; name: string | null; image: string | null }) {
      setMessages((prev) => prev.map((message) => (message.author.id === userId ? { ...message, author: { ...message.author, name, image } } : message)))
    }

    socket.on('dm:message:new', handleNewMessage)
    socket.on('dm:message:delete', handleMessageDeleted)
    socket.on('profile:update', handleProfileUpdate)

    return () => {
      cancelled = true
      socket.emit('dm:leave', { otherUserId })
      socket.off('dm:message:new', handleNewMessage)
      socket.off('dm:message:delete', handleMessageDeleted)
      socket.off('profile:update', handleProfileUpdate)
    }
  }, [otherUserId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim() && !attachmentUrl) return
    setError('')

    getSocket().emit('dm:message:new', { recipientUserId: otherUserId, content, attachmentUrl: attachmentUrl ?? undefined }, (response: { ok: true } | { ok: false; error: string }) => {
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

  function deleteMessage(message: DMMessage) {
    getSocket().emit('dm:message:delete', { dmConversationId: message.dmConversationId, messageId: message.id }, (response: { ok: true } | { ok: false; error: string }) => {
      if (!response.ok) setError(response.error)
    })
  }

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      <div className="border-b border-hairline bg-surface p-3 font-display font-semibold text-text">{otherUserName ?? 'Unknown'}</div>
      <div className="flex-1 overflow-y-auto p-4">
        {messages.map((message, index) => {
          const grouped = isGrouped(message, messages[index - 1])
          return (
            <div
              key={message.id}
              className={`group flex items-start gap-3 rounded-lg px-2 -mx-2 transition-colors hover:bg-surface ${grouped ? 'py-0.5' : 'mt-3 py-1'}`}
            >
              <div className="flex w-10 shrink-0 justify-center">
                {!grouped && (
                  <button
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      setProfilePopover({ userId: message.author.id, anchor: { top: rect.top, left: rect.right + 12 } })
                    }}
                    aria-label={`View ${message.author.name ?? 'Unknown'}'s profile`}
                  >
                    <Avatar name={message.author.name} image={message.author.image} />
                  </button>
                )}
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
                  {message.author.id === currentUserId && (
                    <button onClick={() => deleteMessage(message)} className="shrink-0 rounded-md p-1 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-danger" title="Delete message">
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
          onChange={(e) => setContent(e.target.value)}
          placeholder="Message"
          className="flex-1 rounded-full border border-hairline bg-canvas px-4 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <button type="submit" className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
          Send
        </button>
      </form>
      {profilePopover && (
        <UserProfilePopover
          userId={profilePopover.userId}
          anchor={profilePopover.anchor}
          currentUserId={currentUserId}
          onClose={() => setProfilePopover(null)}
        />
      )}
    </div>
  )
}
