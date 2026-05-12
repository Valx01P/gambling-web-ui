// Achievements. Unlike dailies these are persistent — each unlocks once
// per user, ever. They lean toward "stupid memorable moment" rather than
// "grindable challenge". One-shot trigger: as soon as the per-hand event
// satisfies `unlock(event)`, the engine drops the id into the user's
// `achievements` JSONB column.
//
// Adding a new achievement: append an entry below. id is the persistent
// key (don't rename!), title shows on the trophy chip, blurb is the
// hover text.

function hasRanks(cards, ...wanted) {
  const have = new Set(cards?.map(c => c?.rank) || [])
  return wanted.every(r => have.has(r))
}
function isOffSuit(cards) {
  return cards?.length === 2 && cards[0]?.suit !== cards[1]?.suit
}
function isSuited(cards) {
  return cards?.length === 2 && cards[0]?.suit === cards[1]?.suit
}

export const ACHIEVEMENTS = [
  // ─── Hand-strength milestones ──────────────────────────────────────
  {
    id: 'royal_flush',
    title: 'Royalty',
    blurb: 'Hit a Straight Flush A-high. The unicorn.',
    unlock: (e) => e.won && e.handName === 'Straight Flush' && (e.cards || []).some(c => c?.rank === 'A'),
  },
  {
    id: 'straight_flush',
    title: 'Top Shelf',
    blurb: 'Win with a Straight Flush. Painful for them.',
    unlock: (e) => e.won && e.handName === 'Straight Flush',
  },
  {
    id: 'quads',
    title: 'Quad Squad',
    blurb: 'Four of a kind. Try to look unfazed.',
    unlock: (e) => e.won && e.handName === 'Four of a Kind',
  },
  {
    id: 'first_full_house',
    title: 'House Money',
    blurb: 'Your first full house win.',
    unlock: (e) => e.won && e.handName === 'Full House',
  },
  {
    id: 'first_flush',
    title: 'Flushed',
    blurb: 'First flush win.',
    unlock: (e) => e.won && e.handName === 'Flush',
  },
  {
    id: 'first_straight',
    title: 'Connect Four (well, five)',
    blurb: 'First straight win.',
    unlock: (e) => e.won && e.handName === 'Straight',
  },

  // ─── "Look at this maniac" achievements ────────────────────────────
  {
    id: 'allin_72o',
    title: '7-2 Hero',
    blurb: 'Went all-in with 7-2 offsuit. May the odds never befriend you.',
    unlock: (e) => e.wentAllIn && hasRanks(e.cards, '7', '2') && isOffSuit(e.cards),
  },
  {
    id: 'allin_72o_won',
    title: '7-2 Legend',
    blurb: 'Won the all-in with 7-2 offsuit. This is what dreams are made of.',
    unlock: (e) => e.won && e.wentAllIn && hasRanks(e.cards, '7', '2') && isOffSuit(e.cards),
  },
  {
    id: 'allin_67',
    title: 'Six-Seven',
    blurb: 'Sent it with 6-7. The original "speculative shove."',
    unlock: (e) => e.wentAllIn && hasRanks(e.cards, '6', '7'),
  },
  {
    id: 'allin_garbage',
    title: 'Send-It-O',
    blurb: 'All-in with two cards both 8 or below, offsuit. No kicker, no plan.',
    unlock: (e) => {
      if (!e.wentAllIn || !e.cards || e.cards.length !== 2) return false
      const low = ['2','3','4','5','6','7','8']
      return e.cards.every(c => low.includes(c.rank)) && isOffSuit(e.cards) && e.cards[0].rank !== e.cards[1].rank
    },
  },
  {
    id: 'cooler_aa_vs_kk',
    title: 'Set Over Set Energy',
    blurb: 'Won with pocket Aces in a showdown. Standard but satisfying.',
    unlock: (e) => e.won && e.wentToShowdown && hasRanks(e.cards, 'A', 'A'),
  },

  // ─── Volume / behavioral achievements ──────────────────────────────
  {
    id: 'nit',
    title: 'Nit',
    blurb: 'Folded 30 hands before voluntarily putting money in pot.',
    cumulative: (p) => p._nitFolds || 0,
    target: 30,
    onEvent: (p, e) => {
      if (e.foldedPreflop && !e.vpip) p._nitFolds = (p._nitFolds || 0) + 1
      else if (e.vpip) p._nitFolds = 0  // reset streak on action
    },
  },
  {
    id: 'risk_taker',
    title: 'Risk Taker',
    blurb: 'Played 20 hands voluntarily with garbage starting cards.',
    cumulative: (p) => p._riskCount || 0,
    target: 20,
    onEvent: (p, e) => {
      if (!e.vpip || !e.cards || e.cards.length !== 2) return
      const ranks = e.cards.map(c => c.rank)
      const low = new Set(['2','3','4','5','6','7'])
      const garbage = ranks[0] !== ranks[1] && ranks.every(r => low.has(r)) && isOffSuit(e.cards)
      if (garbage) p._riskCount = (p._riskCount || 0) + 1
    },
  },
  {
    id: 'pressure_machine',
    title: 'Pressure Machine',
    blurb: 'Raised 50 times across your session.',
    cumulative: (p) => p._raisesLifetime || 0,
    target: 50,
    onEvent: (p, e) => {
      p._raisesLifetime = (p._raisesLifetime || 0) + (e.raisesThisHand || 0)
    },
  },
  {
    id: 'comeback_kid',
    title: 'Comeback Kid',
    blurb: 'Won a hand after losing the previous one — three times running.',
    cumulative: (p) => p._comeback || 0,
    target: 3,
    onEvent: (p, e) => {
      if (e.won && p._prevWasLoss) p._comeback = (p._comeback || 0) + 1
      p._prevWasLoss = e.lost
    },
  },

  // ─── Pot-size / contrast achievements ──────────────────────────────
  {
    id: 'tiny_pot_winner',
    title: 'A Penny Saved',
    blurb: 'Won a pot of less than 30 chips.',
    unlock: (e) => e.won && e.potSize > 0 && e.potSize < 30,
  },
  {
    id: 'big_loss_tiny_win',
    title: 'Net Negative, Spiritually Positive',
    blurb: 'Lost 5,000+ in one hand, then won a 100-chip pot on the next.',
    cumulative: (p) => p._bigLossThenTinyWin ? 1 : 0,
    target: 1,
    onEvent: (p, e) => {
      if (p._lostBigLast && e.won && e.potSize <= 100) p._bigLossThenTinyWin = true
      p._lostBigLast = e.lost && e.chipsDelta <= -5000
    },
  },
  {
    id: 'whale_pot',
    title: 'Whale Watch',
    blurb: 'Won a pot of 20,000+ chips.',
    unlock: (e) => e.won && e.potSize >= 20000,
  },

  // ─── Side-bet milestones (cross-references the luck stat path) ─────
  {
    id: 'sidebet_first',
    title: 'Bet on the Bet',
    blurb: 'Won your first side bet.',
    unlock: (e) => (e.sideBetOutcomes || []).includes('win'),
  },
  {
    id: 'sidebet_longshot_legend',
    title: 'Longshot Legend',
    blurb: 'Hit three longshot side bets (entry < 30%) in one session.',
    cumulative: (p) => p._longshotsCount || 0,
    target: 3,
    onEvent: (p, e) => {
      if (e.sideBetLongshotWins) {
        p._longshotsCount = (p._longshotsCount || 0) + (e.sideBetLongshotWins || 0)
      }
    },
  },

  // ─── Showdown swagger ─────────────────────────────────────────────
  {
    id: 'showdown_with_72',
    title: 'I Did What?',
    blurb: 'Took 7-2 all the way to showdown. The pure form of poker.',
    unlock: (e) => e.wentToShowdown && hasRanks(e.cards, '7', '2'),
  },
  {
    id: 'split_master',
    title: 'Sharing Is Caring',
    blurb: 'Chopped a pot. Mutual respect.',
    unlock: (e) => e.split,
  },
  {
    id: 'three_in_a_row',
    title: 'Heater',
    blurb: 'Three wins in a row.',
    cumulative: (p) => p._heater || 0,
    target: 1,
    onEvent: (p, e) => {
      if (e.won) p._heaterStreak = (p._heaterStreak || 0) + 1
      else p._heaterStreak = 0
      if (p._heaterStreak >= 3) p._heater = 1
    },
  },
  {
    id: 'allin_call_underdog',
    title: 'Math Hater',
    blurb: 'Called an all-in as the equity underdog and survived.',
    unlock: () => false,  // wired via the luck stats path, not the per-hand event
  },
]

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]))
