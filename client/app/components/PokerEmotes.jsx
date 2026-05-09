'use client'

export const EMOTE_OPTIONS = [
  { id: 'angry', label: 'Angry', emoji: '😡' },
  { id: 'laugh', label: 'Laugh', emoji: '😂' },
  { id: 'sad', label: 'Sad', emoji: '😭' },
  { id: 'shush', label: 'Shush', emoji: '🤫' },
  { id: 'sunglasses', label: 'Sunglasses', emoji: '😎' },
  { id: 'eggplant', label: 'Eggplant', emoji: '🍆' },
]

const EMOTE_BY_ID = Object.fromEntries(EMOTE_OPTIONS.map((emote) => [emote.id, emote]))

export function EmoteIcon({ emote, className = '' }) {
  const item = EMOTE_BY_ID[emote] || EMOTE_BY_ID.angry

  return (
    <span className={`inline-flex items-center justify-center text-xl leading-none ${className}`} aria-hidden="true">
      {item.emoji}
    </span>
  )
}

export function SeatEmotes({ emotes = [], className = '' }) {
  if (emotes.length === 0) return null

  return (
    <div className={`seat-emotes pointer-events-none ${className}`} aria-hidden="true">
      {emotes.map((emote, index) => {
        const item = EMOTE_BY_ID[emote.emote] || EMOTE_BY_ID.angry

        return (
          <span
            key={emote.eventId}
            className="seat-emoji-burst"
            style={{
              '--emoji-x': `${(index % 3) * 7}px`,
              '--emoji-delay': `${(index % 2) * 35}ms`,
            }}
          >
            {item.emoji}
          </span>
        )
      })}
    </div>
  )
}

export function SeatYells({ yells = [], className = '' }) {
  if (yells.length === 0) return null

  return (
    <div className={`seat-yells pointer-events-none ${className}`} aria-hidden="true">
      {yells.map((yell, index) => (
        <span
          key={yell.eventId}
          className="seat-yell-burst"
          style={{
            '--yell-x': `${((index % 3) - 1) * 16}px`,
            '--yell-y': `${(index % 3) * 12}px`,
            '--yell-delay': `${(index % 2) * 30}ms`,
          }}
        >
          {yell.message}
        </span>
      ))}
    </div>
  )
}
