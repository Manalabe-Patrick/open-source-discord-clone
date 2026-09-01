'use client'

import { useRef, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { disconnectSocket } from '@/lib/socket'
import { UserProfilePopover } from '@/components/UserProfilePopover'

type Server = { id: string; name: string; icon: string | null }
type Tooltip = { text: string; top: number }
type ContextMenu = { serverId: string; serverName: string; top: number; left: number }
type Anchor = { top: number; left: number }
type Toast = { message: string; tone: 'error' | 'success' }

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12c0 4.418-4.03 8-9 8-1.06 0-2.076-.16-3.02-.455L3 21l1.5-4.5C3.55 15.07 3 13.585 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z" />
    </svg>
  )
}

function PeopleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
      <circle cx="17" cy="8.5" r="2.5" />
      <path d="M15.5 13.25c2.9.2 5 2.35 5 5.75" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function PowerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v8" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77 0" />
    </svg>
  )
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M20.5 15.5 15 10l-9 9" />
    </svg>
  )
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

function DoorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 4h-3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M19 12H9" />
      <path d="m15 8 4 4-4 4" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function RailItem({
  label,
  active,
  onClick,
  onContextMenu,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void
  onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void
  onMouseLeave: () => void
  children: React.ReactNode
}) {
  return (
    <li className="group relative flex w-full justify-center">
      <span
        className={`absolute left-0 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-text transition-all duration-200 ${
          active ? 'h-10' : 'h-0 group-hover:h-5'
        }`}
      />
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label={label}
        className={`flex h-12 w-12 items-center justify-center overflow-hidden text-sm font-semibold transition-all duration-200 ${
          active
            ? 'rounded-2xl bg-accent text-white'
            : 'rounded-full bg-surface-raised text-text-muted hover:rounded-2xl hover:bg-accent hover:text-white'
        }`}
      >
        {children}
      </button>
    </li>
  )
}

export function ServerSidebar({
  servers,
  activeServerId,
  onSelect,
  onCreated,
  onLeft,
  onIconUpdated,
  onOpenDMs,
  dmsActive,
  onOpenFriends,
  friendsActive,
  onMessageUser,
}: {
  servers: Server[]
  activeServerId: string | null
  onSelect: (serverId: string) => void
  onCreated: (server: Server) => void
  onLeft: (serverId: string) => void
  onIconUpdated: (serverId: string, icon: string) => void
  onOpenDMs: () => void
  dmsActive: boolean
  onOpenFriends: () => void
  friendsActive: boolean
  onMessageUser: (userId: string, name: string | null) => void
}) {
  const { data: session, update: updateSession } = useSession()
  const [name, setName] = useState('')
  const [joinId, setJoinId] = useState('')
  const [formError, setFormError] = useState('')
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [addServerAnchor, setAddServerAnchor] = useState<Anchor | null>(null)
  const [profileAnchor, setProfileAnchor] = useState<Anchor | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  const iconInputRef = useRef<HTMLInputElement>(null)
  const iconUploadServerId = useRef<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flashToast(message: string, tone: Toast['tone'] = 'error') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ message, tone })
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  function showTooltip(e: React.MouseEvent<HTMLButtonElement>, text: string) {
    const rect = e.currentTarget.getBoundingClientRect()
    setTooltip({ text, top: rect.top + rect.height / 2 })
  }

  function hideTooltip() {
    setTooltip(null)
  }

  async function uploadServerIcon(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const serverId = iconUploadServerId.current
    if (!file || !serverId) return
    setUploadingIcon(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`/api/servers/${serverId}/icon`, { method: 'POST', body: formData })
      if (response.ok) {
        const { icon } = await response.json()
        onIconUpdated(serverId, icon)
      } else {
        flashToast(await parseErrorResponse(response))
      }
    } catch {
      flashToast('Icon upload failed')
    } finally {
      setUploadingIcon(false)
      event.target.value = ''
    }
  }

  async function createServer() {
    if (!name.trim()) return
    setFormError('')
    const response = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (response.ok) {
      const server = await response.json()
      onCreated(server)
      setName('')
      setAddServerAnchor(null)
    } else {
      setFormError(await parseErrorResponse(response))
    }
  }

  async function joinServer() {
    if (!joinId.trim()) return
    setFormError('')
    const response = await fetch(`/api/servers/${joinId}/join`, { method: 'POST' })
    if (response.ok) {
      window.location.reload()
    } else {
      setFormError(await parseErrorResponse(response))
    }
    setJoinId('')
  }

  async function copyServerId(serverId: string) {
    setContextMenu(null)
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(serverId)
      } else {
        // navigator.clipboard is only exposed in secure contexts (HTTPS or
        // localhost) - fall back to the legacy copy command so this still
        // works when the app is reached over plain HTTP on the LAN.
        const textarea = document.createElement('textarea')
        textarea.value = serverId
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }
      flashToast('Server ID copied', 'success')
    } catch {
      flashToast('Copy failed')
    }
  }

  async function leaveServer(serverId: string) {
    setContextMenu(null)
    const response = await fetch(`/api/servers/${serverId}/leave`, { method: 'POST' })
    if (response.ok) {
      onLeft(serverId)
    } else {
      flashToast(await parseErrorResponse(response))
    }
  }

  function openAddServer(e: React.MouseEvent<HTMLButtonElement>) {
    hideTooltip()
    const rect = e.currentTarget.getBoundingClientRect()
    setAddServerAnchor({ top: rect.top, left: rect.right + 12 })
  }

  function openOwnProfile(e: React.MouseEvent<HTMLButtonElement>) {
    hideTooltip()
    const rect = e.currentTarget.getBoundingClientRect()
    setProfileAnchor({ top: rect.top, left: rect.right + 12 })
  }

  function openContextMenu(e: React.MouseEvent<HTMLButtonElement>, server: Server) {
    e.preventDefault()
    hideTooltip()
    const rect = e.currentTarget.getBoundingClientRect()
    setContextMenu({ serverId: server.id, serverName: server.name, top: rect.top, left: rect.right + 12 })
  }

  return (
    <aside className="relative flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-hairline bg-canvas py-3">
      <input ref={iconInputRef} type="file" accept="image/*" onChange={uploadServerIcon} disabled={uploadingIcon} className="hidden" />

      <ul className="flex w-full flex-col items-center gap-2">
        <RailItem label="Direct Messages" active={dmsActive} onClick={onOpenDMs} onMouseEnter={(e) => showTooltip(e, 'Direct Messages')} onMouseLeave={hideTooltip}>
          <ChatIcon className="h-6 w-6" />
        </RailItem>
        <RailItem label="Friends" active={friendsActive} onClick={onOpenFriends} onMouseEnter={(e) => showTooltip(e, 'Friends')} onMouseLeave={hideTooltip}>
          <PeopleIcon className="h-6 w-6" />
        </RailItem>
      </ul>

      <div className="h-0.5 w-8 shrink-0 rounded-full bg-hairline" />

      <ul className="no-scrollbar flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
        {servers.map((server) => (
          <RailItem
            key={server.id}
            label={server.name}
            active={activeServerId === server.id}
            onClick={() => onSelect(server.id)}
            onContextMenu={(e) => openContextMenu(e, server)}
            onMouseEnter={(e) => showTooltip(e, server.name)}
            onMouseLeave={hideTooltip}
          >
            {server.icon ? <img src={server.icon} className="h-full w-full object-cover" alt="" /> : server.name.charAt(0).toUpperCase()}
          </RailItem>
        ))}
        <li className="group relative flex w-full justify-center">
          <button
            onClick={openAddServer}
            onMouseEnter={(e) => showTooltip(e, 'Add a Server')}
            onMouseLeave={hideTooltip}
            aria-label="Add a server"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-accent transition-all duration-200 hover:rounded-2xl hover:bg-accent hover:text-white"
          >
            <PlusIcon className="h-6 w-6" />
          </button>
        </li>
      </ul>

      <div className="mt-auto flex w-full flex-col items-center gap-2 pt-2">
        <div className="h-0.5 w-8 shrink-0 rounded-full bg-hairline" />
        <button
          onClick={openOwnProfile}
          onMouseEnter={(e) => showTooltip(e, 'View Profile')}
          onMouseLeave={hideTooltip}
          aria-label="View your profile"
          className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-raised text-sm font-semibold text-text-muted transition-all duration-200 hover:rounded-2xl"
        >
          {session?.user?.image ? (
            <img src={session.user.image} className="h-full w-full object-cover" alt="" />
          ) : (
            (session?.user?.name ?? session?.user?.email ?? '?').charAt(0).toUpperCase()
          )}
        </button>
        <button
          onClick={() => {
            disconnectSocket()
            signOut({ callbackUrl: '/login' })
          }}
          onMouseEnter={(e) => showTooltip(e, 'Log Out')}
          onMouseLeave={hideTooltip}
          aria-label="Log out"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-raised text-text-muted transition-all duration-200 hover:rounded-2xl hover:bg-danger hover:text-white"
        >
          <PowerIcon className="h-5 w-5" />
        </button>
      </div>

      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-text px-3 py-1.5 text-sm font-semibold text-canvas shadow-xl"
          style={{ top: tooltip.top, left: 72 + 12 }}
        >
          {tooltip.text}
          <span className="absolute right-full top-1/2 h-2 w-2 -translate-y-1/2 translate-x-1 rotate-45 bg-text" />
        </div>
      )}

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null) }} />
          <div
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-hairline bg-surface py-1 shadow-xl"
            style={{ top: Math.min(contextMenu.top, window.innerHeight - 170), left: contextMenu.left }}
          >
            <div className="truncate px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">{contextMenu.serverName}</div>
            <button onClick={() => copyServerId(contextMenu.serverId)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-raised">
              <CopyIcon className="h-4 w-4" /> Copy Server ID
            </button>
            <button
              onClick={() => {
                iconUploadServerId.current = contextMenu.serverId
                iconInputRef.current?.click()
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-raised"
            >
              <ImageIcon className="h-4 w-4" /> Change Server Icon
            </button>
            <button onClick={() => leaveServer(contextMenu.serverId)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10">
              <DoorIcon className="h-4 w-4" /> Leave Server
            </button>
          </div>
        </>
      )}

      {addServerAnchor && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAddServerAnchor(null)} />
          <div
            className="fixed z-50 w-72 rounded-xl border border-hairline bg-surface p-4 shadow-xl"
            style={{ top: Math.min(addServerAnchor.top, window.innerHeight - 300), left: addServerAnchor.left }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold tracking-tight text-text">Create a server</h3>
              <button onClick={() => setAddServerAnchor(null)} aria-label="Close" className="rounded-md p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text">
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Server name"
                className="rounded-lg border border-hairline bg-canvas p-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <button onClick={createServer} className="rounded-lg bg-accent p-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover">
                Create
              </button>
            </div>
            <div className="my-3 h-px bg-hairline" />
            <h3 className="font-display text-sm font-semibold tracking-tight text-text">Join a server</h3>
            <div className="mt-2 flex flex-col gap-2">
              <input
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                placeholder="Server ID"
                className="rounded-lg border border-hairline bg-canvas p-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <button onClick={joinServer} className="rounded-lg border border-hairline p-2 text-sm font-medium text-text transition-colors hover:bg-surface-raised">
                Join
              </button>
            </div>
            {formError && <p className="mt-2 text-xs text-danger">{formError}</p>}
          </div>
        </>
      )}

      {profileAnchor && session?.user?.id && (
        <UserProfilePopover
          userId={session.user.id}
          anchor={profileAnchor}
          currentUserId={session.user.id}
          onClose={() => setProfileAnchor(null)}
          onMessageUser={onMessageUser}
          onSelfProfileUpdated={(fields) => updateSession(fields)}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-4 left-20 z-50 rounded-lg px-3 py-2 text-xs font-medium text-white shadow-xl ${toast.tone === 'error' ? 'bg-danger' : 'bg-online'}`}
        >
          {toast.message}
        </div>
      )}
    </aside>
  )
}
