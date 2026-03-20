'use client'

const SUIT_INDEX = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }
const RANK_INDEX = {
  'A': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6,
  '8': 7, '9': 8, '10': 9, 'J': 10, 'Q': 11, 'K': 12
}

export const CARD_W = 80
export const CARD_H = 110
export const CARD_SCALE = 1.05 // 1.5x larger than the previous 0.7

export default function CardSprite({ card, ...props }) {
  const w = CARD_W * CARD_SCALE
  const h = CARD_H * CARD_SCALE

  // Map to the 5th row (index 4), 1st column (index 0) if there's no card passed.
  const bgX = card ? -(RANK_INDEX[card.rank] * CARD_W * CARD_SCALE) : 0
  const bgY = card ? -(SUIT_INDEX[card.suit] * CARD_H * CARD_SCALE) : -(4 * CARD_H * CARD_SCALE)

  return (
    <div
      {...props}
      className={`border border-white/10 ${!card ? 'rounded-[4px] shadow-sm' : ''} ${props.className || ''}`}
      style={{
        width: w, height: h,
        backgroundImage: `url('/images/cards.png')`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundSize: `${1040 * CARD_SCALE}px ${688 * CARD_SCALE}px`,
        backgroundRepeat: 'no-repeat',
        ...props.style
      }}
    />
  )
}