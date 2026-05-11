import { MESSAGE_TYPES, GAME_PHASES } from '../../config/constants.js'
import { buildContext } from './signals.js'
import { compileBot } from './codeSandbox.js'

// Bumped from 800/2400 → 1800/3800 so spectators can actually follow the
// active-player ring + last-action badges before the next bot acts. Real
// players don't hit this code path.
const THINK_DELAY_MIN_MS = 1800
const THINK_DELAY_MAX_MS = 3800

// Quacks like a connected websocket Player. The room calls send() with
// game_state messages; on our turn, we schedule a "think" delay and act.
export class BotPlayer {
  constructor({ id, bot, addedByPlayerId, room, ownerDisplayName, startingChips }) {
    this.id = id
    this.bot = bot
    this.addedByPlayerId = addedByPlayerId
    this.room = room
    this.ownerDisplayName = ownerDisplayName || bot.ownerDisplayName || null

    this.username = bot.name
    this.chips = startingChips
    this.pokerBuyIn = startingChips
    this.avatarId = null
    this.avatarUrl = null
    this.botColor = bot.color
    this.botTextColor = bot.textColor || 'auto'
    // Custom uploaded image for the bot. When set, the client renders this
    // instead of the color+initials fallback. Null = no custom image.
    this.botAvatarUrl = bot.avatarUrl || null
    this.botId = bot.id

    this.currentRoom = null
    this.isSpectator = false
    this.isVoluntarySpectator = false
    this.isConnected = true
    this.isBot = true
    this.lastActiveTime = Date.now()

    this._pendingTimeout = null
    this._lastTurnKey = null
    this._destroyed = false

    // Compile the user's JS once when the bot sits down. If there's no code
    // or it fails to compile, the bot will safely fold/check on its turn
    // (no fallback rule engine — bots are code-only by product decision).
    this._compiled = null
    if (typeof bot.code === 'string' && bot.code.trim().length > 0) {
      this._compiled = compileBot(bot.code)
      if (this._compiled.error) {
        room?.broadcast?.({
          type: MESSAGE_TYPES.SYSTEM_MESSAGE,
          data: { message: `Bot ${bot.name} code error: ${this._compiled.error}` }
        })
      }
    } else {
      room?.broadcast?.({
        type: MESSAGE_TYPES.SYSTEM_MESSAGE,
        data: { message: `Bot ${bot.name} has no code yet — it will fold/check until you add some.` }
      })
    }
  }

  updateActivity() { this.lastActiveTime = Date.now() }
  setProfileAvatar() { return false }

  // Called by PokerRoom.broadcastGameState in lieu of a real ws.send.
  send(message) {
    if (this._destroyed) return
    if (!message || message.type !== MESSAGE_TYPES.GAME_STATE) return

    const state = message.data
    if (!state) return
    if (state.activePlayerId !== this.id) return
    if (state.phase === GAME_PHASES.WAITING || state.phase === GAME_PHASES.SHOWDOWN) return
    // Hard pause for arena spectators: when arenaRunning is false the bot
    // refuses to schedule a decision, so the active turn stalls until the
    // spectator presses Start again. PokerRoom.setArenaRunning re-broadcasts
    // game state on resume, which re-fires this branch.
    if (this.room?.isArena && this.room?.arenaRunning === false) return

    // Double-fire guard: each (phase, turnStartTimestamp) is decided once.
    const turnKey = `${state.phase}-${state.activeTurnStartedAt}`
    if (this._lastTurnKey === turnKey) return
    this._lastTurnKey = turnKey

    if (this._pendingTimeout) clearTimeout(this._pendingTimeout)
    const delay = THINK_DELAY_MIN_MS + Math.random() * (THINK_DELAY_MAX_MS - THINK_DELAY_MIN_MS)
    this._pendingTimeout = setTimeout(() => {
      this._pendingTimeout = null
      this._decideAndAct()
    }, delay)
  }

  // Cancel any queued decision and forget the last turn-key so the next
  // game_state broadcast will be treated as a fresh prompt. Used by arena
  // pause to halt action mid-hand cleanly.
  pauseImmediate() {
    if (this._pendingTimeout) {
      clearTimeout(this._pendingTimeout)
      this._pendingTimeout = null
    }
    this._lastTurnKey = null
  }

  _decideAndAct() {
    if (this._destroyed) return
    const game = this.room?.game
    if (!game) return
    if (game.phase === GAME_PHASES.WAITING || game.phase === GAME_PHASES.SHOWDOWN) return
    // Race guard: pause might land between scheduling and firing. Refuse
    // to act when the arena is paused so an in-flight timer can't sneak
    // through one more move.
    if (this.room?.isArena && this.room?.arenaRunning === false) return

    const seat = game.players[game.activeIndex]
    if (!seat || seat.id !== this.id) return // turn moved on while we were thinking

    let action = null
    let amount = 0
    let say = null

    try {
      if (this._compiled && !this._compiled.error) {
        const ctx = buildContext(game, this)
        const r = this._compiled.run(ctx)
        if (r.ok) {
          action = r.action
          amount = r.amount
          say = r.say || null
        } else if (r.error) {
          this.room?.broadcast?.({
            type: MESSAGE_TYPES.SYSTEM_MESSAGE,
            data: { message: `Bot ${this.username} runtime error: ${r.error}` }
          })
        }
      }
    } catch (err) {
      console.error('[bot] decision error:', err.message)
    }

    // No code, compile error, runtime error, or invalid return → safe default.
    const myBet = game.playerBets.get(this.id) || 0
    const toCall = game.currentBet - myBet
    if (!action) action = toCall > 0 ? 'fold' : 'check'

    // Translate impossible combinations into the closest legal action.
    if (action === 'check' && toCall > 0) action = 'call'
    if (action === 'call' && toCall <= 0) action = 'check'
    if (action === 'call' && toCall >= this.chips) action = 'all_in'

    const result = game.handleAction(this.id, action, amount)
    if (!result?.success) {
      const fallback = toCall > 0 ? 'fold' : 'check'
      game.handleAction(this.id, fallback, 0)
    } else if (say) {
      this.room?.broadcastBotYell?.(this, say)
    }
  }

  // Bots speak only via the optional `say` field on their decide() return.
  // Kept as no-ops so old call sites in PokerRoom (joined_table, left_table,
  // _cleanupBrokeBots) don't crash while we transition.
  emitPhrase() {}

  cancelPending() {
    if (this._pendingTimeout) {
      clearTimeout(this._pendingTimeout)
      this._pendingTimeout = null
    }
  }

  destroy() {
    this._destroyed = true
    this.cancelPending()
    if (this._compiled) {
      this._compiled.dispose()
      this._compiled = null
    }
  }

  toJSON() {
    return {
      id: this.id,
      username: this.username,
      avatarId: null,
      avatarUrl: null,
      chips: this.chips,
      pokerBuyIn: this.pokerBuyIn,
      isSpectator: false,
      isConnected: this.isConnected,
      isBot: true,
      botId: this.botId,
      botColor: this.botColor,
      botTextColor: this.botTextColor,
      botAvatarUrl: this.botAvatarUrl,
      addedByPlayerId: this.addedByPlayerId,
      ownerDisplayName: this.ownerDisplayName
    }
  }
}
