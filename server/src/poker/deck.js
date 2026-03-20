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
}