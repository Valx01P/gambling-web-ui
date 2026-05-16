// Influence Ops — pay chips to manipulate markets at scale.
//
// This is the "research/manipulation" meta-layer the brief asked for:
// once you've outgrown crypto whaling and need bigger toys, you start
// spending real money on tilting entire markets. Each op has a chip
// cost, a per-player hand-cooldown, and a market-wide effect that
// ripples through stocks (and sometimes crypto / assets).
//
// Content carve-outs from the original spec:
//   • "Cause a 9/11" → reframed as "Engineered Financial Crisis".
//     Same mechanic (broad market crash for profit), no real-victim
//     reference.
//   • "Assassinate a CEO" → reframed as "CEO Scandal Leak". Same
//     gameplay effect (one ticker craters), less murderous flavor.
//
// All ops are anonymous-by-default to the room (no attribution
// broadcast) — that's part of the fun, the market just tanks and
// nobody knows who did it. Only "Engineered Crisis" announces a
// global event since it's market-wide.
//
// Server-authoritative. Bots can't run ops (they don't have a chip
// economy that matters to them).

import { MESSAGE_TYPES } from '../config/constants.js'

const OPS = [
  {
    id: 'fake_bullish_news',
    title: 'Fake Bullish News',
    blurb: 'Plant a glowing fake research note. Pumps the whole market.',
    icon: '📰',
    cost: 1_000_000,
    cooldownHands: 4,
    effect: { kind: 'market_pump',  magnitude: [0.08, 0.14] },
    attribution: 'anonymous',
  },
  {
    id: 'fake_bearish_news',
    title: 'Fake Bearish News',
    blurb: 'Leak a fake regulatory probe. Drags the whole market down.',
    icon: '📉',
    cost: 1_000_000,
    cooldownHands: 4,
    effect: { kind: 'market_dip',   magnitude: [0.08, 0.14] },
    attribution: 'anonymous',
  },
  {
    id: 'ceo_scandal',
    title: 'CEO Scandal Leak',
    blurb: 'Drop a scandal dossier on one company. Stock craters 30-50%.',
    icon: '🗞️',
    cost: 500_000,
    cooldownHands: 3,
    effect: { kind: 'single_dump',  magnitude: [0.30, 0.50] },
    attribution: 'anonymous',
    requiresTarget: true,
  },
  {
    id: 'insider_tip',
    title: 'Insider Tip',
    blurb: 'Pay for non-public info. One stock you pick gets a +20-30% bump.',
    icon: '🕵️',
    cost: 350_000,
    cooldownHands: 3,
    effect: { kind: 'single_pump',  magnitude: [0.20, 0.30] },
    attribution: 'private',
    requiresTarget: true,
  },
  {
    id: 'engineered_crisis',
    title: 'Engineered Financial Crisis',
    blurb: 'A coordinated market shock. Crashes everything ~30%. Buy the dip.',
    icon: '⚡',
    cost: 50_000_000,
    cooldownHands: 12,
    effect: { kind: 'mega_crash',   magnitude: [0.25, 0.40] },
    attribution: 'global',
  },
  {
    id: 'release_virus',
    title: 'Release a Pathogen',
    blurb: 'A fictional engineered pandemic. World yields collapse, real estate craters.',
    icon: '☣️',
    cost: 25_000_000,
    cooldownHands: 10,
    effect: { kind: 'pandemic' },
    attribution: 'global',
  },
]

export class InfluenceEngine {
  constructor({ room, broadcast }) {
    this.room = room
    this.broadcast = broadcast
    // playerId → Map<opId, handIndex when last used>
    this.cooldowns = new Map()
  }

  _findPlayer(playerId) {
    return this.room.players?.get?.(playerId) || this.room.spectators?.get?.(playerId) || null
  }

  _opDef(id) { return OPS.find(o => o.id === id) }

  _isOnCooldown(playerId, opId, handIndex) {
    const opDef = this._opDef(opId)
    if (!opDef) return true
    const last = this.cooldowns.get(playerId)?.get(opId)
    if (typeof last !== 'number') return false
    return (handIndex - last) < opDef.cooldownHands
  }

  _markUsed(playerId, opId, handIndex) {
    let m = this.cooldowns.get(playerId)
    if (!m) { m = new Map(); this.cooldowns.set(playerId, m) }
    m.set(opId, handIndex)
  }

  buildSnapshot(playerId, handIndex = 0) {
    return {
      ops: OPS.map(op => {
        const last = this.cooldowns.get(playerId)?.get(op.id)
        const cooldownRemaining = typeof last === 'number'
          ? Math.max(0, op.cooldownHands - (handIndex - last))
          : 0
        return {
          id: op.id,
          title: op.title,
          blurb: op.blurb,
          icon: op.icon,
          cost: op.cost,
          cooldownHands: op.cooldownHands,
          cooldownRemaining,
          ready: cooldownRemaining === 0,
          attribution: op.attribution,
          requiresTarget: !!op.requiresTarget,
        }
      })
    }
  }

  run(playerId, { opId, targetSymbol } = {}, handIndex = 0) {
    const op = this._opDef(opId)
    if (!op) return { success: false, error: 'unknown_op' }
    const player = this._findPlayer(playerId)
    if (!player) return { success: false, error: 'not_at_table' }
    if (player.isBot) return { success: false, error: 'bots_cannot_run_ops' }
    if (player.chips < op.cost) return { success: false, error: 'insufficient_chips', cost: op.cost }
    if (this._isOnCooldown(playerId, opId, handIndex)) {
      const last = this.cooldowns.get(playerId).get(opId)
      return { success: false, error: 'cooldown', remaining: op.cooldownHands - (handIndex - last) }
    }
    if (op.requiresTarget && !targetSymbol) {
      return { success: false, error: 'target_required' }
    }

    // Charge + cooldown the op before applying its effect so a
    // mid-effect crash can't double-fire.
    player.chips -= op.cost
    this._markUsed(playerId, opId, handIndex)

    // Apply the effect.
    const stockEngine = this.room.stockEngine
    const worldEngine = this.room.worldEngine
    let detail = null
    switch (op.effect.kind) {
      case 'market_pump': {
        const mag = randRange(op.effect.magnitude)
        if (stockEngine) {
          for (const stock of stockEngine.stocks.values()) {
            stock.price = Math.max(1, Math.round(stock.price * (1 + mag) * 100) / 100)
            stockEngine.pushHistoryFor?.(stock, stock.price)
          }
          stockEngine._broadcastState()
        }
        detail = { magnitude: mag }
        break
      }
      case 'market_dip': {
        const mag = randRange(op.effect.magnitude)
        if (stockEngine) {
          for (const stock of stockEngine.stocks.values()) {
            stock.price = Math.max(1, Math.round(stock.price * (1 - mag) * 100) / 100)
            stockEngine.pushHistoryFor?.(stock, stock.price)
          }
          stockEngine._broadcastState()
        }
        detail = { magnitude: mag }
        break
      }
      case 'mega_crash': {
        const mag = randRange(op.effect.magnitude)
        if (stockEngine) {
          stockEngine.applyMarketShock(mag)
        }
        // Cascades into real estate too — financial crises don't
        // stay in one market.
        try { this.room.assetEngine?.applyMarketShock(1 - mag * 0.5) } catch {}
        detail = { magnitude: mag }
        break
      }
      case 'single_dump': {
        const stock = stockEngine?.stocks?.get(targetSymbol)
        if (!stock) { player.chips += op.cost; return { success: false, error: 'unknown_symbol' } }
        const mag = randRange(op.effect.magnitude)
        stock.price = Math.max(1, Math.round(stock.price * (1 - mag) * 100) / 100)
        stockEngine.pushHistoryFor?.(stock, stock.price)
        stockEngine._broadcastState()
        detail = { symbol: targetSymbol, magnitude: mag }
        break
      }
      case 'single_pump': {
        const stock = stockEngine?.stocks?.get(targetSymbol)
        if (!stock) { player.chips += op.cost; return { success: false, error: 'unknown_symbol' } }
        const mag = randRange(op.effect.magnitude)
        stock.price = Math.max(1, Math.round(stock.price * (1 + mag) * 100) / 100)
        stockEngine.pushHistoryFor?.(stock, stock.price)
        stockEngine._broadcastState()
        detail = { symbol: targetSymbol, magnitude: mag }
        break
      }
      case 'pandemic': {
        if (worldEngine && !worldEngine.pandemicActive) {
          // Don't double-charge — the worldEngine.releasePandemic has
          // its own cost. Bypass it by setting state directly so the
          // influence op IS the cost.
          worldEngine.pandemicActive = true
          worldEngine.pandemicActiveUntilHand = handIndex + 6
          try { this.room.assetEngine?.applyMarketShock(0.55) } catch {}
          try { stockEngine?.applyMarketShock(0.25) } catch {}
          this.broadcast({
            type: MESSAGE_TYPES.SYSTEM_MESSAGE,
            data: { message: `☣️ A novel pathogen has been released into the global supply chain. World yields collapse for 6 hands.` }
          })
        }
        break
      }
    }

    // Anonymous-by-default broadcasts. The runner gets a private
    // confirmation; the room gets an unsigned "market event"
    // announcement. Insider Tip stays fully private — nobody else
    // even sees that anything happened.
    if (op.attribution === 'anonymous') {
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${op.icon} Market event: ${op.title.toLowerCase()}.` }
      })
    } else if (op.attribution === 'global') {
      this.broadcast({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `${op.icon} GLOBAL EVENT — ${op.title}. Markets reeling.` }
      })
    }
    player.send({
      type: MESSAGE_TYPES.SYSTEM_MESSAGE,
      data: { message: `${op.icon} You ran "${op.title}" for $${op.cost.toLocaleString()}.` }
    })

    this._broadcastSnapshots(handIndex)
    return { success: true, opId, detail }
  }

  onHandEnd(handIndex = 0) {
    // Snapshot push so cooldown badges tick down.
    this._broadcastSnapshots(handIndex)
  }

  _broadcastSnapshots(handIndex = 0) {
    const audience = [
      ...(this.room.players?.values?.() || []),
      ...(this.room.spectators?.values?.() || []),
    ]
    for (const p of audience) {
      if (p.isBot || !p.isConnected) continue
      p.send({ type: 'influence:state', data: this.buildSnapshot(p.id, handIndex) })
    }
  }

  sendSnapshotTo(player, handIndex = 0) {
    if (!player || player.isBot) return
    player.send({ type: 'influence:state', data: this.buildSnapshot(player.id, handIndex) })
  }
}

function randRange([min, max]) { return min + Math.random() * (max - min) }
