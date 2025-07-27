import type { Socket } from 'socket.io'

export interface AuthenticatedSocket extends Socket {
  userId?: string
  userName?: string
  userEmail?: string
  activeOrganizationId?: string
}

export async function authenticateSocket(socket: AuthenticatedSocket, next: any) {
  socket.userId = 'guest'
  socket.userName = 'Guest'
  socket.userEmail = 'guest@example.com'
  next()
}
