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
//   • scam (1) — refreshes every hand, low-stakes griefing
//   • hack (8) — slowest, since it ALWAYS lands chips (no opt-out)
const ITEM_COOLDOWN_HANDS = {
  peek: 6,
  swap: 6,
  scam: 1,
  hack: 8,
}

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

const ITEM_IDS = ['peek', 'swap', 'scam', 'hack']

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
    // playerId → Map<itemId, lastUsedHandIndex>
    this.cooldowns = new Map()
    // scamId → { senderId, senderUsername, targetId, targetUsername, amount, createdAt }
    this.pendingScams = new Map()
    this._scamSeq = 0
  }

  _cooldownFor(itemId) {
    return ITEM_COOLDOWN_HANDS[itemId] ?? 5
  }

  _isOnCooldown(playerId, itemId) {
    const last = this.cooldowns.get(playerId)?.get(itemId)
    if (typeof last !== 'number') return false
    return (this.game.handIndex - last) < this._cooldownFor(itemId)
  }

  _markUsed(playerId, itemId) {
    let m = this.cooldowns.get(playerId)
    if (!m) { m = new Map(); this.cooldowns.set(playerId, m) }
    m.set(itemId, this.game.handIndex)
  }

  cooldownHandsRemaining(playerId, itemId) {
    const last = this.cooldowns.get(playerId)?.get(itemId)
    if (typeof last !== 'number') return 0
    return Math.max(0, this._cooldownFor(itemId) - (this.game.handIndex - last))
  }

  // Per-player snapshot. Each item ships its own `refreshHands` value
  // so the client can render a progress bar (fills hand-by-hand) without
  // hardcoding the schedule.
  buildSnapshot(playerId) {
    return {
      items: ITEM_IDS.map(id => ({
        id,
        cooldownHandsRemaining: this.cooldownHandsRemaining(playerId, id),
        ready: !this._isOnCooldown(playerId, id),
        refreshHands: this._cooldownFor(id),
      })),
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
  hack(playerId, targetId) {
    if (this._isOnCooldown(playerId, 'hack')) return { success: false, error: 'cooldown' }
    if (playerId === targetId) return { success: false, error: 'cant_target_self' }
    const sender = this.room.players.get(playerId)
    const target = this.room.players.get(targetId)
    if (!sender || !target) return { success: false, error: 'target_not_at_table' }
    if (target.isBot) return { success: false, error: 'cant_target_bots' }
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
