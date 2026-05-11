import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContext } from '../src/bots/runtime/signals.js'

// Minimal fake game / bot — enough for buildContext to walk through.
function makeGame(overrides = {}) {
  return {
    phase: 'preflop',
    players: [
      { id: 'me',  username: 'Me',  chips: 1000, isConnected: true, isBot: true,  botColor: '#f00' },
      { id: 'opp', username: 'Opp', chips: 1500, isConnected: true, isBot: false }
    ],
    dealerIndex: 0,
    activeIndex: 0,
    handIndex: 5,
    smallBlind: 5,
    bigBlind: 10,
    pot: 30,
    currentBet: 10,
    aggressionCount: 1,
    currentBetContext: null,
    actionStarted: true,
    lastTurnChange: Date.now() - 1500,
    communityCards: [],
    playerHands: new Map([
      ['me', [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]]
    ]),
    playerBets: new Map([['me', 0], ['opp', 10]]),
    playerTotalBets: new Map([['me', 0], ['opp', 10]]),
    playerActions: new Map([['opp', { action: 'raise', amount: 10 }]]),
    foldedPlayers: new Set(),
    allInPlayers: new Set(),
    removedPlayers: new Set(),
    waitingNextHand: new Set(),
    roundActed: new Set(),
    playerStats: new Map([
      ['opp', { handsObserved: 12, handsPlayed: 6, vpipHands: 5, aggressiveActions: 3, foldsToBet: 2, profit: 50, showdownsSeen: 2, showdownsWon: 1, recentBetSizes: [30, 50] }]
    ]),
    handActionHistory: [],
    handHistory: [],
    ...overrides
  }
}

function makeBot() {
  return {
    id: 'me',
    username: 'Me',
    isBot: true,
    room: { roomId: 'arena_42', isArena: true, isPrivate: false }
  }
}

test('ctx exposes tableId / tableType / tableSize', () => {
  const ctx = buildContext(makeGame(), makeBot())
  assert.equal(ctx.tableId, 'arena_42')
  assert.equal(ctx.tableType, 'arena')
  assert.equal(ctx.tableSize, 2)
  assert.equal(ctx.maxSeats, 5)
})

test('boardTexture is null preflop, populated on flop', () => {
  const preflop = buildContext(makeGame(), makeBot())
  assert.equal(preflop.boardTexture, null)

  const flop = buildContext(makeGame({
    phase: 'flop',
    communityCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
      { rank: 'Q', suit: 'hearts' }
    ]
  }), makeBot())
  assert.equal(flop.boardTexture.cards, 3)
  assert.equal(flop.boardTexture.paired, false)
  assert.equal(flop.boardTexture.twoTone, true)
  assert.equal(flop.boardTexture.connected, true)
  assert.equal(flop.boardTexture.highCard, 14)
  assert.ok(['dry', 'wet', 'volatile'].includes(flop.boardTexture.wetness))
})

test('boardTexture detects monotone + paired + trips', () => {
  const monotone = buildContext(makeGame({
    phase: 'flop',
    communityCards: [
      { rank: '2', suit: 'spades' },
      { rank: '7', suit: 'spades' },
      { rank: 'J', suit: 'spades' }
    ]
  }), makeBot())
  assert.equal(monotone.boardTexture.monotone, true)
  assert.equal(monotone.boardTexture.maxSuitCount, 3)

  const paired = buildContext(makeGame({
    phase: 'flop',
    communityCards: [
      { rank: 'A', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
      { rank: 'K', suit: 'clubs' }
    ]
  }), makeBot())
  assert.equal(paired.boardTexture.paired, true)
  assert.equal(paired.boardTexture.pairsCount, 1)
})

test('opponents[] gains chipRank, mRatio, currentHandActions, sessionProfit', () => {
  const ctx = buildContext(makeGame({
    handActionHistory: [
      { seq: 1, phase: 'preflop', playerId: 'opp', playerName: 'Opp', action: 'raise', amount: 10, toCallBefore: 0, potBefore: 5, at: Date.now() - 800, tookMs: 1200 }
    ]
  }), makeBot())
  const opp = ctx.opponents.find(o => o.id === 'opp')
  assert.equal(opp.isChipLeader, true)
  assert.equal(opp.isShortStack, false)
  assert.equal(opp.chipRank, 1)
  assert.ok(opp.mRatio > 0)
  assert.equal(opp.currentHandActions.length, 1)
  assert.equal(opp.currentHandActions[0].action, 'raise')
  assert.equal(opp.lastActionTookMs, 1200)
  assert.equal(opp.sessionProfit, 0)
  assert.equal(opp.stableId, 'opp')
  assert.equal(typeof opp.showdownsThisSession, 'number')
})

test('revealed showdowns aggregate per opponent', () => {
  const game = makeGame({
    handHistory: [
      {
        handIndex: 4,
        type: 'showdown',
        pot: 200,
        communityCards: [],
        winners: [{ playerId: 'opp', username: 'Opp', chips: 200, handName: 'Two Pair' }],
        cards: { opp: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }] },
        actionsByPlayer: { opp: [] },
        actions: [],
        profitsByPlayer: { opp: 200, me: -50 },
        playerHandNames: { opp: 'Two Pair' }
      }
    ]
  })
  const ctx = buildContext(game, makeBot())
  const opp = ctx.opponents.find(o => o.id === 'opp')
  assert.equal(opp.revealedShowdowns.length, 1)
  assert.equal(opp.revealedShowdowns[0].won, true)
  assert.equal(opp.revealedShowdowns[0].handName, 'Two Pair')
  assert.deepEqual(ctx.revealedShowdownsByPlayer.opp[0].cards, [
    { rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }
  ])
})

test('action timing fields propagate (at + tookMs) into actionHistory', () => {
  const now = Date.now()
  const ctx = buildContext(makeGame({
    handActionHistory: [
      { seq: 1, phase: 'preflop', playerId: 'opp', playerName: 'Opp', action: 'raise', amount: 10, toCallBefore: 0, potBefore: 5, at: now - 2000, tookMs: 1800 },
      { seq: 2, phase: 'preflop', playerId: 'me',  playerName: 'Me',  action: 'call',  amount: 10, toCallBefore: 10, potBefore: 15, at: now - 500, tookMs: 1500 }
    ]
  }), makeBot())
  const lastAction = ctx.actionHistory[ctx.actionHistory.length - 1]
  assert.equal(typeof lastAction.at, 'number')
  assert.equal(lastAction.tookMs, 1500)
})
