// Daily challenges. The full list of 100+ entries is built parametrically
// from a few axes (hand type, count, betting style, etc.) so adding a new
// dimension grows the catalog without growing this file in lockstep.
//
// Each daily has a `check(event) → delta` predicate that runs once per
// completed hand for a given user. The event shape comes from
// dailyEngine.js's per-hand extractor:
//
//   {
//     won, lost, split,
//     handName,            // "Flush", "Two Pair", ...
//     cards: [{rank,suit}, {rank,suit}],
//     foldedPreflop, wentToShowdown, wentAllIn,
//     vpip,                // did the user voluntarily put money in pot
//     raisesThisHand,
//     chipsDelta,          // realized P/L for the hand (negative if lost)
//     potSize,
//   }
//
// `delta` is how much progress THIS hand contributes — usually 0 or 1, but
// some dailies count multiple events (e.g. "raise 20 times" can add ≥1
// per hand for the raisesThisHand counter).

const HAND_TYPES = [
  'One Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'
]

function hasRank(cards, rank) {
  return Array.isArray(cards) && cards.some(c => c?.rank === rank)
}
function isSuited(cards) {
  return cards?.length === 2 && cards[0]?.suit === cards[1]?.suit
}
function isOffSuit(cards) {
  return cards?.length === 2 && cards[0]?.suit !== cards[1]?.suit
}
function ranksOf(cards) {
  return cards?.map(c => c?.rank).filter(Boolean) || []
}
function hasRanks(cards, ...ranks) {
  const have = new Set(ranksOf(cards))
  return ranks.every(r => have.has(r))
}
const LOW_RANKS = new Set(['2', '3', '4', '5', '6', '7'])
function bothLow(cards) {
  return ranksOf(cards).length === 2 && ranksOf(cards).every(r => LOW_RANKS.has(r))
}

function buildDailies() {
  const list = []
  function add(d) { list.push(d) }

  // ─── Hand-type wins (1× and 2×) ─────────────────────────────────────
  for (const h of HAND_TYPES) {
    const slug = h.toLowerCase().replace(/\s+/g, '_')
    add({
      id: `win_${slug}_1`,
      title: `Win with a ${h}`,
      description: `Show down a ${h} and take the pot.`,
      target: 1,
      check: (e) => (e.won && e.handName === h) ? 1 : 0,
    })
  }
  for (const h of ['One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush']) {
    const slug = h.toLowerCase().replace(/\s+/g, '_')
    add({
      id: `win_${slug}_2`,
      title: `Win two ${h.toLowerCase()}s`,
      description: `Win two separate hands showing ${h}.`,
      target: 2,
      check: (e) => (e.won && e.handName === h) ? 1 : 0,
    })
  }

  // ─── Counted wins ──────────────────────────────────────────────────
  for (const n of [3, 5, 8, 10]) {
    add({
      id: `win_n_hands_${n}`,
      title: `Win ${n} hands`,
      description: `Take down ${n} pots in any way you can.`,
      target: n,
      check: (e) => e.won ? 1 : 0,
    })
  }
  for (const n of [3, 5, 8]) {
    add({
      id: `showdown_wins_${n}`,
      title: `Win ${n} showdowns`,
      description: `Survive to the river ${n} times and have the best hand.`,
      target: n,
      check: (e) => (e.won && e.wentToShowdown) ? 1 : 0,
    })
  }
  for (const n of [3, 5]) {
    add({
      id: `win_no_showdown_${n}`,
      title: `Steal ${n} pots`,
      description: `Win ${n} hands without going to showdown.`,
      target: n,
      check: (e) => (e.won && !e.wentToShowdown) ? 1 : 0,
    })
  }

  // ─── "Win with shitty cards" — the funny ones ──────────────────────
  add({
    id: 'win_with_72',
    title: 'Win with 7-2',
    description: 'The worst starting hand in poker. You played it. You won. We forgive you.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, '7', '2')) ? 1 : 0,
  })
  add({
    id: 'win_with_72o',
    title: 'Win with 7-2 offsuit',
    description: 'The worst-of-the-worst. Brick by brick.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, '7', '2') && isOffSuit(e.cards)) ? 1 : 0,
  })
  add({
    id: 'win_with_27_show',
    title: 'Show down 7-2 and win',
    description: 'Don\'t just win it — make them watch.',
    target: 1,
    check: (e) => (e.won && e.wentToShowdown && hasRanks(e.cards, '7', '2')) ? 1 : 0,
  })
  add({
    id: 'win_with_low_low',
    title: 'Win with two low cards',
    description: 'Both hole cards 7 or below, and you came out ahead.',
    target: 1,
    check: (e) => (e.won && bothLow(e.cards)) ? 1 : 0,
  })
  add({
    id: 'win_with_low_low_3',
    title: 'Win three low-low hands',
    description: 'You are the patron saint of garbage cards.',
    target: 3,
    check: (e) => (e.won && bothLow(e.cards)) ? 1 : 0,
  })

  // ─── Premium-card dailies (the disciplined version) ─────────────────
  add({
    id: 'win_with_aces',
    title: 'Win with pocket Aces',
    description: 'Pocket rockets, no slow-roll.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'A', 'A')) ? 1 : 0,
  })
  add({
    id: 'win_with_kings',
    title: 'Win with pocket Kings',
    description: 'Cowboys hold up for once.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'K', 'K')) ? 1 : 0,
  })
  for (const r of ['Q', 'J', '10']) {
    add({
      id: `win_pocket_${r.toLowerCase()}`,
      title: `Win with pocket ${r}s`,
      description: `Pocket pair, paid off.`,
      target: 1,
      check: (e) => (e.won && hasRanks(e.cards, r, r)) ? 1 : 0,
    })
  }
  add({
    id: 'win_with_ak_suited',
    title: 'Win with suited Big Slick',
    description: 'A-K suited, classic.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'A', 'K') && isSuited(e.cards)) ? 1 : 0,
  })

  // ─── Aggression / pot-control dailies ──────────────────────────────
  for (const n of [5, 10, 20]) {
    add({
      id: `raise_${n}`,
      title: `Raise ${n} times`,
      description: `Apply pressure — raise the pot ${n} times in one day.`,
      target: n,
      check: (e) => e.raisesThisHand || 0,
    })
  }
  for (const n of [3, 5, 10]) {
    add({
      id: `fold_preflop_${n}`,
      title: `Fold pre-flop ${n} times`,
      description: `Discipline is a skill.`,
      target: n,
      check: (e) => e.foldedPreflop ? 1 : 0,
    })
  }
  for (const n of [1, 3, 5]) {
    add({
      id: `all_in_${n}`,
      title: `Go all-in ${n === 1 ? 'once' : n + ' times'}`,
      description: `Push the whole stack in. ${n > 1 ? 'Repeatedly.' : ''}`,
      target: n,
      check: (e) => e.wentAllIn ? 1 : 0,
    })
  }
  add({
    id: 'all_in_terrible',
    title: 'Go all-in with terrible cards',
    description: '7-2 / 9-3 / J-2 — pick your poison. Win or lose, you sent it.',
    target: 1,
    check: (e) => {
      if (!e.wentAllIn) return 0
      // "Terrible" = both ranks low + offsuit + no pair + no broadway.
      const ranks = ranksOf(e.cards)
      const both = ranks.length === 2 ? ranks : null
      if (!both) return 0
      if (both[0] === both[1]) return 0 // a pair isn't terrible
      const low = both.every(r => LOW_RANKS.has(r) || r === '8')
      const noBroadway = !both.some(r => ['J', 'Q', 'K', 'A'].includes(r))
      return (low && noBroadway && isOffSuit(e.cards)) ? 1 : 0
    },
  })

  // ─── Split-pot dailies ─────────────────────────────────────────────
  for (const n of [1, 2, 3]) {
    add({
      id: `split_${n}`,
      title: `Get ${n} split pot${n > 1 ? 's' : ''}`,
      description: `Chop with another player ${n} time${n > 1 ? 's' : ''}.`,
      target: n,
      check: (e) => e.split ? 1 : 0,
    })
  }

  // ─── Chip-volume dailies ───────────────────────────────────────────
  for (const amt of [500, 1000, 2500, 5000, 10000]) {
    add({
      id: `chips_won_${amt}`,
      title: `Win ${amt.toLocaleString()} chips`,
      description: `Pile up ${amt.toLocaleString()} chips of profit across the day.`,
      target: amt,
      check: (e) => e.chipsDelta > 0 ? e.chipsDelta : 0,
    })
  }
  add({
    id: 'win_big_pot',
    title: 'Win a pot of 5,000+',
    description: 'A single pot worth 5,000 chips or more.',
    target: 1,
    check: (e) => (e.won && e.potSize >= 5000) ? 1 : 0,
  })
  add({
    id: 'win_huge_pot',
    title: 'Win a 10k pot',
    description: 'A single pot worth 10,000 chips or more.',
    target: 1,
    check: (e) => (e.won && e.potSize >= 10000) ? 1 : 0,
  })

  // ─── Hand-count dailies ───────────────────────────────────────────
  for (const n of [10, 20, 30]) {
    add({
      id: `play_n_${n}`,
      title: `Play ${n} hands`,
      description: `Stick around. Play ${n} hands today.`,
      target: n,
      check: () => 1,  // every hand counts
    })
  }

  // ─── Specific-rank dailies ─────────────────────────────────────────
  for (const r of ['A', 'K', 'Q']) {
    add({
      id: `win_holding_${r.toLowerCase()}`,
      title: `Win holding a ${r === 'A' ? 'Ace' : r === 'K' ? 'King' : 'Queen'}`,
      description: `At least one of your hole cards must be a ${r === 'A' ? 'Ace' : r === 'K' ? 'King' : 'Queen'}.`,
      target: 1,
      check: (e) => (e.won && hasRank(e.cards, r)) ? 1 : 0,
    })
  }
  add({
    id: 'win_suited_connectors',
    title: 'Win with suited connectors',
    description: 'Two ranks one apart, same suit. (e.g. 8♠ 9♠)',
    target: 1,
    check: (e) => {
      if (!e.won || !isSuited(e.cards)) return 0
      const order = ['2','3','4','5','6','7','8','9','10','J','Q','K','A']
      const [a, b] = ranksOf(e.cards)
      const idxA = order.indexOf(a), idxB = order.indexOf(b)
      return Math.abs(idxA - idxB) === 1 ? 1 : 0
    },
  })

  // ─── Endurance dailies ─────────────────────────────────────────────
  add({
    id: 'win_after_loss',
    title: 'Comeback hand',
    description: 'Lose a hand, then win the next.',
    target: 1,
    check: (e, state) => {
      const triggered = state._prevLoss && e.won
      state._prevLoss = e.lost  // arm/disarm based on this hand's result
      return triggered ? 1 : 0
    },
  })
  add({
    id: 'three_in_a_row',
    title: 'Three wins in a row',
    description: 'Win three consecutive hands.',
    target: 1,
    check: (e, state) => {
      if (e.won) state._winStreak = (state._winStreak || 0) + 1
      else state._winStreak = 0
      if (state._winStreak >= 3) {
        state._winStreak = 0
        return 1
      }
      return 0
    },
  })

  // ─── More pocket pairs ────────────────────────────────────────────
  for (const r of ['9', '8', '7', '6', '5']) {
    add({
      id: `win_pocket_${r}`,
      title: `Win with pocket ${r}s`,
      description: `Set-mining paid off.`,
      target: 1,
      check: (e) => (e.won && hasRanks(e.cards, r, r)) ? 1 : 0,
    })
  }

  // ─── Board-state wins (uses event.communityCards) ─────────────────
  function suitCounts(board) {
    const m = {}
    for (const c of board || []) m[c.suit] = (m[c.suit] || 0) + 1
    return m
  }
  function maxSuit(board) {
    return Math.max(0, ...Object.values(suitCounts(board)))
  }
  function hasBoardRank(board, rank) {
    return (board || []).some(c => c?.rank === rank)
  }
  function boardPaired(board) {
    const r = (board || []).map(c => c?.rank)
    return new Set(r).size < r.length
  }
  add({
    id: 'win_paired_board',
    title: 'Win on a paired board',
    description: 'Any rank shows twice or more in the community cards.',
    target: 1,
    check: (e) => (e.won && boardPaired(e.communityCards)) ? 1 : 0,
  })
  add({
    id: 'win_rainbow',
    title: 'Win on a rainbow board',
    description: 'No two community cards share a suit (≥3 suits represented).',
    target: 1,
    check: (e) => {
      if (!e.won || !e.communityCards || e.communityCards.length < 3) return 0
      const suits = new Set((e.communityCards || []).map(c => c.suit))
      return suits.size >= e.communityCards.length ? 1 : 0
    },
  })
  add({
    id: 'win_flush_possible',
    title: 'Win when a flush was possible',
    description: 'Board shows 3+ of one suit, and you still took it down.',
    target: 1,
    check: (e) => (e.won && maxSuit(e.communityCards) >= 3) ? 1 : 0,
  })
  add({
    id: 'win_ace_board',
    title: 'Win with an Ace on board',
    description: 'Top-pair-able board, top-pair-able outcome.',
    target: 1,
    check: (e) => (e.won && hasBoardRank(e.communityCards, 'A')) ? 1 : 0,
  })
  add({
    id: 'win_low_board',
    title: 'Win on a low board',
    description: 'No card on the board higher than a 9.',
    target: 1,
    check: (e) => {
      if (!e.won || !e.communityCards) return 0
      const order = '23456789'
      return e.communityCards.every(c => order.includes(c.rank)) ? 1 : 0
    },
  })
  add({
    id: 'win_broadway_board',
    title: 'Win on a broadway board',
    description: 'Every community card is 10 or higher.',
    target: 1,
    check: (e) => {
      if (!e.won || !e.communityCards || e.communityCards.length < 3) return 0
      const broadway = new Set(['10', 'J', 'Q', 'K', 'A'])
      return e.communityCards.every(c => broadway.has(c.rank)) ? 1 : 0
    },
  })

  // ─── Bigger hand-count + raise-count dailies ──────────────────────
  for (const n of [15, 25, 40]) {
    add({
      id: `play_long_${n}`,
      title: `Play ${n} hands`,
      description: `Endurance ${n === 40 ? 'mode' : 'check'}.`,
      target: n,
      check: () => 1,
    })
  }
  for (const n of [15, 30]) {
    add({
      id: `bigraise_${n}`,
      title: `Raise ${n} times`,
      description: `Keep the pressure on.`,
      target: n,
      check: (e) => e.raisesThisHand || 0,
    })
  }
  for (const n of [5, 10]) {
    add({
      id: `vpip_${n}`,
      title: `Play ${n} hands voluntarily`,
      description: `Don't just fold preflop — get involved ${n} times.`,
      target: n,
      check: (e) => e.vpip ? 1 : 0,
    })
  }

  // ─── Side-bet dailies (uses event.sideBetOutcomes) ────────────────
  // sideBetOutcomes is a list pushed by the engine on hand-end summarizing
  // the user's resolved side-bet positions for this hand.
  add({
    id: 'sidebet_first_win',
    title: 'Win a side bet',
    description: 'Hit any prop bet at the table.',
    target: 1,
    check: (e) => (e.sideBetOutcomes || []).filter(s => s === 'win').length,
  })
  for (const n of [3, 5]) {
    add({
      id: `sidebet_wins_${n}`,
      title: `Win ${n} side bets`,
      description: `Run good on the prop markets.`,
      target: n,
      check: (e) => (e.sideBetOutcomes || []).filter(s => s === 'win').length,
    })
  }
  add({
    id: 'sidebet_longshot_win',
    title: 'Hit a longshot side bet',
    description: 'Win a side bet you bought at under 30%.',
    target: 1,
    check: (e) => (e.sideBetLongshotWins || 0),
  })

  // ─── All-in survival / showdown dailies ───────────────────────────
  add({
    id: 'win_after_allin',
    title: 'Win an all-in showdown',
    description: 'Push the stack, hold the line.',
    target: 1,
    check: (e) => (e.won && e.wentAllIn) ? 1 : 0,
  })
  add({
    id: 'survive_3_allins',
    title: 'Win three all-ins',
    description: 'Three separate all-in wins today.',
    target: 3,
    check: (e) => (e.won && e.wentAllIn) ? 1 : 0,
  })

  // ─── "Discipline" dailies — folding a lot ─────────────────────────
  for (const n of [15, 25]) {
    add({
      id: `discipline_${n}`,
      title: `Fold ${n} pre-flops`,
      description: `Tight is right.`,
      target: n,
      check: (e) => e.foldedPreflop ? 1 : 0,
    })
  }

  // ─── Specific rank pairs — Big Slick, Big Chick, etc. ─────────────
  add({
    id: 'win_aq',
    title: 'Win with A-Q (Big Chick)',
    description: 'A-Q in either suit configuration.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'A', 'Q')) ? 1 : 0,
  })
  add({
    id: 'win_aj',
    title: 'Win with A-J',
    description: 'A-J — known as "Ajax" in some rooms.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'A', 'J')) ? 1 : 0,
  })
  add({
    id: 'win_kq',
    title: 'Win with K-Q',
    description: 'Royal couple cashes.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, 'K', 'Q')) ? 1 : 0,
  })
  add({
    id: 'win_67_suited',
    title: 'Win with suited 6-7',
    description: 'Tiny suited connector takes one down.',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, '6', '7') && isSuited(e.cards)) ? 1 : 0,
  })
  add({
    id: 'win_89_suited',
    title: 'Win with suited 8-9',
    description: 'The "speculation hand."',
    target: 1,
    check: (e) => (e.won && hasRanks(e.cards, '8', '9') && isSuited(e.cards)) ? 1 : 0,
  })

  // ─── More chip-volume + final endurance targets ───────────────────
  for (const amt of [15000, 25000, 50000]) {
    add({
      id: `chips_won_big_${amt}`,
      title: `Win ${amt.toLocaleString()} chips`,
      description: `${amt >= 25000 ? 'Whale watch.' : 'Get paid.'}`,
      target: amt,
      check: (e) => e.chipsDelta > 0 ? e.chipsDelta : 0,
    })
  }
  add({
    id: 'win_two_in_a_row',
    title: 'Two wins in a row',
    description: 'Back-to-back wins.',
    target: 1,
    check: (e, state) => {
      if (e.won) state._winStreak2 = (state._winStreak2 || 0) + 1
      else state._winStreak2 = 0
      if (state._winStreak2 >= 2) { state._winStreak2 = 0; return 1 }
      return 0
    },
  })
  add({
    id: 'fold_to_aggression',
    title: 'Fold to a raise 3 times',
    description: 'Pick your spots — lay it down when they come at you.',
    target: 3,
    check: (e) => e.foldedToRaise ? 1 : 0,
  })
  add({
    id: 'win_with_aces_2',
    title: 'Win twice with pocket Aces',
    description: 'Twice in one day. Run good.',
    target: 2,
    check: (e) => (e.won && hasRanks(e.cards, 'A', 'A')) ? 1 : 0,
  })
  add({
    id: 'win_3bet',
    title: 'Win a three-bet pot',
    description: 'You re-raised pre-flop and took the pot.',
    target: 1,
    check: (e) => (e.won && (e.raisesThisHand || 0) >= 2) ? 1 : 0,
  })
  add({
    id: 'play_no_premium',
    title: 'Win without an Ace or King',
    description: 'Pick up a pot with neither hole card being A or K.',
    target: 1,
    check: (e) => (e.won && !hasRank(e.cards, 'A') && !hasRank(e.cards, 'K')) ? 1 : 0,
  })

  return list
}

export const DAILY_CATALOG = buildDailies()
export const DAILY_BY_ID = Object.fromEntries(DAILY_CATALOG.map(d => [d.id, d]))
