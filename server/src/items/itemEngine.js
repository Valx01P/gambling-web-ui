// Player-vs-player griefing items. Each player has a small inventory of
// powers they can deploy against opponents at the table:
//
//   peek   — secretly look at another seat's hole cards (server replies
//            privately to the user; nobody else sees it).
//   swap   — swap your own hole cards with two fresh cards from the deck.
//            Server-authoritative — the new cards are dealt and the
//            game state broadcasts so showdown evaluates the new hand.
//   scam   — push a popup at another player with shifting Accept/Block
//            buttons. If they hit Accept, chips transfer to you. If they
//            Block, no-op.
//   hack   — randomly drain 5-15% of a target's chip stack into yours.
//            No popup, no opt-out — they just see the toast after.
//
// Cooldowns are tracked per (player, item) by the handIndex they were
// last used. After 5 hands they refresh. There's no inventory count —
// each item is one-shot per cooldown window.
//
// Bots can't USE items (the whole point is human griefing).
// Bots CAN be peeked — you can spy on their hole cards just like a human.
// Bots remain immune to scam/hack/swap targets (uninteresting griefing
// or unfair edge — bots can't react to popups or strategize around it).

import { MESSAGE_TYPES } from '../config/constants.js'

// Per-item cooldown in hands. Was a single COOLDOWN_HANDS=5 across the
// board; the user wanted finer control so each item gets its own:
//   • peek (6) and swap (6) — slow refresh, big swings
//   • scam — randomized 1..4 hands per use (see SCAM_COOLDOWN_*), used
//     as the *minimum* here for safety; the real value is picked at
//     _markUsed time and stored alongside the last-used hand index
//   • hack (8) — slowest, since it ALWAYS lands chips (no opt-out)
// 2026-05: halved across the board so players can take chips from each
// other more frequently. The "engage with other seats" design ask — if
// you only get to scam/hack once every 8 hands, the table feels
// passive. Faster reload keeps the griefing chip-stream flowing.
const ITEM_COOLDOWN_HANDS = {
  peek: 6,
  swap: 8,
  // 2026-05: scam drops to a 1-hand refresh per user request. Combined
  // with "stack multiple popups on the receiver" (see ScamPopupModal)
  // it turns scam into a per-hand griefing tool instead of a special.
  scam: 1,
  hack: 3,
  // Deck-rig powers — kept on long cooldowns because they're
  // strictly stronger than chip-takers.
  river_card: 8,
  next_card: 8,
  rig_hand: 16,
  // 2026-05 specials. crash_coin nukes any chosen market coin 95%;
  // crash_holdings wipes a target's crypto + stock positions 95%.
  crash_coin: 2,
  crash_holdings: 5,
  // PIN-hack: shows target a 4-digit PIN for 2s, then asks them to
  // retype it within 10s under "your account has been compromised"
  // pressure. Miss it → hacker drains 10-50% of their bank.
  pin_hack: 4,
}

// Scam cooldown is fixed at 1 hand now (was 2). Per user request:
// "refresh every turn".
const SCAM_COOLDOWN_MIN_HANDS = 1
const SCAM_COOLDOWN_MAX_HANDS = 1

const HACK_MIN_PERCENT = 0.05
const HACK_MAX_PERCENT = 0.15
// "Scam" griefing amount — fixed slice of the target's chips picked at
// scam-creation time so the displayed number doesn't drift while the
// target reads the popup.
const SCAM_PERCENT = 0.10
const SCAM_MIN_AMOUNT = 50
// Maximum time the target has to respond to a scam before it auto-blocks.
// Long enough to read the popup, short enough that an idle target can't
// indefinitely pin the sender's cooldown.
const SCAM_EXPIRY_MS = 30_000

// Scam re-enabled per user request — the popup mechanic is back as
// another way to take chips from another seat. Refreshes every ~3
// hands (see SCAM_COOLDOWN_*); the popup auto-blocks after 30s of
// no response so an AFK target can't pin the sender's cooldown.
const ITEM_IDS = [
  'peek', 'swap', 'scam', 'hack',
  'river_card', 'next_card', 'rig_hand',
  // Market-griefing specials. crash_coin: pick any coin and tank it 95%.
  // crash_holdings: pick a target player and wipe 95% of their crypto +
  // stock positions. Both route their server effects through the
  // respective engines (CryptoEngine / StockEngine).
  'crash_coin', 'crash_holdings',
  // Social-engineering special. See initiatePinHack — flashes a 4-digit
  // PIN at the target, then under fake "account compromised" pressure
  // demands they retype it within 10s. Failed recall drains 10-50%
  // of their bank balance into the hacker's bank.
  'pin_hack',
]

// Card validation tables. Used by swap() to reject malformed picks
// from the client. Kept here (not imported from the deck module) so
// the engine's contract for valid card objects is self-documenting.
const VALID_RANKS = new Set(['2','3','4','5','6','7','8','9','10','J','Q','K','A'])
const VALID_SUITS = new Set(['hearts','diamonds','clubs','spades'])

export class ItemEngine {
  constructor({ room, game, broadcast }) {
    this.room = room
    this.game = game
    this.broadcast = broadcast
    // playerId → Map<itemId, { lastHand: number, cooldownHands: number }>.
    // Per-use cooldownHands lets scam randomize its delay per attempt
    // without leaking the rolled value to other items.
    this.cooldowns = new Map()
    // scamId → { senderId, senderUsername, targetId, targetUsername, amount, createdAt }
    this.pendingScams = new Map()
    this._scamSeq = 0
    // pinHackId → { senderId, senderUsername, targetId, targetUsername, pin, amount, createdAt }
    this.pendingPinHacks = new Map()
  }

  _cooldownFor(itemId) {
    return ITEM_COOLDOWN_HANDS[itemId] ?? 5
  }

  // Pick the cooldown to use for a *fresh* use. Scam randomizes per use
  // (1..4 hands); everything else returns the static configured value.
  _rollCooldownHands(itemId) {
    if (itemId === 'scam') {
      const span = SCAM_COOLDOWN_MAX_HANDS - SCAM_COOLDOWN_MIN_HANDS + 1
      return SCAM_COOLDOWN_MIN_HANDS + Math.floor(Math.random() * span)
    }
    return this._cooldownFor(itemId)
  }

  _isOnCooldown(playerId, itemId) {
    const entry = this.cooldowns.get(playerId)?.get(itemId)
    if (!entry) return false
    return (this.game.handIndex - entry.lastHand) < entry.cooldownHands
  }

  _markUsed(playerId, itemId) {
    let m = this.cooldowns.get(playerId)
    if (!m) { m = new Map(); this.cooldowns.set(playerId, m) }
    m.set(itemId, {
      lastHand: this.game.handIndex,
      cooldownHands: this._rollCooldownHands(itemId),
    })
  }

  cooldownHandsRemaining(playerId, itemId) {
    const entry = this.cooldowns.get(playerId)?.get(itemId)
    if (!entry) return 0
    return Math.max(0, entry.cooldownHands - (this.game.handIndex - entry.lastHand))
  }

  // Per-player snapshot. Each item ships its own `refreshHands` value
  // so the client can render a progress bar (fills hand-by-hand) without
  // hardcoding the schedule. For scam — whose cooldown is randomized
  // per use — we report the *current* rolled value while it's active so
  // the progress bar fills at the right rate.
  buildSnapshot(playerId) {
    return {
      items: ITEM_IDS.map(id => {
        const entry = this.cooldowns.get(playerId)?.get(id)
        const refreshHands = entry?.cooldownHands ?? this._cooldownFor(id)
        return {
          id,
          cooldownHandsRemaining: this.cooldownHandsRemaining(playerId, id),
          ready: !this._isOnCooldown(playerId, id),
          refreshHands,
        }
      }),
    }
  }

  // ─── peek ──────────────────────────────────────────────────────────────
  // Peek works against BOTH humans and bots — the whole point is to spy
  // on cards and bots have cards just like anyone else. Other griefing
  // items (scam/hack/swap-on-target) stay human-only because they involve
  // popups or strategy reactions that don't make sense vs a bot.
  peek(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'peek')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_peek_self' }
    const target = this.room.players.get(targetId)
    if (!target) return { success: false, error: 'target_not_at_table' }
    const cards = this.game.playerHands?.get(targetId)
    if (!cards || cards.length === 0) return { success: false, error: 'no_hand_dealt' }
    this._markUsed(playerId, 'peek')
    return {
      success: true,
      targetId,
      targetUsername: target.username,
      cards: cards.map(c => ({ ...c }))
    }
  }

  // ─── swap ──────────────────────────────────────────────────────────────
  // Replaces the caller's hole cards with two specific cards picked from
  // the full 52-card deck — duplicates allowed for the meme. If no
  // picks are supplied (legacy clients), falls back to drawing two
  // random cards. With duplicate picks the swapper can build 5-of-a-
  // kind (or higher) by stacking onto whatever's already on the board.
  // Server validates that the picks are real card objects but does NOT
  // enforce uniqueness against the deck — that's the whole point.
  swap(playerId, picks) {
    if (this._isOnCooldown(playerId, 'swap')) return { success: false, error: 'cooldown' }
    const seat = this.room.players.get(playerId)
    if (!seat) return { success: false, error: 'not_at_table' }
    if (seat.isBot) return { success: false, error: 'bots_cant_use_items' }
    const oldCards = this.game.playerHands?.get(playerId)
    if (!oldCards || oldCards.length !== 2) return { success: false, error: 'no_hand_dealt' }
    if (this.game.phase === 'waiting' || this.game.phase === 'showdown') {
      return { success: false, error: 'not_in_hand' }
    }
    let newCards
    if (Array.isArray(picks) && picks.length === 2) {
      // Validate each pick is a real card. Reject anything malformed.
      const valid = picks.every(p =>
        p && VALID_RANKS.has(String(p.rank)) && VALID_SUITS.has(String(p.suit))
      )
      if (!valid) return { success: false, error: 'invalid_picks' }
      newCards = picks.map(p => ({ rank: String(p.rank), suit: String(p.suit) }))
    } else {
      if (!this.game.deck) return { success: false, error: 'no_deck' }
      newCards = this.game.deck.drawMultiple(2).map(c => ({ ...c }))
    }
    this.game.playerHands.set(playerId, newCards)
    this._markUsed(playerId, 'swap')
    return { success: true, newCards }
  }

  // ─── scam ──────────────────────────────────────────────────────────────
  // Picks the dollar amount up front so the target sees a stable number
  // even if their chip stack moves while they read the popup.
  initiateScam(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'scam')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_target_self' }
    const sender = this.room.players.get(playerId)
    const target = this.room.players.get(targetId)
    if (!sender || !target) return { success: false, error: 'target_not_at_table' }
    if (target.isBot) return { success: false, error: 'cant_target_bots' }
    if (target.chips <= 0) return { success: false, error: 'target_broke' }
    if (!target.isConnected) return { success: false, error: 'target_offline' }

    const amount = Math.max(SCAM_MIN_AMOUNT, Math.floor(target.chips * SCAM_PERCENT))
    const scamId = `scam_${++this._scamSeq}`
    this.pendingScams.set(scamId, {
      senderId: playerId,
      senderUsername: sender.username,
      targetId,
      targetUsername: target.username,
      amount,
      createdAt: Date.now()
    })
    this._markUsed(playerId, 'scam')

    // Push the popup to the victim. The client handles the shifting-
    // buttons UI; if Block wins the user's click, they POST back
    // accepted=false (no-op). If Accept wins, accepted=true and chips
    // move.
    target.send({
      type: 'item:scam_popup',
      data: { scamId, senderUsername: sender.username, amount }
    })

    // Auto-expire so an idle target can't sit on the scam forever.
    setTimeout(() => {
      if (this.pendingScams.has(scamId)) {
        this.pendingScams.delete(scamId)
        const senderNow = this.room.players.get(playerId)
        senderNow?.send({
          type: MESSAGE_TYPES.SYSTEM_MESSAGE,
          data: { message: `${target.username} ignored your scam — expired.` }
        })
      }
    }, SCAM_EXPIRY_MS).unref?.()

    return { success: true, scamId }
  }

  resolveScam(targetId, scamId, accepted) {
    const scam = this.pendingScams.get(scamId)
    if (!scam) return { success: false, error: 'unknown_scam' }
    if (scam.targetId !== targetId) return { success: false, error: 'not_target' }
    this.pendingScams.delete(scamId)

    const sender = this.room.players.get(scam.senderId)
    const target = this.room.players.get(targetId)
    if (!sender || !target) return { success: false, error: 'player_gone' }

    if (!accepted) {
      sender.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🛡 ${target.username} blocked your scam.` }
      })
      return { success: true, blocked: true }
    }
    // Accepted — transfer the amount. Cap at target's current chips so
    // a stack that has drained since the popup posted can't go negative.
    const transfer = Math.min(scam.amount, target.chips)
    target.chips -= transfer
    sender.chips += transfer
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: {
        message: `🪤 ${target.username} fell for ${sender.username}'s scam — $${transfer.toLocaleString()} transferred.`
      }
    })
    return { success: true, transferred: transfer }
  }

  // ─── hack ──────────────────────────────────────────────────────────────
  // Targets humans AND bots. Bots are valid victims — their chip stack
  // is real money at the table and lifting some of it into the hacker's
  // pocket is fair game. (Scam, which requires popup interaction the
  // bot can't perform, stays human-only.)
  hack(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'hack')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_target_self' }
    const sender = this.room.players.get(playerId)
    const target = this.room.players.get(targetId)
    if (!sender || !target) return { success: false, error: 'target_not_at_table' }
    if (target.chips <= 0) return { success: false, error: 'target_broke' }

    const pct = HACK_MIN_PERCENT + Math.random() * (HACK_MAX_PERCENT - HACK_MIN_PERCENT)
    const amount = Math.max(1, Math.floor(target.chips * pct))
    target.chips -= amount
    sender.chips += amount
    this._markUsed(playerId, 'hack')

    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `💻 ${sender.username} hacked ${target.username} for $${amount.toLocaleString()}.` }
    })
    return { success: true, amount, targetUsername: target.username }
  }

  // ─── river_card / next_card / rig_hand ───────────────────────────────
  // These three "deck-rig" powers all mutate state on the PokerGame
  // itself (via its setRigged* methods); cooldown bookkeeping is
  // identical to the other items. None of them target another player.

  // Force the river card (8-hand cooldown). The chosen card replaces
  // whatever the deck would have produced when the turn→river transition
  // fires. Valid mid-hand any time before that transition. If the rig
  // card has already been dealt earlier in the same hand (e.g. it came
  // out on the flop), the river falls back to a random draw at advance
  // time — graceful, no error.
  useRiverCard(playerId, card) {
    if (this._isOnCooldown(playerId, 'river_card')) return { success: false, error: 'cooldown' }
    if (this.game.phase === 'showdown' || this.game.phase === 'waiting') {
      return { success: false, error: 'no_active_hand' }
    }
    if (this.game.phase === 'river') return { success: false, error: 'river_already_dealt' }
    const result = this.game.setRiggedRiverCard(card)
    if (!result.success) return result
    this._markUsed(playerId, 'river_card')
    return { success: true }
  }

  // Force the very next community card (8-hand cooldown). Fires on
  // the NEXT advancePhaseCards call regardless of which street that is.
  useNextCard(playerId, card) {
    if (this._isOnCooldown(playerId, 'next_card')) return { success: false, error: 'cooldown' }
    if (this.game.phase === 'showdown' || this.game.phase === 'waiting') {
      return { success: false, error: 'no_active_hand' }
    }
    if (this.game.phase === 'river') return { success: false, error: 'no_more_cards' }
    const result = this.game.setRiggedNextCard(card)
    if (!result.success) return result
    this._markUsed(playerId, 'next_card')
    return { success: true }
  }

  // Script the entire next hand (14-hand cooldown). Payload shape:
  //   { holeCards: {playerId: [card,card], ...}, board: [c0..c4] }
  // Either side can be omitted. Unspecified slots draw randomly at
  // deal-time. Players who weren't seated when this fired still get
  // random hole cards — late joiners don't break the plan.
  useRigHand(playerId, payload) {
    if (this._isOnCooldown(playerId, 'rig_hand')) return { success: false, error: 'cooldown' }
    const result = this.game.setRiggedHand(payload || {})
    if (!result.success) return result
    this._markUsed(playerId, 'rig_hand')
    return { success: true }
  }

  // ─── crash_coin (2-hand cooldown) ──────────────────────────────────────
  // Nukes the chosen coin's price ~95% in one tick. Different from a rug:
  // the rug requires you to own the coin and pays the owner a cut of
  // outsiders' cost basis; crash_coin works on ANY market coin (no
  // ownership required) and doesn't drain holders — it just tanks the
  // chart. Holders sell into the floor if they want out.
  crashCoin(playerId, coinId) {
    if (this._isOnCooldown(playerId, 'crash_coin')) return { success: false, error: 'cooldown' }
    if (!this.room.cryptoEngine) return { success: false, error: 'crypto_unavailable' }
    const sender = this.room.players.get(playerId) || this.room.spectators?.get?.(playerId)
    if (!sender) return { success: false, error: 'not_at_table' }
    if (sender.isBot) return { success: false, error: 'bots_cant_use_items' }
    const result = this.room.cryptoEngine.crashCoin(coinId)
    if (!result.success) return result
    this._markUsed(playerId, 'crash_coin')
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `📉 ${sender.username} crashed $${result.symbol} ${result.dropPct}%.` }
    })
    return { success: true, ...result }
  }

  // ─── crash_holdings (5-hand cooldown) ──────────────────────────────────
  // Wipes 95% of the target player's open crypto + stock positions. No
  // chip transfer — the value evaporates. A no-position target sees no
  // effect, the cooldown still burns. Bot targets are skipped (no real
  // money there to grief).
  crashHoldings(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'crash_holdings')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_target_self' }
    const sender = this.room.players.get(playerId) || this.room.spectators?.get?.(playerId)
    const target = this.room.players.get(targetId) || this.room.spectators?.get?.(targetId)
    if (!sender || !target) return { success: false, error: 'target_not_at_table' }
    if (sender.isBot) return { success: false, error: 'bots_cant_use_items' }
    if (target.isBot) return { success: false, error: 'cant_target_bots' }

    const cryptoSummary = this.room.cryptoEngine?.crashHoldingsFor?.(targetId) || { coins: 0, valueLost: 0 }
    const stockSummary = this.room.stockEngine?.crashHoldingsFor?.(targetId) || { positions: 0, valueLost: 0 }
    const totalLost = (cryptoSummary.valueLost || 0) + (stockSummary.valueLost || 0)
    const hitCount = (cryptoSummary.coins || 0) + (stockSummary.positions || 0)

    this._markUsed(playerId, 'crash_holdings')
    if (hitCount === 0) {
      // Still log so the sender knows the special fired but found nothing.
      sender.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `💥 You crashed ${target.username}'s holdings — they had nothing open.` }
      })
      return { success: true, hitCount: 0, totalLost: 0 }
    }
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: {
        message: `💥 ${sender.username} crashed ${target.username}'s holdings — $${Math.round(totalLost).toLocaleString()} wiped across ${hitCount} position${hitCount === 1 ? '' : 's'}.`
      }
    })
    return { success: true, hitCount, totalLost: Math.round(totalLost) }
  }

  // ─── pin_hack (8-hand cooldown) ────────────────────────────────────────
  // Social-engineering minigame. The target sees a 4-digit PIN for ~2s,
  // then a fake "account compromised, retype your PIN" panel demands
  // they re-enter it within 10s. Failure (wrong PIN or timeout) drains
  // 10-50% of the target's BANK balance into the hacker's bank. The
  // hacker's cooldown burns immediately; the response window is policed
  // by a server-side timer so an AFK target can't sit on the popup
  // forever. Bots are immune (no popup interaction).
  initiatePinHack(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'pin_hack')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_target_self' }
    const sender = this.room.players.get(playerId)
    const target = this.room.players.get(targetId)
    if (!sender || !target) return { success: false, error: 'target_not_at_table' }
    if (sender.isBot) return { success: false, error: 'bots_cant_use_items' }
    if (target.isBot) return { success: false, error: 'cant_target_bots' }
    if (!target.isConnected) return { success: false, error: 'target_offline' }
    if ((target.bankBalance || 0) <= 0) return { success: false, error: 'target_broke' }

    // Pick the dollar slice up front so the target reads a stable number
    // through both phases. 10-50% of CURRENT bank — captured at trigger
    // time, not at resolve time, so a wallet that swings during the 12s
    // window doesn't change the stakes mid-flow.
    const pct = 0.10 + Math.random() * 0.40
    const amount = Math.max(1, Math.floor((target.bankBalance || 0) * pct))
    const pin = String(1000 + Math.floor(Math.random() * 9000))
    const pinHackId = `pinhack_${++this._scamSeq}`
    if (!this.pendingPinHacks) this.pendingPinHacks = new Map()
    this.pendingPinHacks.set(pinHackId, {
      senderId: playerId,
      senderUsername: sender.username,
      targetId,
      targetUsername: target.username,
      pin,
      amount,
      createdAt: Date.now(),
    })
    this._markUsed(playerId, 'pin_hack')

    // Push the popup to the victim. Client handles the two-phase UI
    // (memorize → input). The full 12s timeout (2s show + 10s input)
    // is enforced server-side too so a tab close or network drop still
    // resolves cleanly.
    target.send({
      type: 'item:pin_hack_popup',
      data: { pinHackId, senderUsername: sender.username, pin, amount }
    })

    setTimeout(() => {
      const stillPending = this.pendingPinHacks.get(pinHackId)
      if (!stillPending) return
      this.pendingPinHacks.delete(pinHackId)
      this._applyPinHackOutcome(stillPending, /* matched= */ false, /* reason= */ 'timeout')
    }, 12_000).unref?.()

    return { success: true, pinHackId }
  }

  resolvePinHack(targetId, pinHackId, guess) {
    if (!this.pendingPinHacks) return { success: false, error: 'unknown_pin_hack' }
    const pending = this.pendingPinHacks.get(pinHackId)
    if (!pending) return { success: false, error: 'unknown_pin_hack' }
    if (pending.targetId !== targetId) return { success: false, error: 'not_target' }
    this.pendingPinHacks.delete(pinHackId)
    const matched = String(guess).trim() === pending.pin
    this._applyPinHackOutcome(pending, matched, matched ? 'matched' : 'wrong_pin')
    return { success: true, matched }
  }

  _applyPinHackOutcome(pending, matched, reason) {
    const sender = this.room.players.get(pending.senderId)
                || this.room.spectators?.get?.(pending.senderId)
                || null
    const target = this.room.players.get(pending.targetId)
                || this.room.spectators?.get?.(pending.targetId)
                || null
    if (!sender || !target) return
    if (matched) {
      target.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🛡 You remembered the PIN — ${pending.senderUsername}'s hack failed.` }
      })
      sender.send({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `🛡 ${pending.targetUsername} remembered the PIN. Your hack bounced.` }
      })
      return
    }
    // Failed: drain the captured slice, capped at target's current bank
    // (which may have moved during the 12s window).
    const available = Math.max(0, target.bankBalance || 0)
    const transfer = Math.min(pending.amount, available)
    target.bankBalance = available - transfer
    sender.bankBalance = (sender.bankBalance || 0) + transfer
    const reasonLabel = reason === 'timeout' ? 'ran out of time' : 'fumbled the PIN'
    this.broadcast({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: {
        message: `🪪 ${pending.targetUsername} ${reasonLabel} — ${pending.senderUsername} drained $${transfer.toLocaleString()} from their bank.`
      }
    })
    // Push a fresh room update so both clients' bank widgets reflect
    // the transfer without waiting on the next hand tick.
    if (typeof this.room?.broadcastRoomUpdate === 'function') {
      this.room.broadcastRoomUpdate()
    }
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────
  // Called by PokerRoom on hand-end so each client sees updated cooldown
  // values without polling.
  onHandEnd() {
    this._broadcastSnapshots()
  }

  _broadcastSnapshots() {
    const seats = this.room.players?.values?.() || []
    for (const p of seats) {
      if (p.isBot || !p.isConnected) continue
      this._sendSnapshot(p)
    }
    const specs = this.room.spectators?.values?.() || []
    for (const s of specs) {
      if (!s.isConnected) continue
      this._sendSnapshot(s)
    }
  }

  _sendSnapshot(player) {
    player.send({
      type: 'items:state',
      data: this.buildSnapshot(player.id)
    })
  }

  // Used by PokerRoom on join/reconnect so a fresh client knows their
  // current cooldown status without waiting for the next hand-end.
  sendSnapshotTo(player) {
    if (!player || player.isBot) return
    this._sendSnapshot(player)
  }
}
