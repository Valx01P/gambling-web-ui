'use client'

export const EMOTE_OPTIONS = [
  { id: 'angry', label: 'Angry', emoji: '😡' },
  { id: 'laugh', label: 'Laugh', emoji: '😂' },
  { id: 'sad', label: 'Sad', emoji: '😭' },
  { id: 'shush', label: 'Shush', emoji: '🤫' },
  { id: 'sunglasses', label: 'Sunglasses', emoji: '😎' },
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
