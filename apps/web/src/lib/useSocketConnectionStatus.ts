'use client'

import { useEffect, useState } from 'react'
import { getSocket } from './socket'

export function useSocketConnectionStatus(): 'connected' | 'disconnected' {
  const [connected, setConnected] = useState(() => getSocket().connected)

  useEffect(() => {
    const socket = getSocket()

    function handleConnect() {
      setConnected(true)
    }
    function handleDisconnect() {
      setConnected(false)
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)

    setConnected(socket.connected)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleDisconnect)
    }
  }, [])

  return connected ? 'connected' : 'disconnected'
}
