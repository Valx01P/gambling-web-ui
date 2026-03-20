'use client'

const SUIT_INDEX = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }
const RANK_INDEX = {
  'A': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6,
  '8': 7, '9': 8, '10': 9, 'J': 10, 'Q': 11, 'K': 12
}

export const CARD_W = 80
export const CARD_H = 110

export default function CardSprite({ card, className = '', highlight = false, ...props }) {
  // Map to the 5th row, 1st column if no card is passed (card back)
  const bgX = card ? -(RANK_INDEX[card.rank] * CARD_W) : 0
  const bgY = card ? -(SUIT_INDEX[card.suit] * CARD_H) : -(4 * CARD_H)

  // Switch to the gold active glow if the card is a winning piece
  const borderClass = highlight
    ? 'ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)] border-transparent z-10 relative'
    : 'border border-white/10 shadow-sm relative'

  return (
    <svg
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className={`inline-block overflow-hidden rounded-md h-auto transition-all duration-300 ${borderClass} ${className}`}
      {...props}
    >
      <image
        href="/images/cards.png"
        x={bgX}
        y={bgY}
        width="1040"
        height="688"
      />
    </svg>
  )
}