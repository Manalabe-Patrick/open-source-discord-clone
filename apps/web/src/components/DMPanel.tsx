'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'

type DMMessage = {
  id: string
  content: string
  dmConversationId: string
  createdAt: string
  attachmentUrl: string | null
  author: { id: string; name: string | null; image: string | null }
}

export function DMPanel({ otherUserId, otherUserName, currentUserId }: { otherUserId: string; otherUserName: string | null; currentUserId: string }) {
  const [messages, setMessages] = useState<DMMessage[]>([])
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
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

    socket.on('dm:message:new', handleNewMessage)
    socket.on('dm:message:delete', handleMessageDeleted)

    return () => {
      cancelled = true
      socket.emit('dm:leave', { otherUserId })
      socket.off('dm:message:new', handleNewMessage)
      socket.off('dm:message:delete', handleMessageDeleted)
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
    <div className="flex flex-1 flex-col">
      <div className="border-b p-3 font-bold">{otherUserName ?? 'Unknown'}</div>
      <div className="flex-1 overflow-y-auto p-3">
        {messages.map((message) => (
          <div key={message.id} className="mb-2 flex items-start justify-between gap-2">
            <div>
              <span className="font-semibold">{message.author.name ?? 'Unknown'}</span>{' '}
              <span className="text-xs text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</span>
              <p>{message.content}</p>
              {message.attachmentUrl && <img src={message.attachmentUrl} alt="attachment" className="mt-1 max-w-xs rounded" />}
            </div>
            {message.author.id === currentUserId && (
              <button onClick={() => deleteMessage(message)} className="text-xs text-gray-400 hover:text-red-500" title="Delete message">
                ✕
              </button>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <p className="px-3 text-xs text-red-500">{error}</p>}
      <form onSubmit={sendMessage} className="flex gap-2 border-t p-3">
        <input type="file" accept="image/*" onChange={attachImage} disabled={uploading} className="text-xs" />
        {attachmentUrl && <span className="self-center text-xs text-green-600">Image attached</span>}
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Message"
          className="flex-1 rounded border p-2 text-sm"
        />
        <button type="submit" className="rounded bg-indigo-600 p-2 text-sm text-white">Send</button>
      </form>
    </div>
  )
}
