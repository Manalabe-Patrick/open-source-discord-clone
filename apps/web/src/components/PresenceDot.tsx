type Status = 'ONLINE' | 'IDLE' | 'OFFLINE'

const DOT_COLOR: Record<Status, string> = {
  ONLINE: 'bg-online',
  IDLE: 'bg-idle',
  OFFLINE: 'bg-offline',
}

export function PresenceDot({ status, title }: { status: Status; title?: string }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0" title={title}>
      {status === 'ONLINE' && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-online opacity-75 motion-reduce:animate-none" />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${DOT_COLOR[status]}`} />
    </span>
  )
}
