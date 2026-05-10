// Reference for the docs panel in the JS code editor. Each entry is shown
// in the side rail; users can click one to insert a `ctx.<path>` snippet
// at their cursor.

export const CTX_GROUPS = [
  {
    title: 'Quick signals',
    description: 'High-level summaries — easiest place to start.',
    items: [
      { path: 'phase', type: 'string', doc: '"preflop" | "flop" | "turn" | "river"' },
      { path: 'roundIndex', type: 'number', doc: '0=preflop, 1=flop, 2=turn, 3=river' },
      { path: 'streetIsPreflop', type: 'boolean' },
      { path: 'streetIsPostflop', type: 'boolean' },
      { path: 'position', type: 'string', doc: 'btn | sb | bb | utg | middle | late' },
      { path: 'isHeadsUp', type: 'boolean', doc: 'true when only one opponent left' },
      { path: 'handStrength', type: 'string', doc: 'trash | weak | medium | strong | premium' },
      { path: 'handStrengthIndex', type: 'number', doc: 'Numeric tier 0..4 — handy for >= comparisons' },
      { path: 'bestHand', type: 'object', doc: 'Postflop only: { rank, name, bestCards }. rank: 0=high, 1=pair, 2=2pair, 3=trips, 4=straight, 5=flush, 6=full house, 7=quads, 8=straight flush, 9=royal' }
    ]
  },
  {
    title: 'Pot, bets, sizing',
    items: [
      { path: 'potSize', type: 'number', doc: 'Total chips in the pot right now.' },
      { path: 'currentBet', type: 'number', doc: "This round's bet to match." },
      { path: 'toCall', type: 'number', doc: 'Chips you need to add to call (0 if checking is free).' },
      { path: 'potOdds', type: 'number', doc: 'toCall / (pot + toCall), 0..1. Above ~0.33 is good odds.' },
      { path: 'minRaiseTarget', type: 'number', doc: 'Smallest legal raise target.' },
      { path: 'maxRaiseTarget', type: 'number', doc: 'Your max possible raise target (= all-in).' },
      { path: 'spr', type: 'number', doc: 'Stack-to-pot ratio. <1 ≈ committed; <4 ≈ commit with strong; >10 ≈ deep, play careful.' },
      { path: 'aggressionCount', type: 'number', doc: '1=bet, 2=raise, 3=re-raise, 4+=war.' },
      { path: 'facingBet', type: 'boolean' },
      { path: 'facingRaise', type: 'boolean' },
      { path: 'facingAllIn', type: 'boolean' },
      { path: 'lastOpponentAction', type: 'string', doc: 'fold | check | call | raise | all_in | sb | bb' },
      { path: 'bigBlind', type: 'number', doc: "Current table big blind. Updates live when the table votes a new level." },
      { path: 'smallBlind', type: 'number', doc: 'Current table small blind.' },
      { path: 'blindLevelLabel', type: 'string', doc: '"5/10", "25/50", "100/200", "250/500", "500/1000".' }
    ]
  },
  {
    title: 'BB-relative views',
    description: 'Same numbers above, divided by the current big blind. Use these so your strategy scales when blinds change.',
    items: [
      { path: 'myStackBB', type: 'number', doc: 'Your stack expressed in big blinds.' },
      { path: 'effectiveStackBB', type: 'number', doc: 'min(my stack, smallest active opp stack) in big blinds.' },
      { path: 'potSizeBB', type: 'number', doc: 'Pot size in big blinds.' },
      { path: 'currentBetBB', type: 'number' },
      { path: 'toCallBB', type: 'number', doc: 'Chips to call in big blinds.' }
    ]
  },
  {
    title: 'Round dynamics',
    description: 'Who has acted, who is left to act, who has the lead.',
    items: [
      { path: 'lastAggressor', type: 'object', doc: 'Most recent voluntary raise/all-in this hand: { id, name, action, amount, phase, seq, isMe }. null if no one has bet yet.' },
      { path: 'playersToAct', type: 'number', doc: 'Active opponents (not folded, not all-in) who still have to act this betting round.' },
      { path: 'playersActedThisRound', type: 'number', doc: 'Active opponents who have already acted this round.' },
      { path: 'preflopActionProfile', type: 'string', doc: '"unopened" | "opened" | "three_bet" | "four_bet_plus" — the action story before you have to decide.' },
      { path: 'committed', type: 'boolean', doc: "true when at least half of your starting-this-hand stack is already in the pot — you're priced in." }
    ]
  },
  {
    title: 'Stack landscape',
    description: 'Who has chips, where do you stand?',
    items: [
      { path: 'chipLeader', type: 'object', doc: '{ id, name, chips, isMe } — the seat with the biggest stack at the table.' },
      { path: 'shortStack', type: 'object', doc: '{ id, name, chips, isMe } — the seat with the smallest stack.' },
      { path: 'myChipRank', type: 'number', doc: '1-indexed rank by stack (1 = chip leader).' },
      { path: 'totalChipsInPlay', type: 'number', doc: 'Sum of every chip across every seat at the table.' },
      { path: 'opponents[].effectiveStackBB', type: 'number', doc: 'Per-opponent effective stack vs you, in big blinds.' },
      { path: 'opponents[].committed', type: 'boolean', doc: "Is that opponent already pot-committed?" }
    ]
  },
  {
    title: 'Draws (postflop only)',
    description: 'Coarse-but-useful flush/straight draw flags + outs estimate. Use ctx.bestHand for completed hands.',
    items: [
      { path: 'draws.hasFlushDraw', type: 'boolean', doc: 'true if you hold 4 cards of one suit.' },
      { path: 'draws.hasOpenEnded', type: 'boolean', doc: 'true if you have 4 connected cards (straight needs either end).' },
      { path: 'draws.hasGutshot', type: 'boolean', doc: 'true if you need exactly one specific middle rank for a straight.' },
      { path: 'draws.outs', type: 'number', doc: 'Rough out count — flush=9, open-ended=8, gutshot=4, combo draws -1 for overlap.' },
      { path: 'handsSinceLastWin', type: 'number', doc: '0 = won the most recent completed hand. -1 = no win recorded at this table.' }
    ]
  },
  {
    title: 'Cards',
    items: [
      { path: 'holeCards', type: 'array', doc: '[{rank, suit}, {rank, suit}] — ranks: "2"-"10","J","Q","K","A"; suits: hearts/diamonds/clubs/spades' },
      { path: 'communityCards', type: 'array', doc: '0–5 community cards depending on phase' }
    ]
  },
  {
    title: 'Me (this bot)',
    items: [
      { path: 'me.id', type: 'string', doc: 'Seat id at this table.' },
      { path: 'me.name', type: 'string' },
      { path: 'me.seat', type: 'number' },
      { path: 'me.chips', type: 'number', doc: 'Chips remaining in your stack.' },
      { path: 'me.bet', type: 'number', doc: "Chips you've put in this round." },
      { path: 'me.totalBetThisHand', type: 'number', doc: 'Total chips committed across all rounds of this hand.' },
      { path: 'me.position', type: 'string' },
      { path: 'me.stats.handsObserved', type: 'number' },
      { path: 'me.stats.handsPlayed', type: 'number', doc: 'Hands you voluntarily put money in.' },
      { path: 'me.stats.vpip', type: 'number', doc: 'Voluntarily-put-in-pot frequency 0..1.' },
      { path: 'me.stats.aggressionFreq', type: 'number', doc: 'Raise/all-in frequency per hand 0..1.' },
      { path: 'me.stats.profit', type: 'number', doc: 'Net chips since you joined the table.' },
      { path: 'me.stats.showdownsSeen', type: 'number' },
      { path: 'me.stats.showdownsWon', type: 'number' },
      { path: 'myStack', type: 'number', doc: 'Shortcut for me.chips.' },
      { path: 'effectiveStack', type: 'number', doc: 'min(my stack, smallest active opp stack).' }
    ]
  },
  {
    title: 'Opponents (array)',
    description: 'One entry per other seat at the table. Use ctx.opponents.find(...) or .filter(...).',
    items: [
      { path: 'numActiveOpponents', type: 'number' },
      { path: 'opponents[].id', type: 'string' },
      { path: 'opponents[].seat', type: 'number' },
      { path: 'opponents[].name', type: 'string' },
      { path: 'opponents[].isBot', type: 'boolean' },
      { path: 'opponents[].chips', type: 'number' },
      { path: 'opponents[].bet', type: 'number', doc: 'Chips put in this round.' },
      { path: 'opponents[].totalBet', type: 'number', doc: 'Chips committed this hand.' },
      { path: 'opponents[].folded', type: 'boolean' },
      { path: 'opponents[].allIn', type: 'boolean' },
      { path: 'opponents[].position', type: 'string' },
      { path: 'opponents[].lastAction', type: 'object', doc: '{ action, amount } or null' },
      { path: 'opponents[].stats.handsObserved', type: 'number' },
      { path: 'opponents[].stats.vpip', type: 'number', doc: 'Their voluntary-pot frequency 0..1.' },
      { path: 'opponents[].stats.aggressionFreq', type: 'number' },
      { path: 'opponents[].stats.foldsToBet', type: 'number', doc: 'Times they folded to a bet at this table.' },
      { path: 'opponents[].stats.profit', type: 'number', doc: 'Their net at this table.' },
      { path: 'opponents[].stats.showdownsSeen', type: 'number', doc: 'Times they reached showdown.' },
      { path: 'opponents[].stats.showdownsWon', type: 'number' },
      { path: 'opponents[].stats.wtsdRate', type: 'number', doc: 'Went-to-showdown rate per hand observed.' },
      { path: 'opponents[].stats.wonAtShowdownRate', type: 'number', doc: 'Of their showdowns, how often they won.' },
      { path: 'opponents[].stats.recentBetSizes', type: 'array', doc: 'Last up-to-10 raise/all-in target totals.' },
      { path: 'opponents[].stats.avgRecentBetSize', type: 'number' }
    ]
  },
  {
    title: 'History',
    description: 'Use this to detect bluffs, sticky callers, momentum, range narrowing.',
    items: [
      { path: 'actionHistory', type: 'array', doc: 'This hand: [{ seq, phase, playerId, playerName, action, amount, toCallBefore, potBefore }]' },
      { path: 'handHistory', type: 'array', doc: 'Up to 25 prior completed hands at this table.' },
      { path: 'handHistory[].handIndex', type: 'number' },
      { path: 'handHistory[].type', type: 'string', doc: '"showdown" | "fold_out"' },
      { path: 'handHistory[].pot', type: 'number' },
      { path: 'handHistory[].communityCards', type: 'array' },
      { path: 'handHistory[].winners', type: 'array', doc: '[{ playerId, username, chips, handName }]' },
      { path: 'handHistory[].profit', type: 'number', doc: 'Your profit on that hand.' },
      { path: 'handHistory[].profitByPlayer', type: 'object', doc: '{ playerId: profit, ... }' },
      { path: 'handHistory[].cards', type: 'object', doc: 'Showdown reveals. { playerId: [card,card] | null }. null = mucked.' },
      { path: 'handHistory[].actions', type: 'array', doc: 'Full per-hand action log.' },
      { path: 'handHistory[].actionsByPlayer', type: 'object', doc: '{ playerId: [actions...] }' },
      { path: 'lastShowdown', type: 'object', doc: 'Most recent handHistory entry of type "showdown" or null.' },
      { path: 'handIndex', type: 'number', doc: 'Hand counter at this table.' }
    ]
  },
  {
    title: 'Helpers (no ctx. prefix)',
    description: 'Functions in scope alongside ctx.',
    items: [
      { path: 'handStrength(holeCards, communityCards)', type: 'fn', doc: 'Classify any 2-card hand into a tier name. Useful for evaluating opponent ranges.' },
      { path: 'evaluateCards(cards)', type: 'fn', doc: 'Evaluate any 5–7 card combination → { rank, name, bestCards }.' },
      { path: 'randomFloat(min, max)', type: 'fn', doc: 'Uniform random in [min, max). Defaults to [0, 1).' },
      { path: 'console.log(...)', type: 'fn', doc: 'Output is captured to your bot\'s debug log ring (last 20 lines).' }
    ]
  }
]
