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
      { path: 'streetIsPreflop', type: 'boolean', doc: 'True during the preflop betting round. Equivalent to `phase === "preflop"`.' },
      { path: 'streetIsPostflop', type: 'boolean', doc: 'True on flop/turn/river. Equivalent to `phase !== "preflop"` once the hand is in progress.' },
      { path: 'position', type: 'string', doc: 'btn | sb | bb | utg | middle | late' },
      { path: 'isHeadsUp', type: 'boolean', doc: 'true when only one opponent left' },
      { path: 'handStrength', type: 'string', doc: 'trash | weak | medium | strong | premium' },
      { path: 'handStrengthIndex', type: 'number', doc: 'Numeric tier 0..4 — handy for >= comparisons' },
      { path: 'handStrengthScore', type: 'number', doc: 'Numeric 0..1 strength from the industry-grade analyzer. Preflop: AA=1.00, KK=0.97, QQ=0.94, JJ=0.91, TT=0.89, AKs=0.88, AKo=0.86, AQs=0.86, 99=0.83, 22≈0.56, 72o≈0.13. Postflop: relative-strength score that adjusts the made-hand baseline (pair=0.30, 2p=0.50, set=0.66, straight=0.78, flush=0.83, full=0.92, quads=0.97) for board texture, kicker, and vulnerability.' },
      { path: 'handCategory', type: 'string', doc: 'Alias for handStrength. Same five tiers.' },
      { path: 'bestHand', type: 'object', doc: 'Postflop only: { rank, name, bestCards }. rank: 0=high, 1=pair, 2=2pair, 3=trips, 4=straight, 5=flush, 6=full house, 7=quads, 8=straight flush, 9=royal' },
      { path: 'streetIsFlop', type: 'boolean', doc: 'True only during flop betting (3 community cards revealed).' },
      { path: 'streetIsTurn', type: 'boolean', doc: 'True only during turn betting (4 community cards revealed).' },
      { path: 'streetIsRiver', type: 'boolean', doc: 'True only during river betting (5 community cards revealed).' }
    ]
  },
  {
    title: 'Hand analysis (industry-grade)',
    description: 'Rich classification of your own hand. Use these instead of recomputing hand strength yourself — the analyzer is the single source of truth for "what kind of hand do I have".',
    items: [
      { path: 'handAnalysis.preflop.label', type: 'string', doc: 'Canonical hand label: AA, AKs, AKo, T9s, 72o, etc. 169 distinct values.' },
      { path: 'handAnalysis.preflop.score', type: 'number', doc: '0..1. Calibrated against win-rate tables. AA=1.00, AKo=0.86, 22=0.555, 72o≈0.13.' },
      { path: 'handAnalysis.preflop.tier', type: 'string', doc: '"premium" (top ~3% — AA-TT, AKs, AKo, AQs) | "strong" (top ~10%) | "medium" (top ~25%) | "weak" (top ~45%) | "trash" (rest).' },
      { path: 'handAnalysis.preflop.highRank', type: 'number', doc: '2..14 (2=deuce, 11=J, 12=Q, 13=K, 14=A).' },
      { path: 'handAnalysis.preflop.lowRank', type: 'number', doc: '2..14.' },
      { path: 'handAnalysis.preflop.suited', type: 'boolean' },
      { path: 'handAnalysis.preflop.pair', type: 'boolean' },
      { path: 'handAnalysis.preflop.gap', type: 'number', doc: '0 for pairs, 1 for AK / connectors, 2 for one-gappers, etc.' },
      { path: 'handAnalysis.preflop.isBigPair', type: 'boolean', doc: 'JJ+ (high rank ≥ 11).' },
      { path: 'handAnalysis.preflop.isMidPair', type: 'boolean', doc: '77-TT.' },
      { path: 'handAnalysis.preflop.isSmallPair', type: 'boolean', doc: '22-66.' },
      { path: 'handAnalysis.preflop.isBroadway', type: 'boolean', doc: 'Both ranks ≥ T (non-pair).' },
      { path: 'handAnalysis.preflop.isSuitedAce', type: 'boolean' },
      { path: 'handAnalysis.preflop.isOffsuitAce', type: 'boolean' },
      { path: 'handAnalysis.preflop.isSuitedConnector', type: 'boolean', doc: 'Suited with gap=1 and low rank ≥ 4 (54s, 65s, …, JTs).' },
      { path: 'handAnalysis.preflop.isSuitedGapper', type: 'boolean' },
      { path: 'handAnalysis.preflop.neverFoldPreflop', type: 'boolean', doc: 'TRUE iff tier === "premium". The hard rule that prevents AK from folding preflop. Branch on this in your rule logic.' },
      { path: 'handAnalysis.preflop.neverOpen', type: 'boolean', doc: 'Trash offsuit garbage — never opens from any position.' },
      { path: 'handAnalysis.preflop.playableUTG', type: 'boolean' },
      { path: 'handAnalysis.preflop.playableMP', type: 'boolean' },
      { path: 'handAnalysis.preflop.playableCO', type: 'boolean' },
      { path: 'handAnalysis.preflop.playableBTN', type: 'boolean' },
      { path: 'handAnalysis.preflop.threeBetWorthy', type: 'boolean', doc: 'Strong enough to 3-bet for value.' },
      { path: 'handAnalysis.preflop.threeBetBluffCandidate', type: 'boolean', doc: 'Right shape to mix in as a 3-bet bluff (suited, mid-range strength).' },
      { path: 'handAnalysis.postflop', type: 'object', doc: 'NULL preflop. Populated on flop+. See sub-fields below.' },
      { path: 'handAnalysis.postflop.made.rank', type: 'number', doc: '0=high card, 1=pair, 2=two pair, 3=trips/set, 4=straight, 5=flush, 6=full house, 7=quads, 8=straight flush, 9=royal.' },
      { path: 'handAnalysis.postflop.made.name', type: 'string', doc: '"Pair", "Two Pair", "Three of a Kind", etc.' },
      { path: 'handAnalysis.postflop.made.bestCards', type: 'array', doc: 'The 5 cards making your best hand.' },
      { path: 'handAnalysis.postflop.score', type: 'number', doc: '0..1 relative strength adjusted for board texture. Same number as ctx.handStrengthScore postflop.' },
      { path: 'handAnalysis.postflop.relativeStrength', type: 'number', doc: 'Alias for score.' },
      { path: 'handAnalysis.postflop.baseScore', type: 'number', doc: 'Pre-adjustment baseline from made-hand rank (board-blind).' },
      { path: 'handAnalysis.postflop.valueClass', type: 'string', doc: '"air" | "thin" | "medium" | "strong" | "nut". Drives bet sizing.' },
      { path: 'handAnalysis.postflop.commitmentSuggestion', type: 'string', doc: '"commit" | "pot-control" | "discard". One-glance gut check.' },
      { path: 'handAnalysis.postflop.vulnerability', type: 'string', doc: '"low" | "medium" | "high". How often a turn/river degrades this hand.' },
      { path: 'handAnalysis.postflop.pair.isOverpair', type: 'boolean', doc: 'Pocket pair above the top board card. Only set when made.rank === 1.' },
      { path: 'handAnalysis.postflop.pair.isTopPair', type: 'boolean', doc: 'One hole card paired the highest board card.' },
      { path: 'handAnalysis.postflop.pair.isMidPair', type: 'boolean' },
      { path: 'handAnalysis.postflop.pair.isUnderpair', type: 'boolean', doc: 'Pocket pair below the lowest board card.' },
      { path: 'handAnalysis.postflop.pair.isBottomPair', type: 'boolean' },
      { path: 'handAnalysis.postflop.pair.kickerStrength', type: 'string', doc: '"strong" (A/K) | "medium" (Q/J) | "weak" (T or less) | "n/a" (pocket pair).' },
      { path: 'handAnalysis.postflop.pair.pairLabel', type: 'string', doc: '"overpair" | "pocket-pair" | "top-pair-strong-kicker" | "top-pair-medium-kicker" | "top-pair-weak-kicker" | "middle-pair" | "weak-pair".' },
      { path: 'handAnalysis.postflop.flushDraw.has', type: 'boolean' },
      { path: 'handAnalysis.postflop.flushDraw.viaHole', type: 'boolean', doc: 'True when at least one of YOUR hole cards is in the draw. A board-only draw is meaningless to you.' },
      { path: 'handAnalysis.postflop.flushDraw.holeCount', type: 'number', doc: 'How many of your hole cards are in the draw suit (0, 1, or 2).' },
      { path: 'handAnalysis.postflop.flushDraw.suit', type: 'string', doc: 'The draw suit, or null.' },
      { path: 'handAnalysis.postflop.straightDraw.openEnded', type: 'boolean' },
      { path: 'handAnalysis.postflop.straightDraw.gutshot', type: 'boolean' },
      { path: 'handAnalysis.postflop.outs', type: 'number', doc: 'Estimated outs to improve. Flush=9, OESD=8, gutshot=4, combo draws=12-15.' },
      { path: 'handAnalysis.postflop.semibluffCandidate', type: 'boolean', doc: 'True if we have flush draw or open-ended straight draw. Good hand to bet aggressively with — equity if called, fold equity if not.' },
      { path: 'handAnalysis.postflop.bluffCandidate', type: 'boolean', doc: 'Pure air with no draws. Use the bluff to take pots only against high foldEquity opponents.' },
      { path: 'handAnalysis.postflop.boardPaired', type: 'boolean' },
      { path: 'handAnalysis.postflop.boardMaxSuit', type: 'number', doc: 'Highest single-suit count on the board (1=rainbow, 3=monotone flop).' }
    ]
  },
  {
    title: 'Equity & EV (range-aware Monte Carlo)',
    description: 'Computed every decision against each unfolded opponent\'s inferred range. Reach for these instead of handStrength when you can — they account for the board AND what opponents are likely holding.',
    items: [
      { path: 'equity', type: 'number', doc: '0..1 — your win probability against estimated opponent ranges. null when there are no opponents alive yet (e.g., everyone folded). Use as the primary signal for call/raise decisions.' },
      { path: 'equityVsRandom', type: 'number', doc: '0..1 — same Monte Carlo but assuming opponents play any-two. Useful baseline; gap to `equity` shows how much opponent-range modeling moves the needle.' },
      { path: 'breakevenEquity', type: 'number', doc: 'toCall / (pot + toCall). The equity you need to break even on this call. Equivalent to potOdds, named for direct comparison: `equity > breakevenEquity ⇒ +EV call`.' },
      { path: 'evCallChips', type: 'number', doc: 'Expected value of a call in chips, using `equity`. Positive = +EV call. Computed as `equity*(pot+toCall) - toCall*(1-equity)`. 0 when not facing a bet.' },
      { path: 'profitableCall', type: 'boolean', doc: 'Shortcut for `facingBet && equity > breakevenEquity`. Pure EV check — ignores reverse-implied/implied odds.' },
      { path: 'bluffBreakEven', type: 'object', doc: 'Required fold rate for a bluff to break even, keyed by size: { half: 0.33, twoThirds: 0.40, pot: 0.50, overbet: 0.60 }. Pair with opp.patterns.foldEquityScore.' }
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
      { path: 'facingBet', type: 'boolean', doc: 'True when toCall > 0 — there is a wager you must match or beat.' },
      { path: 'facingRaise', type: 'boolean', doc: 'True when there\'s a bet AND aggressionCount ≥ 2 (someone re-raised). Indicates escalating action.' },
      { path: 'facingAllIn', type: 'boolean', doc: 'True when the bet you face is an all-in shove. Use to short-circuit decisions into call-or-fold.' },
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
      { path: 'currentBetBB', type: 'number', doc: 'Current betting-round target bet, in big blinds. Tracks the table\'s blind level.' },
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
      { path: 'committed', type: 'boolean', doc: "true when at least half of your starting-this-hand stack is already in the pot — you're priced in." },
      { path: 'commitmentRatio', type: 'number', doc: '0..1 — fraction of your starting-this-hand stack that\'s already in the pot. 0.5 ≈ pot-committed (matches the `committed` flag).' },
      { path: 'iWasPreflopAggressor', type: 'boolean', doc: 'True if you put in the first preflop raise this hand. Anchor for c-bet logic ("I opened, can I fire the flop?").' },
      { path: 'isInPosition', type: 'boolean', doc: 'True when no active opponent still needs to act after you this round — you\'re closing the betting.' },
      { path: 'isLatePosition', type: 'boolean', doc: 'Position is btn or late.' },
      { path: 'isBlind', type: 'boolean', doc: 'Position is sb or bb.' }
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
      { path: 'me.name', type: 'string', doc: 'Your bot\'s display name as the table sees it.' },
      { path: 'me.seat', type: 'number', doc: 'Your zero-based index in game.players. Useful as a deterministic salt for per-hand randomness.' },
      { path: 'me.chips', type: 'number', doc: 'Chips remaining in your stack.' },
      { path: 'me.bet', type: 'number', doc: "Chips you've put in this round." },
      { path: 'me.totalBetThisHand', type: 'number', doc: 'Total chips committed across all rounds of this hand.' },
      { path: 'me.position', type: 'string', doc: 'Same value as ctx.position — your seat\'s position label this hand.' },
      { path: 'me.stats.handsObserved', type: 'number', doc: 'Total hands you\'ve been seated for at this table this session.' },
      { path: 'me.stats.handsPlayed', type: 'number', doc: 'Hands you voluntarily put money in.' },
      { path: 'me.stats.vpip', type: 'number', doc: 'Voluntarily-put-in-pot frequency 0..1.' },
      { path: 'me.stats.aggressionFreq', type: 'number', doc: 'Raise/all-in frequency per hand 0..1.' },
      { path: 'me.stats.profit', type: 'number', doc: 'Net chips since you joined the table.' },
      { path: 'me.stats.showdownsSeen', type: 'number', doc: 'How many showdowns you\'ve reached at this table.' },
      { path: 'me.stats.showdownsWon', type: 'number', doc: 'How many showdowns you won out of the ones you reached.' },
      { path: 'myStack', type: 'number', doc: 'Shortcut for me.chips.' },
      { path: 'effectiveStack', type: 'number', doc: 'min(my stack, smallest active opp stack).' }
    ]
  },
  {
    title: 'Opponents (array)',
    description: 'One entry per other seat at the table. Use ctx.opponents.find(...) or .filter(...).',
    items: [
      { path: 'numActiveOpponents', type: 'number', doc: 'Opponents not yet folded this hand. Drops as the hand progresses.' },
      { path: 'opponents[].id', type: 'string', doc: 'Stable seat id for this session. Use as a Map key for "have I seen this player before" tracking.' },
      { path: 'opponents[].seat', type: 'number', doc: 'Their zero-based seat index in game.players.' },
      { path: 'opponents[].name', type: 'string', doc: 'Display name shown on their nameplate.' },
      { path: 'opponents[].hasCustomName', type: 'boolean', doc: 'True when the opponent set their own username (not the auto-generated "player_47" / "anon" / "guest3" style). Gate name-templated trash talk on this — addressing someone by a real name lands; addressing "player_47" doesn\'t.' },
      { path: 'opponents[].isBot', type: 'boolean', doc: 'True if they\'re a bot (timing tells like avgActionTimeMs are useless against bots).' },
      { path: 'opponents[].chips', type: 'number', doc: 'Chips they have left in their stack right now.' },
      { path: 'opponents[].bet', type: 'number', doc: 'Chips put in this round.' },
      { path: 'opponents[].totalBet', type: 'number', doc: 'Chips committed this hand.' },
      { path: 'opponents[].folded', type: 'boolean', doc: 'True if they\'ve folded this hand.' },
      { path: 'opponents[].allIn', type: 'boolean', doc: 'True if they\'re all-in (no more chips to bet this hand).' },
      { path: 'opponents[].position', type: 'string', doc: 'Their position label this hand: btn | sb | bb | utg | middle | late.' },
      { path: 'opponents[].lastAction', type: 'object', doc: '{ action, amount } or null' },
      { path: 'opponents[].stats.handsObserved', type: 'number', doc: 'How many hands you\'ve sat at the table with them. Higher = more reliable patterns.' },
      { path: 'opponents[].stats.vpip', type: 'number', doc: 'Their voluntary-pot frequency 0..1.' },
      { path: 'opponents[].stats.aggressionFreq', type: 'number', doc: 'Their raises+all-ins / handsObserved (0..1). >0.30 = aggressive; <0.10 = passive.' },
      { path: 'opponents[].stats.foldsToBet', type: 'number', doc: 'Times they folded to a bet at this table.' },
      { path: 'opponents[].stats.profit', type: 'number', doc: 'Their net at this table.' },
      { path: 'opponents[].stats.showdownsSeen', type: 'number', doc: 'Times they reached showdown.' },
      { path: 'opponents[].stats.showdownsWon', type: 'number', doc: 'Of their showdowns, how many they won. Pair with showdownsSeen to compute wonAtShowdownRate yourself.' },
      { path: 'opponents[].stats.wtsdRate', type: 'number', doc: 'Went-to-showdown rate per hand observed.' },
      { path: 'opponents[].stats.wonAtShowdownRate', type: 'number', doc: 'Of their showdowns, how often they won.' },
      { path: 'opponents[].stats.recentBetSizes', type: 'array', doc: 'Last up-to-10 raise/all-in target totals.' },
      { path: 'opponents[].stats.avgRecentBetSize', type: 'number', doc: 'Mean of their recent raise targets in raw chips. Useful for predicting bet sizing.' },
      // -- Enriched per-opponent fields (added with table identity + timing) --
      { path: 'opponents[].stableId', type: 'string', doc: 'Same as `id`. Stable for the session — use as a Map key for "I have seen this player before" tracking.' },
      { path: 'opponents[].estimatedTopPct', type: 'number', doc: 'Inferred top-X% range based on their action this hand. 0.05=premium, 1.0=any-two.' },
      { path: 'opponents[].estimatedRangeLabel', type: 'string', doc: 'premium | tight | standard | loose | wide' },
      { path: 'opponents[].committed', type: 'boolean', doc: 'Pot-committed (≥ half of starting stack already in).' },
      { path: 'opponents[].currentHandActions', type: 'array', doc: 'Their actions in *this* hand, ordered. [{ seq, phase, action, amount, tookMs }]' },
      { path: 'opponents[].lastActionTookMs', type: 'number', doc: 'Time between turn-start and their most recent action this hand (ms).' },
      { path: 'opponents[].avgActionTimeMs', type: 'number', doc: 'Rolling average across handHistory + current hand. Useful tell vs humans.' },
      { path: 'opponents[].isChipLeader', type: 'boolean', doc: 'True if this opponent currently has the biggest stack at the table.' },
      { path: 'opponents[].isShortStack', type: 'boolean', doc: 'True if this opponent currently has the smallest stack at the table.' },
      { path: 'opponents[].chipRank', type: 'number', doc: '1 = chip leader, N = shortest.' },
      { path: 'opponents[].mRatio', type: 'number', doc: 'chips / (sb + bb). Tournament-style stack pressure metric.' },
      { path: 'opponents[].effectiveStackBB', type: 'number', doc: 'min(my stack, their stack) in big blinds. The biggest chip move that could happen between you on this hand.' },
      { path: 'opponents[].sessionProfit', type: 'number', doc: 'Net chip change for this player across the rolling 25-hand history.' },
      { path: 'opponents[].vsMeProfit', type: 'number', doc: 'Head-to-head net chips this player has vs YOU across the rolling 25-hand history. Positive = they\'re up on you specifically.' },
      { path: 'opponents[].wonLastHand', type: 'boolean', doc: 'True if they were a winner in the most recent completed hand. Quick momentum check.' },
      { path: 'opponents[].showdownsThisSession', type: 'number', doc: 'Number of times they\'ve shown cards down this session (= revealedShowdowns.length).' },
      { path: 'opponents[].revealedShowdowns', type: 'array', doc: '[{ handIndex, cards, won, handName, pot }] — every showdown reveal this player made this session, oldest-first.' },
      { path: 'opponents[].stackBB', type: 'number', doc: 'Their own stack in big blinds. "How many BBs away from busting they are."' },
      { path: 'opponents[].bbToBust', type: 'number', doc: 'Alias for stackBB — phrased for shove decisions.' },
      // --- Per-opponent behavioral patterns (auto-derived from their actions) ---
      { path: 'opponents[].patterns.archetype', type: 'string', doc: '"nit" | "tag" | "lag" | "maniac" | "fish" | "reg" | "unknown"' },
      { path: 'opponents[].patterns.aggressionBias', type: 'string', doc: '"passive" | "balanced" | "over_aggressive"' },
      { path: 'opponents[].patterns.bluffer', type: 'boolean', doc: 'True when their reveal history or stats say they bluff a lot.' },
      { path: 'opponents[].patterns.stickyCaller', type: 'boolean', doc: 'High wtsd + low aggression — a station that calls down too much.' },
      { path: 'opponents[].patterns.openFreq', type: 'number', doc: 'opens / open opportunities (0..1).' },
      { path: 'opponents[].patterns.limpFreq', type: 'number', doc: 'limps / preflop actions (0..1).' },
      { path: 'opponents[].patterns.threeBetFreq', type: 'number', doc: '3-bets / 3-bet opportunities.' },
      { path: 'opponents[].patterns.foldTo3BetRate', type: 'number', doc: 'Folded-to-3bet / opened-and-got-3bet.' },
      { path: 'opponents[].patterns.cBetFreq', type: 'number', doc: 'C-bets fired / C-bet opportunities.' },
      { path: 'opponents[].patterns.oversizeFreq', type: 'number', doc: 'Postflop bets ≥1.25x pot / postflop actions.' },
      { path: 'opponents[].patterns.checkRaises', type: 'number', doc: 'Raw count of check-then-raise sequences.' },
      { path: 'opponents[].patterns.donkBets', type: 'number', doc: 'Raw count of leading into the preflop aggressor postflop.' },
      { path: 'opponents[].patterns.revealCount', type: 'number', doc: 'Number of distinct showdown reveals this session. Drives showdownBluffRate / showdownStrongRate.' },
      { path: 'opponents[].patterns.showdownBluffRate', type: 'number', doc: 'Of their showdowns, fraction where they showed a clearly weak holding.' },
      { path: 'opponents[].patterns.showdownStrongRate', type: 'number', doc: '0..1 — fraction of their reveals that were premium/strong holdings. High = they wait for hands; low = they showdown light.' },
      { path: 'opponents[].patterns.recentWins', type: 'number', doc: 'Wins in their last 10 hands at this table.' },
      { path: 'opponents[].patterns.recentNetChips', type: 'number', doc: 'Signed chip swing across their last 10 hands. Negative = stuck; positive = running hot.' },
      { path: 'opponents[].patterns.recentLossBB', type: 'number', doc: 'How many big blinds they\'re down across the recent window.' },
      { path: 'opponents[].patterns.tilt', type: 'string', doc: '"cool" | "normal" | "tilted" — heuristic based on recent swing.' },
      { path: 'opponents[].patterns.sample', type: 'number', doc: 'How many hands this pattern read is based on.' },
      { path: 'opponents[].patterns.sampleConfidence', type: 'string', doc: '"low" (<8 hands) | "medium" (8-19) | "high" (20+).' },
      { path: 'opponents[].patterns.bluffCatchScore', type: 'number', doc: '0..1 — how good a bluff-catch target this player is. High = they bluff a lot, oversize, show down weak. Loosen your call threshold by ~0.05 × score.' },
      { path: 'opponents[].patterns.bluffTargetScore', type: 'number', doc: '0..1 — how good a target for YOUR bluffs. High = they fold a lot, don\'t reach showdown often. Gate bluff frequency on this.' },
      { path: 'opponents[].patterns.foldEquityScore', type: 'number', doc: '0..1 — cleaner read of "will a bet make them fold". Use to size bluffs.' }
    ]
  },
  {
    title: 'Trash talk + chatter',
    description: 'Inputs for building player-aware `say` strings — react to the previous move, address opponents by name, antagonize specific seats. Return `{ action: "...", say: "your line here" }` from decide() to make your bot speak (max 80 chars). Combine these fields with random throttling so you don\'t spam every turn.',
    items: [
      { path: 'previousActor', type: 'object', doc: '{ id, name, hasCustomName, isBot, action, amount } — the most recent NON-SELF action on the current street, or null if nobody else has acted yet. Use to template reactions: e.g. ``` `${ctx.previousActor.name} just raised, classic` ``` (only when hasCustomName=true, otherwise the line reads as "player_47 just raised, classic" which is awkward).' },
      { path: 'insultableOpponent', type: 'object', doc: 'A random active opponent with `hasCustomName === true`, or null if everyone left has a generic auto-name. Selection is salted by `handIndex` so it varies hand-to-hand but stays stable mid-hand. Use to address a specific player by their real name without picking the same one every line.' },
      { path: 'opponents[].hasCustomName', type: 'boolean', doc: 'True when the opponent picked their own username (not auto-generated "player_47" / "anon" / "guest3"). Gate name-templated trash talk on this — addressing someone by a name they chose lands harder than addressing "guest12".' },
      { path: '(action returned).say', type: 'string', doc: 'Attach to the object you return from decide() — e.g. `{ action: "raise", amount: 60, say: "raise it up, Pablo" }`. Server truncates at 80 chars. Throttle yourself: not every action needs chatter, or it gets annoying fast. Recommended floors: fold/check ~15-20%, call ~30-35%, raise ~50-65%, all_in ~75-85%.' }
    ]
  },
  {
    title: 'History',
    description: 'Use this to detect bluffs, sticky callers, momentum, range narrowing.',
    items: [
      { path: 'actionHistory', type: 'array', doc: 'This hand: [{ seq, phase, playerId, playerName, action, amount, toCallBefore, potBefore, at, tookMs }]. `at` is wall-clock ms; `tookMs` is gap since the previous action (useful for timing tells vs humans).' },
      { path: 'handHistory', type: 'array', doc: 'Up to 25 prior completed hands at this table.' },
      { path: 'handHistory[].handIndex', type: 'number', doc: 'Server-assigned hand counter. Strictly increasing per table.' },
      { path: 'handHistory[].type', type: 'string', doc: '"showdown" | "fold_out"' },
      { path: 'handHistory[].pot', type: 'number', doc: 'Total chips in the pot when the hand ended.' },
      { path: 'handHistory[].communityCards', type: 'array', doc: 'Final board for that hand: 0–5 cards. Empty array if the hand ended preflop.' },
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
    title: 'Table identity & timing',
    description: 'Stable IDs + wall-clock data. Combine with opponents[].stableId to maintain your own session memory across hands.',
    items: [
      { path: 'tableId', type: 'string', doc: 'Stable room id for this session. Same value across every hand at this table.' },
      { path: 'tableType', type: 'string', doc: '"public" | "private" | "arena"' },
      { path: 'tableSize', type: 'number', doc: 'Seated player count, including bots and the bot itself.' },
      { path: 'maxSeats', type: 'number', doc: 'Hard cap on seats at any pokerxyz table. Currently 5.' },
      { path: 'serverTime', type: 'number', doc: 'Server wall-clock ms at the time ctx was built.' },
      { path: 'activeTurnStartedAt', type: 'number', doc: 'When the current actor\'s turn started (ms). `serverTime - activeTurnStartedAt` = current think-time.' },
      { path: 'handStrengthLabel', type: 'string', doc: 'Mirror of handStrength — convenience for ctx.handStrengthLabel === "premium" style checks.' }
    ]
  },
  {
    title: 'Board texture (postflop)',
    description: 'Null preflop. Derived from the community cards so you don\'t have to walk the array.',
    items: [
      { path: 'boardTexture.wetness', type: 'string', doc: '"dry" | "wet" | "volatile". Use this if you just want a single label.' },
      { path: 'boardTexture.paired', type: 'boolean', doc: 'At least one rank is duplicated on the board.' },
      { path: 'boardTexture.pairsCount', type: 'number', doc: '0, 1, or 2 — count of distinct rank pairs on the board.' },
      { path: 'boardTexture.trips', type: 'boolean', doc: 'Three of a kind on the board itself.' },
      { path: 'boardTexture.monotone', type: 'boolean', doc: 'All board cards same suit.' },
      { path: 'boardTexture.twoTone', type: 'boolean', doc: 'Flush draw possible.' },
      { path: 'boardTexture.rainbow', type: 'boolean', doc: 'Every board card is a different suit (no flush draw possible).' },
      { path: 'boardTexture.maxSuitCount', type: 'number', doc: 'Highest single-suit count on the board (3 = monotone flop, 4 = monotone turn, 5 = monotone river).' },
      { path: 'boardTexture.connected', type: 'boolean', doc: 'Straight-draw friendly (span ≤ 4 between distinct ranks).' },
      { path: 'boardTexture.span', type: 'number', doc: 'High rank - low rank of distinct ranks on board.' },
      { path: 'boardTexture.aceLow', type: 'boolean', doc: 'Ace + low card present (A-5 wheel possibility).' },
      { path: 'boardTexture.drawHeavy', type: 'boolean', doc: 'monotone || twoTone || connected || aceLow.' },
      { path: 'boardTexture.highCard', type: 'number', doc: 'High card on the board, 2..14.' }
    ]
  },
  {
    title: 'Showdown reveals (session memory)',
    description: 'Every showdown reveal made at this table, indexed by player. Great for narrowing future opponent ranges.',
    items: [
      { path: 'revealedShowdownsByPlayer', type: 'object', doc: '{ [playerId]: [{ handIndex, cards, won, handName, pot }] } — oldest first per player.' }
    ]
  },
  {
    title: 'Table profile (rollup)',
    description: 'Aggregate over every opponent\'s archetype. One-glance check for posture.',
    items: [
      { path: 'tableProfile.dominantArchetype', type: 'string', doc: '"nit" | "tag" | "lag" | "maniac" | "fish" | "reg" | "unknown"' },
      { path: 'tableProfile.archetypeCounts', type: 'object', doc: '{ nit: 1, tag: 2, ... }' },
      { path: 'tableProfile.tightTable', type: 'boolean', doc: 'True when the dominant archetype is nit or tag. Open wider, steal more.' },
      { path: 'tableProfile.looseTable', type: 'boolean', doc: 'True when the dominant archetype is fish, lag, or maniac. Trap more, value-bet bigger.' },
      { path: 'tableProfile.aggressiveTable', type: 'boolean', doc: 'True when the dominant archetype is maniac, lag, or tag. Tighten preflop, slow-play monsters.' },
      { path: 'tableProfile.passiveTable', type: 'boolean', doc: 'True when the dominant archetype is fish or nit. Bet thin for value, bluff sparingly.' },
      { path: 'tableProfile.tiltedSeats', type: 'number', doc: 'Count of opponents flagged as "tilted".' },
      { path: 'tableProfile.bluffers', type: 'number', doc: 'Count of opponents flagged as `patterns.bluffer === true`. Higher = lots of catchable bluffs.' },
      { path: 'tableProfile.stickyCallers', type: 'number', doc: 'Count of opponents flagged as `patterns.stickyCaller === true`. Drop your bluff frequency when high.' },
      { path: 'tableProfile.sampleSize', type: 'number', doc: 'Number of opponents this profile is based on. Same as the count of active opponents.' },
      { path: 'tableProfile.loosenessIndex', type: 'number', doc: '0..1 — average open/limp/3-bet frequency across opponents. Higher = looser table; open wider.' },
      { path: 'tableProfile.aggressionIndex', type: 'number', doc: '0..1 — average cBet/oversize/3-bet activity across opponents. Higher = more aggression; trap more, c-bet less.' },
      { path: 'tableProfile.avgBluffCatchScore', type: 'number', doc: 'Mean of per-opp bluffCatchScore. High = lots of catchable bluffs at the table.' },
      { path: 'tableProfile.avgBluffTargetScore', type: 'number', doc: 'Mean of per-opp bluffTargetScore. High = table folds easily; your bluffs print.' },
      { path: 'tableProfile.avgFoldEquityScore', type: 'number', doc: '0..1 — average of per-opp foldEquityScore. High = the table folds to pressure on average.' }
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
