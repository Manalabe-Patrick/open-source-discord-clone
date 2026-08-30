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
type Server = { id: string; name: string; channels: Channel[]; role: 'OWNER' | 'ADMIN' | 'MEMBER' }

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
          setServers((prev) => [...prev, { ...server, channels: [], role: 'OWNER' }])
          setActiveServerId(server.id)
          setView('server')
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
        onOpenDMs={() => setView('dm')}
        dmsActive={view === 'dm'}
        onOpenFriends={() => setView('friends')}
        friendsActive={view === 'friends'}
      />
      {view === 'friends' ? (
        <FriendsPanel onMessageFriend={openDM} />
      ) : view === 'dm' ? (
        <>
          <DMSidebar
            activeOtherUserId={activeDM?.userId ?? null}
            onSelect={(userId, name) => setActiveDM({ userId, name })}
            refreshKey={dmRefreshKey}
          />
          {activeDM && session?.user?.id ? (
            <DMPanel otherUserId={activeDM.userId} otherUserName={activeDM.name} currentUserId={session.user.id} />
          ) : (
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a conversation</div>
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
            <div className="flex flex-1 items-center justify-center text-gray-500">Select a channel</div>
          )}
          {session?.user?.id && (
            <MemberList serverId={activeServer.id} role={activeServer.role} currentUserId={session.user.id} onMessageMember={openDM} />
          )}
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">Select or create a server</div>
      )}
    </>
  )
}
