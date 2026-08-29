'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ServerSidebar } from '@/components/ServerSidebar'
import { ChannelList } from '@/components/ChannelList'
import { ChatPanel } from '@/components/ChatPanel'
import { MemberList } from '@/components/MemberList'
import { useIdleDetection } from '@/lib/useIdleDetection'

type Channel = { id: string; name: string }
type Server = { id: string; name: string; channels: Channel[]; role: 'OWNER' | 'ADMIN' | 'MEMBER' }

export default function HomePage() {
  useIdleDetection()
  const { data: session } = useSession()
  const [servers, setServers] = useState<Server[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null)

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

  return (
    <>
      <ServerSidebar
        servers={servers}
        activeServerId={activeServerId}
        onSelect={(serverId) => {
          setActiveServerId(serverId)
          setSelectedChannelId(null)
        }}
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, channels: [], role: 'OWNER' }])
          setActiveServerId(server.id)
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
      />
      {activeServer ? (
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
          <MemberList serverId={activeServer.id} role={activeServer.role} />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">Select or create a server</div>
      )}
    </>
  )
}
