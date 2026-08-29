'use client'

import { useEffect, useState } from 'react'
import { ServerSidebar } from '@/components/ServerSidebar'
import { ChannelList } from '@/components/ChannelList'

type Channel = { id: string; name: string }
type Server = { id: string; name: string; channels: Channel[] }

export default function HomePage() {
  const [servers, setServers] = useState<Server[]>([])
  const [activeServerId, setActiveServerId] = useState<string | null>(null)

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
        onSelect={setActiveServerId}
        onCreated={(server) => {
          setServers((prev) => [...prev, { ...server, channels: [] }])
          setActiveServerId(server.id)
        }}
        onLeft={(serverId) => {
          setServers((prev) => prev.filter((s) => s.id !== serverId))
          setActiveServerId((current) => (current === serverId ? null : current))
        }}
      />
      {activeServer ? (
        <ChannelList serverId={activeServer.id} channels={activeServer.channels} onChannelsChanged={loadServers} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-gray-500">Select or create a server</div>
      )}
    </>
  )
}
