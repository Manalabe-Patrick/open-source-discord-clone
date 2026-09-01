'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ServerSidebar } from '@/components/ServerSidebar'
import { ChannelList } from '@/components/ChannelList'
import { ChatPanel } from '@/components/ChatPanel'
import { MemberList } from '@/components/MemberList'
import { DMSidebar } from '@/components/DMSidebar'
import { DMPanel } from '@/components/DMPanel'
import { FriendsPanel } from '@/components/FriendsPanel'
import { useIdleDetection } from '@/lib/useIdleDetection'

type Channel = { id: string; name: string }
type Server = { id: string; name: string; icon: string | null; channels: Channel[]; role: 'OWNER' | 'ADMIN' | 'MEMBER' }

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-canvas text-text-muted">
      <span className="font-display text-2xl text-hairline">#</span>
      <p className="text-sm">{message}</p>
    </div>
  )
}

export default function HomePage() {
  useIdleDetection()
  const { data: session } = useSession()
  const [servers, setServers] = useState<Server[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)
  const [view, setView] = useState<'server' | 'dm' | 'friends'>('server')
  const [activeDM, setActiveDM] = useState<{ userId: string; name: string | null } | null>(null)
  const [dmRefreshKey, setDmRefreshKey] = useState(0)

  async function loadServers() {
    const response = await fetch('/api/servers')
    if (response.ok) {
      const data = await response.json()
      setServers(data)
    }
  }

  useEffect(() => {
    loadServers()
  }, [])

  const activeServer = servers.find((s) => s.id === activeServerId) ?? null

  function openDM(userId: string, name: string | null) {
    setView('dm')
    setActiveDM({ userId, name })
    setDmRefreshKey((k) => k + 1)
  }

  return (
    <>
      <ServerSidebar
        servers={servers}
        activeServerId={view === 'server' ? activeServerId : null}
        onSelect={(serverId) => {
          setView('server')
          setActiveServerId(serverId)
          setSelectedChannelId(null)
        }}
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, icon: server.icon ?? null, channels: [], role: 'OWNER' }])
          setActiveServerId(server.id)
          setView('server')
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
        onIconUpdated={(serverId, icon) => {
          setServers((prev) => prev.map((s) => (s.id === serverId ? { ...s, icon } : s)))
        }}
        onOpenDMs={() => setView('dm')}
        dmsActive={view === 'dm'}
        onOpenFriends={() => setView('friends')}
        friendsActive={view === 'friends'}
        onMessageUser={openDM}
      />
      {view === 'friends' ? (
        <FriendsPanel onMessageFriend={openDM} />
      ) : view === 'dm' ? (
        <>
          {session?.user?.id && (
            <DMSidebar
              currentUserId={session.user.id}
              activeOtherUserId={activeDM?.userId ?? null}
              onSelect={(userId, name) => setActiveDM({ userId, name })}
              onMessageUser={openDM}
              refreshKey={dmRefreshKey}
            />
          )}
          {activeDM && session?.user?.id ? (
            <DMPanel otherUserId={activeDM.userId} otherUserName={activeDM.name} currentUserId={session.user.id} />
          ) : (
            <EmptyState message="Select a conversation" />
          )}
        </>
      ) : activeServer ? (
        <>
          <ChannelList
            serverId={activeServer.id}
            role={activeServer.role}
            channels={activeServer.channels}
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
            onChannelsChanged={loadServers}
          />
          {selectedChannelId && session?.user?.id ? (
            <ChatPanel serverId={activeServer.id} channelId={selectedChannelId} role={activeServer.role} currentUserId={session.user.id} />
          ) : (
            <EmptyState message="Select a channel" />
          )}
          {session?.user?.id && (
            <MemberList serverId={activeServer.id} role={activeServer.role} currentUserId={session.user.id} onMessageMember={openDM} />
          )}
        </>
      ) : (
        <EmptyState message="Select or create a server" />
      )}
    </>
  )
}
