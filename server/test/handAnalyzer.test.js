import test from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzePreflop,
  analyzePostflop,
  analyzeHand,
  preflopScore,
  tierFromScore,
  handLabel
} from '../src/bots/runtime/handAnalyzer.js'
import { preflopStrength } from '../src/bots/runtime/handStrength.js'

// ─── The critical regression: AK must NEVER classify below 'premium' ───
test('AKo is premium (was getting folded preflop in old scorer)', () => {
  const ak = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]
  const pre = analyzePreflop(ak[0], ak[1])
  assert.equal(pre.label, 'AKo')
  assert.equal(pre.tier, 'premium')
  assert.ok(pre.score >= 0.85, `AKo score should be ≥0.85, got ${pre.score}`)
  assert.equal(pre.neverFoldPreflop, true)
  assert.equal(preflopStrength(ak), 'premium')
})

test('AKs is premium', () => {
  const ak = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }]
  const pre = analyzePreflop(ak[0], ak[1])
  assert.equal(pre.label, 'AKs')
  assert.equal(pre.tier, 'premium')
  assert.equal(pre.neverFoldPreflop, true)
})

test('AA, KK, QQ, JJ, TT, AKs, AKo, AQs are ALL premium', () => {
  const cases = [
    ['A', 'A'], ['K', 'K'], ['Q', 'Q'], ['J', 'J'], ['10', '10']
  ]
  for (const [a, b] of cases) {
    const cards = [{ rank: a, suit: 'spades' }, { rank: b, suit: 'hearts' }]
    assert.equal(preflopStrength(cards), 'premium', `${a}${b} should be premium`)
  }
  const suited = [
    [['A', 'spades'], ['K', 'spades']],
    [['A', 'hearts'], ['Q', 'hearts']]
  ]
  for (const [c1, c2] of suited) {
    const cards = [{ rank: c1[0], suit: c1[1] }, { rank: c2[0], suit: c2[1] }]
    assert.equal(preflopStrength(cards), 'premium', `${c1[0]}${c2[0]}s should be premium`)
  }
  // AKo
  const ako = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }]
  assert.equal(preflopStrength(ako), 'premium')
})

test('Hand ordering matches conventional poker rankings', () => {
  const score = (r1, s1, r2, s2) =>
    preflopScore({ rank: r1, suit: s1 }, { rank: r2, suit: s2 })
  // AA > KK > 99 > 22
  assert.ok(score('A', 'h', 'A', 's') > score('K', 'h', 'K', 's'))
  assert.ok(score('K', 'h', 'K', 's') > score('9', 'h', '9', 's'))
  assert.ok(score('9', 'h', '9', 's') > score('2', 'h', '2', 's'))
  // AKs > AKo
  assert.ok(score('A', 's', 'K', 's') > score('A', 's', 'K', 'h'))
  // TT > AKs (conventional heads-up equity ordering)
  assert.ok(score('10', 's', '10', 'h') > score('A', 's', 'K', 's'))
  // 22 < AKs (small pair < premium unpaired)
  assert.ok(score('2', 's', '2', 'h') < score('A', 's', 'K', 's'))
  // AKo > AQo
  assert.ok(score('A', 's', 'K', 'h') > score('A', 's', 'Q', 'h'))
  // 72o is trash
  assert.ok(score('7', 's', '2', 'h') < 0.25)
})

test('handLabel: produces canonical 2-3-char names', () => {
  assert.equal(handLabel({ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' }), 'AA')
  assert.equal(handLabel({ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }), 'AKs')
  assert.equal(handLabel({ rank: 'K', suit: 's' }, { rank: 'A', suit: 'h' }), 'AKo')
  assert.equal(handLabel({ rank: '10', suit: 's' }, { rank: '9', suit: 's' }), 'T9s')
  assert.equal(handLabel({ rank: '7', suit: 's' }, { rank: '2', suit: 'h' }), '72o')
})

test('analyzePreflop: classifies hand types', () => {
  const aa = analyzePreflop({ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' })
  assert.equal(aa.pair, true)
  assert.equal(aa.isBigPair, true)
  assert.equal(aa.neverFoldPreflop, true)

  const t9s = analyzePreflop({ rank: '10', suit: 's' }, { rank: '9', suit: 's' })
  assert.equal(t9s.isSuitedConnector, true)
  assert.equal(t9s.suited, true)
  assert.equal(t9s.pair, false)

  const ako = analyzePreflop({ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' })
  assert.equal(ako.isOffsuitAce, true)
  assert.equal(ako.neverFoldPreflop, true)
  assert.equal(ako.threeBetWorthy, true)

  const eight_three_o = analyzePreflop({ rank: '8', suit: 's' }, { rank: '3', suit: 'h' })
  assert.equal(eight_three_o.tier, 'trash')
  assert.equal(eight_three_o.neverOpen, true)
})

test('Playability flags scale with position', () => {
  // KQs: playable from anywhere
  const kqs = analyzePreflop({ rank: 'K', suit: 's' }, { rank: 'Q', suit: 's' })
  assert.equal(kqs.playableUTG, true)
  assert.equal(kqs.playableBTN, true)

  // 54s: playable from CO/BTN, not UTG
  const fs = analyzePreflop({ rank: '5', suit: 's' }, { rank: '4', suit: 's' })
  assert.equal(fs.playableUTG, false)
  assert.equal(fs.playableBTN, true)
})

test('analyzePostflop: returns null preflop', () => {
  const r = analyzePostflop(
    [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 's' }],
    []
  )
  assert.equal(r, null)
})

test('analyzePostflop: top pair top kicker classification', () => {
  // AK on A72 rainbow flop = top pair top kicker
  const r = analyzePostflop(
    [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }],
    [{ rank: 'A', suit: 'd' }, { rank: '7', suit: 'c' }, { rank: '2', suit: 'h' }]
  )
  assert.equal(r.made.rank, 1) // pair
  assert.equal(r.pair.isTopPair, true)
  assert.equal(r.pair.kickerStrength, 'strong')
  assert.equal(r.valueClass, 'medium')
  assert.equal(r.commitmentSuggestion, 'pot-control')
  assert.equal(r.vulnerability, 'low')
})

test('analyzePostflop: overpair on dry board is strong', () => {
  // KK on 932 rainbow = overpair
  const r = analyzePostflop(
    [{ rank: 'K', suit: 's' }, { rank: 'K', suit: 'h' }],
    [{ rank: '9', suit: 'd' }, { rank: '3', suit: 'c' }, { rank: '2', suit: 'h' }]
  )
  assert.equal(r.made.rank, 1)
  assert.equal(r.pair.isOverpair, true)
  assert.equal(r.valueClass, 'strong')
  assert.equal(r.commitmentSuggestion, 'commit')
})

test('analyzePostflop: set on dry board → commit', () => {
  // 77 on 732 rainbow = set
  const r = analyzePostflop(
    [{ rank: '7', suit: 's' }, { rank: '7', suit: 'h' }],
    [{ rank: '7', suit: 'd' }, { rank: '3', suit: 'c' }, { rank: '2', suit: 'h' }]
  )
  assert.equal(r.made.rank, 3) // trips/set
  assert.equal(r.commitmentSuggestion, 'commit')
  assert.equal(r.valueClass, 'strong')
})

test('analyzePostflop: flush draw detected via hole cards', () => {
  // AKs on Q5s2x (two spades on board + AK suited) = flush draw
  const r = analyzePostflop(
    [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
    [{ rank: 'Q', suit: 'spades' }, { rank: '5', suit: 'spades' }, { rank: '2', suit: 'hearts' }]
  )
  assert.equal(r.flushDraw.has, true)
  assert.equal(r.flushDraw.viaHole, true)
  assert.ok(r.outs >= 9)
  assert.equal(r.semibluffCandidate, true)
})

test('analyzePostflop: open-ended straight draw', () => {
  // 87 on T9x = open-ended (need 6 or J)
  const r = analyzePostflop(
    [{ rank: '8', suit: 's' }, { rank: '7', suit: 'h' }],
    [{ rank: '10', suit: 'd' }, { rank: '9', suit: 'c' }, { rank: '2', suit: 'h' }]
  )
  assert.equal(r.straightDraw.openEnded, true)
  assert.ok(r.outs >= 8)
})

test('analyzePostflop: low pair on wet board is vulnerable', () => {
  // 88 on AhKhQh — underpair on a monotone broadway flop = trash + scary
  const r = analyzePostflop(
    [{ rank: '8', suit: 's' }, { rank: '8', suit: 'd' }],
    [{ rank: 'A', suit: 'hearts' }, { rank: 'K', suit: 'hearts' }, { rank: 'Q', suit: 'hearts' }]
  )
  assert.equal(r.pair.isUnderpair, true)
  assert.equal(r.vulnerability, 'high')
})

test('analyzePostflop: nut flush gets a relative-strength bump', () => {
  // AKs (both spades) on K-5-2 all spades = nut flush
  const r = analyzePostflop(
    [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'spades' }],
    [{ rank: '5', suit: 'spades' }, { rank: '2', suit: 'spades' }, { rank: '9', suit: 'spades' }]
  )
  assert.equal(r.made.rank, 5) // flush
  assert.ok(r.relativeStrength >= 0.85)
  assert.equal(r.valueClass, 'strong')
})

test('analyzeHand: integrated preflop + postflop', () => {
  // Preflop only
  const pre = analyzeHand(
    [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }],
    []
  )
  assert.ok(pre.preflop)
  assert.equal(pre.preflop.tier, 'premium')
  assert.equal(pre.postflop, null)

  // Postflop
  const post = analyzeHand(
    [{ rank: 'A', suit: 's' }, { rank: 'K', suit: 'h' }],
    [{ rank: 'A', suit: 'd' }, { rank: '7', suit: 'c' }, { rank: '2', suit: 'h' }]
  )
  assert.ok(post.preflop)
  assert.ok(post.postflop)
  assert.equal(post.postflop.pair.isTopPair, true)
})

test('tierFromScore boundaries', () => {
  assert.equal(tierFromScore(0.95), 'premium')
  assert.equal(tierFromScore(0.85), 'premium')
  assert.equal(tierFromScore(0.84), 'strong')
  assert.equal(tierFromScore(0.70), 'strong')
  assert.equal(tierFromScore(0.55), 'medium')
  assert.equal(tierFromScore(0.40), 'weak')
  assert.equal(tierFromScore(0.20), 'trash')
})
