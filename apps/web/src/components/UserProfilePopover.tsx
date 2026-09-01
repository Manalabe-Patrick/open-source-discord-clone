'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/socket'
import { parseErrorResponse } from '@/lib/parseErrorResponse'
import { Avatar } from '@/components/Avatar'
import { PresenceDot } from '@/components/PresenceDot'

type Status = 'ONLINE' | 'IDLE' | 'OFFLINE'
type Profile = {
  id: string
  name: string | null
  image: string | null
  status: Status
  customStatus: string | null
  bio: string | null
  createdAt: string
}
type Anchor = { top: number; left: number }

const BANNER_WIDTH = 360
const NAME_MAX_LENGTH = 32
const CUSTOM_STATUS_MAX_LENGTH = 128
const BIO_MAX_LENGTH = 190

// Curated hue pairs harmonious with --accent (#e23f83) so every generated
// banner reads as "branded" rather than an arbitrary rainbow.
const BANNER_PALETTE: [string, string][] = [
  ['#e23f83', '#a24fd6'],
  ['#a24fd6', '#4f7ad6'],
  ['#4f7ad6', '#2fb4a8'],
  ['#2fb4a8', '#e2a13f'],
  ['#e2a13f', '#e23f83'],
]

function bannerGradient(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0
  }
  const [from, to] = BANNER_PALETTE[Math.abs(hash) % BANNER_PALETTE.length]
  return `linear-gradient(135deg, ${from}, ${to})`
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.19a1 1 0 0 0 .82-.43l.98-1.4a1 1 0 0 1 .82-.43h3.38a1 1 0 0 1 .82.43l.98 1.4a1 1 0 0 0 .82.43h2.19A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.25" />
    </svg>
  )
}

export function UserProfilePopover({
  userId,
  anchor,
  currentUserId,
  onClose,
  onMessageUser,
  onSelfProfileUpdated,
}: {
  userId: string
  anchor: Anchor
  currentUserId: string
  onClose: () => void
  onMessageUser?: (userId: string, name: string | null) => void
  onSelfProfileUpdated?: (fields: { name: string | null; image: string | null }) => void
}) {
  const isSelf = userId === currentUserId

  const [profile, setProfile] = useState<Profile | null>(null)
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [name, setName] = useState('')
  const [customStatus, setCustomStatus] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [formError, setFormError] = useState('')

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const response = await fetch(`/api/users/${userId}`)
      if (response.ok && !cancelled) {
        setProfile(await response.json())
      }
    }
    load()

    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    const socket = getSocket()
    function handleProfileUpdate(payload: { userId: string; name: string | null; image: string | null; customStatus: string | null; bio: string | null }) {
      if (payload.userId !== userId) return
      setProfile((prev) => (prev ? { ...prev, name: payload.name, image: payload.image, customStatus: payload.customStatus, bio: payload.bio } : prev))
    }
    socket.on('profile:update', handleProfileUpdate)
    return () => {
      socket.off('profile:update', handleProfileUpdate)
    }
  }, [userId])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  function enterEditMode() {
    if (!profile) return
    setName(profile.name ?? '')
    setCustomStatus(profile.customStatus ?? '')
    setBio(profile.bio ?? '')
    setFormError('')
    setMode('edit')
  }

  useEffect(() => {
    if (mode === 'edit') nameInputRef.current?.focus()
  }, [mode])

  async function save() {
    setFormError('')
    const trimmedName = name.trim()
    if (trimmedName.length < 2 || trimmedName.length > NAME_MAX_LENGTH) {
      setFormError(`Username must be between 2 and ${NAME_MAX_LENGTH} characters`)
      return
    }
    if (customStatus.length > CUSTOM_STATUS_MAX_LENGTH) {
      setFormError(`Custom status must be ${CUSTOM_STATUS_MAX_LENGTH} characters or fewer`)
      return
    }
    if (bio.length > BIO_MAX_LENGTH) {
      setFormError(`Bio must be ${BIO_MAX_LENGTH} characters or fewer`)
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, customStatus, bio }),
      })
      if (response.ok) {
        const updated: Profile = await response.json()
        setProfile(updated)
        getSocket().emit('profile:updated')
        onSelfProfileUpdated?.({ name: updated.name, image: updated.image })
        setMode('view')
      } else {
        setFormError(await parseErrorResponse(response))
      }
    } catch {
      setFormError('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadingAvatar(true)
    setFormError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/uploads/avatar', { method: 'POST', body: formData })
      if (response.ok) {
        const { image } = await response.json()
        setProfile((prev) => (prev ? { ...prev, image } : prev))
        getSocket().emit('profile:updated')
        onSelfProfileUpdated?.({ name: profile?.name ?? null, image })
      } else {
        setFormError(await parseErrorResponse(response))
      }
    } catch {
      setFormError('Avatar upload failed')
    } finally {
      setUploadingAvatar(false)
      event.target.value = ''
    }
  }

  const clampedLeft = Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : anchor.left + BANNER_WIDTH) - BANNER_WIDTH - 16)
  const clampedTop = Math.min(anchor.top, (typeof window !== 'undefined' ? window.innerHeight : anchor.top + 420) - 420)

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 overflow-hidden rounded-xl border border-hairline bg-surface shadow-xl motion-safe:animate-[profile-pop_0.15s_ease-out]"
        style={{ top: Math.max(clampedTop, 12), left: Math.max(clampedLeft, 12), width: BANNER_WIDTH }}
      >
        <style>{`@keyframes profile-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }`}</style>

        <div className="h-[72px] w-full" style={{ backgroundImage: bannerGradient(userId) }} />

        <div className="px-4 pb-4">
          <div className="-mt-10 flex items-end justify-between">
            <div className="relative">
              {mode === 'edit' ? (
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  aria-label="Change avatar"
                  className="group/avatar relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full ring-4 ring-surface disabled:opacity-50"
                >
                  <Avatar name={profile?.name ?? null} image={profile?.image ?? null} size="h-20 w-20" textSize="text-2xl" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity duration-200 group-hover/avatar:opacity-100">
                    <CameraIcon className="h-5 w-5" />
                  </span>
                </button>
              ) : (
                <div className="rounded-full ring-4 ring-surface">
                  <Avatar name={profile?.name ?? null} image={profile?.image ?? null} size="h-20 w-20" textSize="text-2xl" />
                </div>
              )}
              {profile && (
                <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-4 ring-surface">
                  <PresenceDot status={profile.status} title={profile.status} />
                </span>
              )}
            </div>
          </div>

          {!profile ? (
            <p className="mt-4 text-sm text-text-muted">Loading…</p>
          ) : mode === 'view' ? (
            <div className="mt-3">
              <h2 className="font-display text-lg font-bold text-text">{profile.name ?? 'Unknown'}</h2>
              {profile.customStatus && <p className="mt-0.5 text-sm text-text-muted">{profile.customStatus}</p>}

              <div className="my-3 h-px bg-hairline" />

              <p className="font-mono text-xs text-text-muted">
                Member since {new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>

              {profile.bio && <p className="mt-3 whitespace-pre-wrap text-sm text-text">{profile.bio}</p>}

              <div className="mt-4">
                {isSelf ? (
                  <button onClick={enterEditMode} className="w-full rounded-lg border border-hairline p-2 text-sm font-medium text-text transition-colors hover:bg-surface-raised">
                    Edit Profile
                  </button>
                ) : (
                  onMessageUser && (
                    <button
                      onClick={() => {
                        onMessageUser(profile.id, profile.name)
                        onClose()
                      }}
                      className="w-full rounded-lg bg-accent p-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                    >
                      Message
                    </button>
                  )
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <input ref={avatarInputRef} type="file" accept="image/*" onChange={uploadAvatar} disabled={uploadingAvatar} className="hidden" />

              <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">Username</label>
              <input
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={NAME_MAX_LENGTH}
                className="rounded-lg border border-hairline bg-canvas p-2 text-sm text-text focus:border-accent focus:outline-none"
              />

              <label className="mt-1 text-xs font-semibold uppercase tracking-wide text-text-muted">Custom Status</label>
              <input
                value={customStatus}
                onChange={(e) => setCustomStatus(e.target.value)}
                maxLength={CUSTOM_STATUS_MAX_LENGTH}
                placeholder="What's happening?"
                className="rounded-lg border border-hairline bg-canvas p-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />

              <div className="mt-1 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">About Me</label>
                <span className="font-mono text-[10px] text-text-muted">{bio.length}/{BIO_MAX_LENGTH}</span>
              </div>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={BIO_MAX_LENGTH}
                rows={3}
                className="resize-none rounded-lg border border-hairline bg-canvas p-2 text-sm text-text focus:border-accent focus:outline-none"
              />

              {formError && <p className="text-xs text-danger">{formError}</p>}

              <div className="mt-2 flex gap-2">
                <button onClick={() => setMode('view')} disabled={saving} className="flex-1 rounded-lg border border-hairline p-2 text-sm font-medium text-text transition-colors hover:bg-surface-raised disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={save} disabled={saving} className="flex-1 rounded-lg bg-accent p-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
