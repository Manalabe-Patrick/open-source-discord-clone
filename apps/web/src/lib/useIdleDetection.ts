'use client'

import { useEffect } from 'react'
import { getSocket } from './socket'

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll'] as const

export function useIdleDetection() {
  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout>
    let isIdle = false

    function markActive() {
      if (isIdle) {
        isIdle = false
        getSocket().emit('presence:active')
      }
      clearTimeout(idleTimer)
      idleTimer = setTimeout(markIdle, IDLE_TIMEOUT_MS)
    }

    function markIdle() {
      isIdle = true
      getSocket().emit('presence:idle')
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        markIdle()
        clearTimeout(idleTimer)
      } else {
        markActive()
      }
    }

    ACTIVITY_EVENTS.forEach((eventName) => window.addEventListener(eventName, markActive))
    document.addEventListener('visibilitychange', handleVisibilityChange)
    idleTimer = setTimeout(markIdle, IDLE_TIMEOUT_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => window.removeEventListener(eventName, markActive))
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearTimeout(idleTimer)
    }
  }, [])
}
