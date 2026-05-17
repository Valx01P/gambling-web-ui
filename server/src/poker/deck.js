const SUITS = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']

export class Deck {
  constructor() {
    this.cards = []
    this.reset()
  }

  reset() {
    this.cards = []
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ suit, rank })
      }
    }
    this.shuffle()
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]]
    }
  }

  draw() {
    if (this.cards.length === 0) this.reset()
    return this.cards.pop()
  }

  drawMultiple(count) {
    return Array.from({ length: count }, () => this.draw())
  }

  // Pull a specific card out of the remaining shuffle. Used by the
  // deck-rig powers (river_card / next_card / rig_hand) — they reserve
  // chosen cards before normal dealing so dealing logic stays untouched.
  // Returns the matched card object (so callers don't have to reconstruct
  // the canonical shape), or null if the card isn't present.
  removeCard(rank, suit) {
    const idx = this.cards.findIndex(c => c.rank === rank && c.suit === suit)
    if (idx < 0) return null
    const [card] = this.cards.splice(idx, 1)
    return card
  }

  has(rank, suit) {
    return this.cards.some(c => c.rank === rank && c.suit === suit)
  }
}