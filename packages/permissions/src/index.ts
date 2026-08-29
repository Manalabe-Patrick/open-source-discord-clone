export type Role = 'OWNER' | 'ADMIN' | 'MEMBER'

export function canCreateChannel(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function canDeleteChannel(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function canKickMember(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN'
}

export function canDeleteMessage(role: Role, isOwnMessage: boolean): boolean {
  if (isOwnMessage) return true
  return role === 'OWNER' || role === 'ADMIN'
}
