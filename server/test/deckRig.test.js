import test from 'node:test'
import assert from 'node:assert/strict'

import { Deck } from '../src/poker/deck.js'
import { PokerGame } from '../src/poker/PokerGame.js'
import { GAME_PHASES } from '../src/config/constants.js'

// ─── Deck.removeCard ───────────────────────────────────────────────────
test('Deck.removeCard pulls the exact card out of the shuffle', () => {
  const d = new Deck()
  const before = d.cards.length
  const card = d.removeCard('A', 'spades')
  assert.equal(card.rank, 'A')
  assert.equal(card.suit, 'spades')
  assert.equal(d.cards.length, before - 1)
  assert.equal(d.has('A', 'spades'), false)
})

test('Deck.removeCard returns null when the card is already gone', () => {
  const d = new Deck()
  d.removeCard('K', 'hearts')
  const second = d.removeCard('K', 'hearts')
  assert.equal(second, null)
})

// ─── setRigged* validation ─────────────────────────────────────────────
test('setRiggedRiverCard accepts a valid card, rejects garbage', () => {
  const g = new PokerGame(() => {})
  assert.equal(g.setRiggedRiverCard({ rank: 'A', suit: 'spades' }).success, true)
  assert.equal(g._riggedRiverCard.rank, 'A')
  assert.equal(g.setRiggedRiverCard({ rank: 'Z', suit: 'spades' }).success, false)
  assert.equal(g.setRiggedRiverCard({ rank: 'A', suit: 'rocks' }).success, false)
  assert.equal(g.setRiggedRiverCard(null).success, false)
})

test('setRiggedHand rejects empty input + within-script duplicates', () => {
  const g = new PokerGame(() => {})
  assert.equal(g.setRiggedHand({}).success, false)
  // Two players both rigged to AS — collision inside the script.
  const dup = g.setRiggedHand({
    holeCards: {
      p1: [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
      p2: [{ rank: 'A', suit: 'spades' }, { rank: '2', suit: 'clubs' }],
    }
  })
  assert.equal(dup.success, false)
  assert.equal(dup.error, 'duplicate_card')
  // Same card in your own pair — silently dropped (lengths after
  // dedup ≠ 2 → entry skipped), and with no remaining entries the
  // script is empty.
  const selfDup = g.setRiggedHand({
    holeCards: { p1: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'spades' }] }
  })
  assert.equal(selfDup.success, false)
})

// ─── End-to-end rig: hole cards land on the right players ──────────────
test('rig_hand: queued hole cards survive startHand and reach playerHands', () => {
  const g = new PokerGame(() => {})
  const p1 = makePlayer('p1')
  const p2 = makePlayer('p2')
  g.players = [p1, p2]
  // Queue: p1 gets AA, p2 gets KK.
  g.setRiggedHand({
    holeCards: {
      p1: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }],
      p2: [{ rank: 'K', suit: 'clubs' }, { rank: 'K', suit: 'diamonds' }],
    }
  })
  // PokerGame's startHand wants the players seated + chips set. Minimal
  // seeding for a 2-player hand:
  g.dealerIndex = 0
  g.startHand()
  const p1Hand = g.playerHands.get('p1')
  const p2Hand = g.playerHands.get('p2')
  assert.equal(p1Hand.length, 2)
  assert.equal(p2Hand.length, 2)
  const p1Set = new Set(p1Hand.map(c => `${c.rank}-${c.suit}`))
  const p2Set = new Set(p2Hand.map(c => `${c.rank}-${c.suit}`))
  assert.equal(p1Set.has('A-spades'), true)
  assert.equal(p1Set.has('A-hearts'), true)
  assert.equal(p2Set.has('K-clubs'), true)
  assert.equal(p2Set.has('K-diamonds'), true)
})

test('rig_hand: late joiners get random cards without breaking the plan', () => {
  const g = new PokerGame(() => {})
  const p1 = makePlayer('p1')
  g.players = [p1]
  g.setRiggedHand({
    holeCards: { p1: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }] }
  })
  // p2 sits AFTER the rig was queued.
  const p2 = makePlayer('p2')
  g.players = [p1, p2]
  g.dealerIndex = 0
  g.startHand()
  // p1 still gets the rigged AA; p2 gets two cards drawn normally.
  const p1Hand = g.playerHands.get('p1')
  const p1Set = new Set(p1Hand.map(c => `${c.rank}-${c.suit}`))
  assert.equal(p1Set.has('A-spades'), true)
  assert.equal(p1Set.has('A-hearts'), true)
  const p2Hand = g.playerHands.get('p2')
  assert.equal(p2Hand.length, 2)
  // p2's cards must be valid + distinct from the rigged AA.
  for (const c of p2Hand) {
    assert.ok(c.rank && c.suit)
    assert.notEqual(`${c.rank}-${c.suit}`, 'A-spades')
    assert.notEqual(`${c.rank}-${c.suit}`, 'A-hearts')
  }
})

test('rig_hand is one-shot — _riggedHoleCards is null after the rig fires', () => {
  const g = new PokerGame(() => {})
  const p1 = makePlayer('p1')
  const p2 = makePlayer('p2')
  g.players = [p1, p2]
  g.setRiggedHand({
    holeCards: { p1: [{ rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' }] }
  })
  g.dealerIndex = 0
  g.startHand()
  // After startHand consumes the rig, the engine field must be cleared
  // so a subsequent hand doesn't accidentally re-deal the same script.
  // Don't try to start a second hand here — canStart wants a lot of
  // ambient state we don't have to fake; just assert the cleanup.
  assert.equal(g._riggedHoleCards, null)
})

// ─── river_card precedence ─────────────────────────────────────────────
// Driven by hand-rolling the phase machine so the assertion lands
// deterministically. startHand's hole-card deal could otherwise steal
// the rigged card from the deck (~8% flake rate).
test('river_card power fires on the river deal', () => {
  const g = new PokerGame(() => {})
  g.players = [makePlayer('p1'), makePlayer('p2')]
  g.communityCards = []
  g.deck.reset()
  g.setRiggedRiverCard({ rank: '7', suit: 'diamonds' })
  // Walk phases manually: PREFLOP → FLOP (deals 3) → TURN (deals 1) →
  // RIVER (rig should fire here).
  g.phase = GAME_PHASES.PREFLOP
  g.advancePhaseCards()
  g.advancePhaseCards()
  g.advancePhaseCards()
  const river = g.communityCards[4]
  assert.equal(river.rank, '7')
  assert.equal(river.suit, 'diamonds')
  assert.equal(g._riggedRiverCard, null)
})

// ─── next_card precedence ──────────────────────────────────────────────
// Drive advancePhaseCards directly with a controlled deck — avoids
// startHand's hole-card deal accidentally consuming the card we're
// trying to rig with (~8% flake rate otherwise).
test('next_card fires on the immediate next community deal', () => {
  const g = new PokerGame(() => {})
  g.players = [makePlayer('p1'), makePlayer('p2')]
  g.phase = GAME_PHASES.PREFLOP
  g.communityCards = []
  g.deck.reset()
  g.setRiggedNextCard({ rank: 'J', suit: 'clubs' })
  g.advancePhaseCards()
  const first = g.communityCards[0]
  assert.equal(first.rank, 'J')
  assert.equal(first.suit, 'clubs')
  // One-shot — gone now.
  assert.equal(g._riggedNextCard, null)
})

test('next_card fires "from your pocket" — duplicates a card already in play', () => {
  // New "from your pocket" semantics: river_card / next_card no longer
  // require the rigged card to be in the deck. The card lands on the
  // street regardless, intentionally producing a duplicate on the
  // board so the user can build 5-of-a-kind. The hand evaluator ranks
  // 5/6/7-of-a-kind above royal flush.
  const g = new PokerGame(() => {})
  g.players = [makePlayer('p1'), makePlayer('p2')]
  g.phase = GAME_PHASES.PREFLOP
  g.communityCards = []
  g.deck.reset()
  // Pull AS out of the deck — simulating AS already in someone's hand
  // or on the board.
  const taken = g.deck.removeCard('A', 'spades')
  assert.ok(taken)
  g.setRiggedNextCard({ rank: 'A', suit: 'spades' })
  g.advancePhaseCards()
  // The rig fires anyway — AS lands as the first community card even
  // though it isn't in the deck.
  assert.equal(g.communityCards[0].rank, 'A')
  assert.equal(g.communityCards[0].suit, 'spades')
  // Rig is consumed — one-shot.
  assert.equal(g._riggedNextCard, null)
})

test('5-of-a-kind: rig four aces on board + swap to AA gives quintuple aces', async () => {
  // Full meme scenario: rig_hand puts AA on player1's hole cards and
  // AA on board[0..1]. Then on the river, river_card forces another
  // ace (from the player's pocket — duplicate of one already on
  // board). After the river, player1 has 7 cards including 5 aces.
  const { evaluateHand, getHandName } = await import('../src/poker/handEvaluator.js')
  const cards = [
    // hole
    { rank: 'A', suit: 'spades' },
    { rank: 'A', suit: 'hearts' },
    // board
    { rank: 'A', suit: 'clubs' },
    { rank: 'A', suit: 'diamonds' },
    { rank: 'K', suit: 'hearts' },
    { rank: '2', suit: 'spades' },
    { rank: 'A', suit: 'spades' }, // river_card duplicate "from pocket"
  ]
  const ev = evaluateHand(cards)
  // 5+ of a kind ranks ABOVE royal flush (9). Five = 10.
  assert.equal(ev.rank, 10)
  assert.equal(getHandName(ev), 'Five of a Kind, Aces')
})

test('6-of-a-kind: rig_hand four aces on board + swap to AA gives sextuple aces', async () => {
  // Even goofier: rig_hand puts FOUR aces on the board (slots 0..3).
  // The player's hole are random, then swap power gives them AA.
  // That's 4 aces on board + 2 aces in hand = 6 aces total.
  const { evaluateHand, getHandName } = await import('../src/poker/handEvaluator.js')
  const cards = [
    // hole (from swap)
    { rank: 'A', suit: 'spades' },
    { rank: 'A', suit: 'hearts' },
    // board (rig_hand: 4 aces + 1 random)
    { rank: 'A', suit: 'clubs' },
    { rank: 'A', suit: 'diamonds' },
    { rank: 'A', suit: 'spades' },
    { rank: 'A', suit: 'hearts' },
    { rank: 'K', suit: 'hearts' },
  ]
  const ev = evaluateHand(cards)
  assert.equal(ev.rank, 11)
  assert.equal(getHandName(ev), 'Six of a Kind, Aces')
})

// ─── post-hand cleanup ─────────────────────────────────────────────────
test('a fresh hand after a fold-out clears mid-hand rigs', () => {
  const g = new PokerGame(() => {})
  g.players = [makePlayer('p1'), makePlayer('p2')]
  // Simulate a hand that left mid-hand rigs hanging because it ended
  // by fold-out before river→showdown ever fired.
  g._riggedNextCard = { rank: 'Q', suit: 'spades' }
  g._riggedRiverCard = { rank: 'Q', suit: 'hearts' }
  g._handIsRigged = true
  g.phase = 'waiting'
  g.dealerIndex = 0
  g.startHand()
  assert.equal(g._riggedNextCard, null)
  assert.equal(g._riggedRiverCard, null)
  // _handIsRigged is reset by startHand based on what's queued for
  // the NEW hand — no holeCards/boardSlots set, so it should be false.
  assert.equal(g._handIsRigged, false)
})

test('rig_hand rejects a second concurrent rig (first-rigger-wins)', () => {
  const g = new PokerGame(() => {})
  // First rig lands.
  const first = g.setRiggedHand({
    holeCards: { p1: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }] }
  })
  assert.equal(first.success, true)
  // Second rig — even for a non-overlapping player — should bounce so
  // the second player's cooldown isn't burned silently.
  const second = g.setRiggedHand({
    holeCards: { p2: [{ rank: 'K', suit: 'clubs' }, { rank: 'K', suit: 'diamonds' }] }
  })
  assert.equal(second.success, false)
  assert.equal(second.error, 'already_rigged')
  // The first script must still be in the queue (not yet promoted to
  // armed — startHand hasn't fired).
  assert.ok(g._pendingRigHand)
  assert.ok(g._pendingRigHand.holeCards instanceof Map)
  assert.equal(g._pendingRigHand.holeCards.size, 1)
  assert.equal(g._riggedHoleCards, null)
})

// Regression: rig_hand fired MID-HAND must not touch the in-progress
// hand's board or hole cards. The script stays queued and only fires
// on the NEXT startHand. Without the _pendingRigHand staging, the very
// next advancePhaseCards call would consume the script's board slots
// onto the current board. We assert this state-wise (not by inspecting
// which cards happen to land) — a deterministic check on the armed
// fields beats a stochastic check that flakes when the random flop
// happens to match a scripted card.
test('rig_hand fired mid-hand does not modify the current hand', () => {
  const g = new PokerGame(() => {})
  g.players = [makePlayer('p1'), makePlayer('p2')]
  g.communityCards = []
  g.deck.reset()
  g.phase = GAME_PHASES.PREFLOP
  const before = g.setRiggedHand({
    board: [
      { rank: 'K', suit: 'spades' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: '10', suit: 'spades' },
      { rank: '9', suit: 'spades' },
    ]
  })
  assert.equal(before.success, true)
  // The armed fields the dealer reads must still be empty — the
  // in-progress hand is untouched. THIS is the regression check: if
  // the bug returns, _riggedBoardSlots will be non-null right here.
  assert.equal(g._riggedBoardSlots, null)
  assert.equal(g._riggedHoleCards, null)
  // Whereas the staged queue holds the script.
  assert.ok(g._pendingRigHand)
  assert.ok(Array.isArray(g._pendingRigHand.board))
  // After firing the flop the armed fields must STILL be empty (i.e.
  // advancePhaseCards never reached the queue).
  g.advancePhaseCards()
  assert.equal(g._riggedBoardSlots, null)
  // The queue survives the in-progress hand and is ready for the next
  // startHand to consume it.
  assert.ok(g._pendingRigHand)
})

// And once startHand fires, the queued rig promotes to armed and the
// scripted cards appear on the NEXT hand's board.
test('rig_hand queued mid-previous-hand fires on the next startHand', () => {
  const g = new PokerGame(() => {})
  const p1 = makePlayer('p1')
  const p2 = makePlayer('p2')
  g.players = [p1, p2]
  // Queue the rig "during" a previous hand.
  g.setRiggedHand({
    holeCards: {
      p1: [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'hearts' }],
    },
    board: [
      { rank: 'K', suit: 'spades' }, null, null, null, null,
    ]
  })
  // Now start the next hand — pending must promote and the script must
  // bind to this hand's deck.
  g.dealerIndex = 0
  g.startHand()
  const p1Hand = g.playerHands.get('p1')
  const p1Keys = new Set(p1Hand.map(c => `${c.rank}-${c.suit}`))
  assert.equal(p1Keys.has('A-spades'), true)
  assert.equal(p1Keys.has('A-hearts'), true)
  // The queue is consumed.
  assert.equal(g._pendingRigHand, null)
  // The first community deal pulls the scripted king of spades onto
  // the first flop slot.
  g.advancePhaseCards()
  assert.equal(g.communityCards[0].rank, 'K')
  assert.equal(g.communityCards[0].suit, 'spades')
})

test('run-it-twice does NOT fire when the current hand is rigged', () => {
  const g = new PokerGame(() => {})
  const p1 = makePlayer('p1')
  const p2 = makePlayer('p2')
  g.players = [p1, p2]
  g.phase = GAME_PHASES.FLOP
  g.communityCards = [
    { rank: '7', suit: 'spades' }, { rank: '2', suit: 'hearts' }, { rank: 'K', suit: 'clubs' }
  ]
  g.pot = 50_000
  g.allInPlayers = new Set(['p1', 'p2'])
  g.foldedPlayers = new Set()
  g.removedPlayers = new Set()
  g.playerHands.set('p1', [{ rank: 'A', suit: 'spades' }, { rank: 'A', suit: 'diamonds' }])
  g.playerHands.set('p2', [{ rank: 'K', suit: 'hearts' }, { rank: 'K', suit: 'spades' }])
  // Without a rig, the trigger fires (all the standard conditions hold).
  assert.equal(g._shouldOfferRunItTwice(), true)
  // With a rig in effect, the trigger declines — the rig already
  // chose the outcome.
  g._handIsRigged = true
  assert.equal(g._shouldOfferRunItTwice(), false)
})

function makePlayer(id, chips = 10000) {
  return {
    id,
    username: id,
    chips,
    pokerBuyIn: chips,
    isBot: false,
    isConnected: true,
    send: () => {},
  }
}
