import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_SERVER_URL ?? 'http://localhost:4000', {
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
