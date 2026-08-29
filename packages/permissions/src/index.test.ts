import { describe, it, expect } from 'vitest'
import { canCreateChannel, canDeleteChannel, canKickMember, canDeleteMessage } from './index'

describe('canCreateChannel', () => {
  it('allows OWNER and ADMIN, not MEMBER', () => {
    expect(canCreateChannel('OWNER')).toBe(true)
    expect(canCreateChannel('ADMIN')).toBe(true)
    expect(canCreateChannel('MEMBER')).toBe(false)
  })
})

describe('canDeleteChannel', () => {
  it('allows OWNER and ADMIN, not MEMBER', () => {
    expect(canDeleteChannel('OWNER')).toBe(true)
    expect(canDeleteChannel('ADMIN')).toBe(true)
    expect(canDeleteChannel('MEMBER')).toBe(false)
  })
})

describe('canKickMember', () => {
  it('allows OWNER and ADMIN, not MEMBER', () => {
    expect(canKickMember('OWNER')).toBe(true)
    expect(canKickMember('ADMIN')).toBe(true)
    expect(canKickMember('MEMBER')).toBe(false)
  })
})

describe('canDeleteMessage', () => {
  it('allows any role to delete their own message', () => {
    expect(canDeleteMessage('MEMBER', true)).toBe(true)
  })
  it('allows OWNER and ADMIN to delete others messages', () => {
    expect(canDeleteMessage('ADMIN', false)).toBe(true)
    expect(canDeleteMessage('OWNER', false)).toBe(true)
  })
  it('does not allow MEMBER to delete others messages', () => {
    expect(canDeleteMessage('MEMBER', false)).toBe(false)
  })
})
