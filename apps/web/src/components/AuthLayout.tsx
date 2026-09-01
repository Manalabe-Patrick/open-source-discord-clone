import Link from 'next/link'

type PresenceCard = {
  name: string
  status: 'online' | 'idle' | 'offline'
  text: React.ReactNode
  initial: string
  avatarClass: string
  top: string
  left: string
  rotate: string
  delay: string
}

const CARDS: PresenceCard[] = [
  {
    name: 'Ari',
    status: 'online',
    text: 'sent a gif',
    initial: 'A',
    avatarClass: 'bg-[#f97316]',
    top: '10%',
    left: '6%',
    rotate: '-6deg',
    delay: '0s',
  },
  {
    name: 'Kito',
    status: 'online',
    text: 'joined #general',
    initial: 'K',
    avatarClass: 'bg-[#22c55e]',
    top: '34%',
    left: '58%',
    rotate: '-3deg',
    delay: '1.4s',
  },
  {
    name: 'Maya',
    status: 'idle',
    text: 'brb, food',
    initial: 'M',
    avatarClass: 'bg-[#eab308]',
    top: '62%',
    left: '14%',
    rotate: '4deg',
    delay: '0.7s',
  },
  {
    name: 'Zo',
    status: 'online',
    text: (
      <span className="inline-flex items-center gap-0.5 align-middle">
        <span className="auth-typing-dot h-1 w-1 rounded-full bg-white/70" style={{ animationDelay: '0s' }} />
        <span className="auth-typing-dot h-1 w-1 rounded-full bg-white/70" style={{ animationDelay: '0.15s' }} />
        <span className="auth-typing-dot h-1 w-1 rounded-full bg-white/70" style={{ animationDelay: '0.3s' }} />
      </span>
    ),
    initial: 'Z',
    avatarClass: 'bg-[#60a5fa]',
    top: '78%',
    left: '54%',
    rotate: '2deg',
    delay: '2.1s',
  },
]

const STATUS_COLOR: Record<PresenceCard['status'], string> = {
  online: 'bg-online',
  idle: 'bg-idle',
  offline: 'bg-offline',
}

export function AuthLayout({
  headline,
  tagline,
  title,
  subtitle,
  error,
  footer,
  children,
}: {
  headline: string
  tagline: string
  title: string
  subtitle: string
  error?: string
  footer: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen bg-canvas">
      <div className="auth-brand-panel hidden w-[46%] shrink-0 flex-col justify-between p-10 lg:flex xl:p-14">
        <div className="auth-rise relative z-10 flex items-center gap-2.5">
          <img src="/dc_logo.png" alt="" className="h-8 w-8" />
        </div>

        <div className="relative z-10 my-8 flex-1">
          {CARDS.map((card) => (
            <div
              key={card.name}
              className="auth-float absolute flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-sm"
              style={{ top: card.top, left: card.left, transform: `rotate(${card.rotate})`, animationDelay: card.delay }}
            >
              <span className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${card.avatarClass}`}>
                {card.initial}
                <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#241040] ${STATUS_COLOR[card.status]}`} />
              </span>
              <span className="whitespace-nowrap text-xs text-white/90">
                <span className="font-semibold">{card.name}</span> <span className="text-white/60">{card.text}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="auth-rise relative z-10" style={{ animationDelay: '0.15s' }}>
          <h2 className="font-display max-w-md text-4xl font-bold leading-[1.08] tracking-tight text-white xl:text-5xl">{headline}</h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/60">{tagline}</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center px-4 py-12 lg:w-[54%] lg:px-16">
        <div className="w-full max-w-sm">
          <div className="auth-rise mb-8 lg:hidden">
            <img src="/dc_logo.png" alt="" className="mx-auto mb-4 h-11 w-11" />
          </div>

          <div className="auth-rise mb-7 text-center lg:text-left" style={{ animationDelay: '0.05s' }}>
            <h1 className="font-display text-[28px] font-bold tracking-tight text-text">{title}</h1>
            <p className="mt-1.5 text-sm text-text-muted">{subtitle}</p>
          </div>

          {error && (
            <div role="alert" className="auth-rise mb-5 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
              <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="auth-rise" style={{ animationDelay: '0.1s' }}>
            {children}
          </div>

          <p className="auth-rise mt-7 text-center text-sm text-text-muted" style={{ animationDelay: '0.15s' }}>
            {footer}
          </p>
        </div>
      </div>
    </main>
  )
}

export function FormField({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-accent transition-colors hover:text-accent-hover">
      {children}
    </Link>
  )
}

export function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c6.4 0 10 7 10 7a17.5 17.5 0 0 1-3.4 4.3M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3.4-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

export function AlertIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  )
}

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3.01c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.3v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.6l4 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
    </svg>
  )
}
