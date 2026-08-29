export function safeHandler<Args extends unknown[]>(
  handler: (...args: Args) => void | Promise<void>
): (...args: Args) => void {
  return (...args: Args) => {
    Promise.resolve()
      .then(() => handler(...args))
      .catch((error) => {
        console.error('Unhandled error in socket handler:', error)
        const maybeAck = args[args.length - 1]
        if (typeof maybeAck === 'function') {
          try {
            maybeAck({ ok: false, error: 'Internal server error' })
          } catch {
            // ack itself failed; nothing more we can do
          }
        }
      })
  }
}
