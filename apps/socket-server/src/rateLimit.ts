export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>()
  const now = opts.now ?? Date.now

  return {
    consume(key: string): boolean {
      const t = now()
      const windowStart = t - opts.windowMs
      const timestamps = (hits.get(key) ?? []).filter((ts) => ts > windowStart)

      if (timestamps.length >= opts.limit) {
        hits.set(key, timestamps)
        return false
      }

      timestamps.push(t)
      hits.set(key, timestamps)
      return true
    },
    reset(): void {
      hits.clear()
    },
  }
}
