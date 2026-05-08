'use client'

export const PROFILE_AVATARS = [
  { id: 'op1', label: 'Option 1', url: 'https://i.ibb.co/Wpf6XVp0/image.png' },
  { id: 'op2', label: 'Option 2', url: 'https://i.ibb.co/XdFhJ7w/image.png' },
  { id: 'op3', label: 'Option 3', url: 'https://i.ibb.co/TD0NJ5TR/image.png' },
  { id: 'op4', label: 'Option 4', url: 'https://i.ibb.co/0jwk0qwP/image.png' },
  { id: 'op5', label: 'Option 5', url: 'https://i.ibb.co/qYM6dhcB/image.png' },
  { id: 'op6', label: 'Option 6', url: 'https://i.ibb.co/4g55Ppjs/image.png' },
  { id: 'op7', label: 'Option 7', url: 'https://i.ibb.co/WWQbgGzW/image.png' },
  { id: 'op8', label: 'Option 8', url: 'https://i.ibb.co/GfRfzcBM/image.png' },
  { id: 'op9', label: 'Option 9', url: 'https://i.ibb.co/mFr14sFv/image.png' },
  { id: 'op10', label: 'Option 10', url: 'https://i.ibb.co/8nm24QfJ/image.png' },
]

const DEFAULT_AVATAR = PROFILE_AVATARS[0]

export function getProfileAvatar(idOrUrl) {
  return PROFILE_AVATARS.find((avatar) => avatar.id === idOrUrl || avatar.url === idOrUrl) || DEFAULT_AVATAR
}

export function ProfileAvatar({ avatarId, avatarUrl, className = '' }) {
  const avatar = avatarUrl ? { url: avatarUrl, label: 'Profile' } : getProfileAvatar(avatarId)

  return (
    <span className={`inline-flex shrink-0 overflow-hidden rounded-full bg-zinc-900 ring-1 ring-white/15 ${className}`}>
      <img
        src={avatar.url}
        alt=""
        className="h-full w-full object-cover object-center"
        draggable="false"
      />
    </span>
  )
}

function wrappedDistance(index, selectedIndex) {
  const total = PROFILE_AVATARS.length
  let distance = index - selectedIndex
  if (distance > total / 2) distance -= total
  if (distance < -total / 2) distance += total
  return distance
}

export default function ProfileSelector({ value = DEFAULT_AVATAR.id, onChange }) {
  const selectedIndex = Math.max(0, PROFILE_AVATARS.findIndex((avatar) => avatar.id === value))
  const selected = PROFILE_AVATARS[selectedIndex] || DEFAULT_AVATAR

  function selectOffset(offset) {
    const total = PROFILE_AVATARS.length
    const nextIndex = (selectedIndex + offset + total) % total
    onChange?.(PROFILE_AVATARS[nextIndex].id)
  }

  return (
    <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/80 px-4 py-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Profile</div>
          <div className="text-xs font-bold text-zinc-500">{selected.label}</div>
        </div>
        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Character</div>
      </div>

      <div className="relative mx-auto h-36 max-w-[500px] overflow-hidden px-14 sm:px-16">
        <div className="absolute inset-x-14 top-1/2 h-px -translate-y-1/2 sm:inset-x-16" aria-hidden="true" />
        <button
          type="button"
          onClick={() => selectOffset(-1)}
          className="absolute left-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:left-4"
          aria-label="Previous profile"
        >
          &lt;
        </button>
        <button
          type="button"
          onClick={() => selectOffset(1)}
          className="absolute right-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:right-4"
          aria-label="Next profile"
        >
          &gt;
        </button>

        <div className="absolute inset-x-14 top-1/2 h-28 -translate-y-1/2 overflow-hidden sm:inset-x-16">
        {PROFILE_AVATARS.map((avatar, index) => {
          const distance = wrappedDistance(index, selectedIndex)
          if (Math.abs(distance) > 2) return null

          const isSelected = distance === 0
          const depth = Math.abs(distance)
          const translateX = distance * 86
          const size = isSelected ? 108 : depth === 1 ? 82 : 62
          const opacity = isSelected ? 1 : depth === 1 ? 0.62 : 0.28

          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onChange?.(avatar.id)}
              className={`absolute left-1/2 top-1/2 flex items-center justify-center rounded-full transition-all duration-300 ${
                isSelected ? 'z-10' : 'z-0'
              }`}
              style={{
                width: `${size}px`,
                height: `${size}px`,
                transform: `translate(calc(-50% + ${translateX}px), -50%)`,
                opacity,
                filter: isSelected ? 'none' : 'brightness(0.65)',
              }}
              aria-label={`Choose ${avatar.label}`}
            >
              <span className={`h-full w-full overflow-hidden rounded-full bg-zinc-950 shadow-2xl ring-2 ${isSelected ? 'ring-amber-300' : 'ring-zinc-700'}`}>
                <img
                  src={avatar.url}
                  alt=""
                  className="h-full w-full object-cover object-center"
                  draggable="false"
                />
              </span>
            </button>
          )
        })}
        </div>
      </div>
    </div>
  )
}
