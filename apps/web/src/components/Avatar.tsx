export function Avatar({
  name,
  image,
  size = 'h-10 w-10',
  textSize = 'text-sm',
  className = '',
}: {
  name: string | null
  image: string | null
  size?: string
  textSize?: string
  className?: string
}) {
  return image ? (
    <img src={image} alt="" className={`${size} shrink-0 rounded-full object-cover ${className}`} />
  ) : (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-accent/15 font-display font-semibold text-accent ${textSize} ${className}`}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}
