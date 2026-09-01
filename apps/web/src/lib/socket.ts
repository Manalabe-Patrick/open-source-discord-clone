import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

function resolveSocketServerUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ?? 'http://localhost:4000'
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') {
    return configuredUrl
  }

  // The session cookie is scoped to whichever host the browser loaded the app
  // from (localhost vs a LAN IP) - the socket server must be reached via that
  // same host or the cookie won't be sent and auth will fail. Keep the port
  // from the configured URL but match the page's current hostname.
  const { protocol, port } = new URL(configuredUrl)
  return `${protocol}//${window.location.hostname}:${port}`
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(resolveSocketServerUrl(), {
      withCredentials: true,
    })
    socket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message)
    })
  }
  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
