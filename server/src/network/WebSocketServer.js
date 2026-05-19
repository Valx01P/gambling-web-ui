import { WebSocketServer as WSServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import { PlayerManager } from '../players/PlayerManager.js'
import { RoomManager } from '../rooms/RoomManager.js'
import { MessageHandler } from './MessageHandler.js'
import { MESSAGE_TYPES } from '../config/constants.js'
import { untrack as untrackPresence } from '../users/presence.js'
import { configureDispatcher } from '../notifications/dispatcher.js'

// Per-IP connection cap. Caps how many concurrent WS clients one source can
// hold open. Set generously (8) so a household behind one NAT or a power
// user with multiple tabs isn't penalized, but enough that a bot can't
// burn our slot pool. Tracked as an in-memory Map<ip, count>.
const MAX_CONNECTIONS_PER_IP = Number(process.env.WS_MAX_CONNECTIONS_PER_IP) || 8

// Per-socket message rate limit. The WS protocol is bidirectional and many
// of our message types do real work (DB writes, broadcasts), so a hostile
// client could flood us with chat or action messages. Token-bucket: every
// socket gets MAX_MESSAGE_BURST tokens, refilled at REFILL_PER_SEC.
const MAX_MESSAGE_BURST = Number(process.env.WS_MSG_BURST) || 30
const REFILL_PER_SEC = Number(process.env.WS_MSG_REFILL_PER_SEC) || 10

// Casino actions get their OWN dedicated token bucket per socket so spam-
// fire on slots / craps / lottery can't starve the main bucket and the
// main bucket's small ceiling can't gate the casino. The slot UI
// explicitly supports hold-Space spam, and casino actions are stateless
// on the server (each spin is a quick rand + payout calc + bank update,
// no DB write, no cross-player state) — so a generous cap is safe.
//
// 200 burst / 100/sec sustained leaves plenty of headroom over the OS
// key-repeat rate (~30/sec on most setups, up to ~60/sec on aggressive
// keyboards) so the user can't trip this in normal play. A malicious
// client still can't truly DoS the engine: 100 spins/sec × 8 sockets
// per IP = 800/sec max from one source, well inside what the engine can
// chew. Casino message types skip the main bucket entirely.
const CASINO_MESSAGE_TYPES = new Set([
  'casino:slots:spin',
  'casino:craps:roll',
  'casino:lottery:buy',
])
const CASINO_BURST = Number(process.env.WS_CASINO_BURST) || 200
const CASINO_REFILL_PER_SEC = Number(process.env.WS_CASINO_REFILL_PER_SEC) || 100

// Per-message size cap. The handler accepts ~4KB messages comfortably; the
// real limits per type live downstream (chat trims to 200 chars, etc.), but
// the JSON.parse + dispatch costs scale with input size. Anything past 4KB
// gets dropped at the socket boundary.
const MAX_MESSAGE_BYTES = 4096

export class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WSServer({
      server: httpServer,
      // permessage-deflate. Game-state messages are repetitive (player ids,
      // recurring keys, mostly numeric values) and compress 60-80%. We keep
      // the zlib levels modest so the per-message CPU cost stays small —
      // serverNoContextTakeover means each message compresses independently,
      // which trades a bit of ratio for predictable memory usage under many
      // concurrent clients.
      perMessageDeflate: {
        zlibDeflateOptions: { level: 3, memLevel: 7 },
        zlibInflateOptions: { chunkSize: 10 * 1024 },
        serverNoContextTakeover: true,
        clientNoContextTakeover: true,
        threshold: 1024  // skip compression for tiny messages
      },
      // Drop oversized frames at the protocol boundary. Belt-and-suspenders
      // with the per-message MAX_MESSAGE_BYTES check inside handle().
      maxPayload: MAX_MESSAGE_BYTES * 4
    })
    this.playerManager = new PlayerManager()
    // Hand the playerManager to the notifications/DMs push dispatcher so
    // feature code can fire live updates without owning a back-channel
    // to the WS server. Module-level singleton on purpose.
    configureDispatcher(this.playerManager)
    this.roomManager = new RoomManager({
      onTurnTimeout: (room, playerId) => this._handleTurnTimeout(room, playerId)
    })
    // When a player's grace window elapses without a reconnect, do the
    // terminal teardown the old handleDisconnect used to do synchronously.
    this.playerManager.setOnGraceExpire((playerId) => this._finalizeDisconnect(playerId))
    this.messageHandler = new MessageHandler(this.playerManager, this.roomManager)
    // Concurrency tracking per source IP.
    this._connectionsByIp = new Map()
    this.init()
  }

  _ipFromRequest(req) {
    // Behind Render's edge proxy `trust proxy` is set on Express; the WS
    // handshake `req.socket.remoteAddress` will be the proxy. We prefer
    // X-Forwarded-For when present so the cap reflects the real source.
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string' && xff.length > 0) {
      return xff.split(',')[0].trim()
    }
    return req.socket?.remoteAddress || 'unknown'
  }

  _ipCount(ip) {
    return this._connectionsByIp.get(ip) || 0
  }
  _ipInc(ip) {
    this._connectionsByIp.set(ip, this._ipCount(ip) + 1)
  }
  _ipDec(ip) {
    const next = this._ipCount(ip) - 1
    if (next <= 0) this._connectionsByIp.delete(ip)
    else this._connectionsByIp.set(ip, next)
  }

  // Replaces the old 1-second global polling sweep. Fires exactly when a
  // seated player's turn limit elapses; bots get force-folded in place,
  // humans get force-folded + booted with an explanatory error.
  //
  // 2026-05: third branch added for disconnected-but-in-grace players.
  // They've lost their socket but we're holding their seat until grace
  // expires. If their turn comes up during that window, auto-act in
  // place (check when free, fold only when facing a bet) without
  // booting — the seat must still be theirs when they reconnect.
  _handleTurnTimeout(room, playerId) {
    if (!room || room.isArena) return
    const game = room.game
    if (game.phase === 'waiting' || game.phase === 'showdown') return
    const seated = room.players.get(playerId)
    const player = this.playerManager.getPlayer(playerId)
    const toCall = game.currentBet - (game.playerBets.get(playerId) || 0)
    const fallback = toCall === 0 ? 'check' : 'fold'

    // Stuck bot — auto-act but keep it seated; cancelPending so a late
    // decision can't race the forced action.
    if (!player && seated?.isBot) {
      console.log(`[bot] timing out stuck bot ${seated.username}`)
      try { seated.cancelPending?.() } catch {}
      game.handleAction(playerId, fallback)
      return
    }

    // Disconnected human in the grace window: auto-act WITHOUT booting.
    // The seat stays held; the action just keeps the game flowing.
    if (player && this.playerManager.isInGrace(playerId)) {
      console.log(`[ws] auto-acting for disconnected ${player.username} (${fallback})`)
      game.handleAction(playerId, fallback)
      return
    }

    if (player) {
      console.log(`Booting ${player.username} for turn inactivity.`)
      game.handleAction(playerId, fallback)
      player.send({ type: 'error', data: { message: 'You were removed from the room for taking too long to act.' } })
      const result = this.roomManager.leaveGame(player)
      if (result.success) {
        player.send({ type: MESSAGE_TYPES.LEAVE_GAME, data: result })
      }
    }
  }

  init() {
    this.wss.on('connection', (ws, req) => {
      const ip = this._ipFromRequest(req)
      if (this._ipCount(ip) >= MAX_CONNECTIONS_PER_IP) {
        // Reject before allocating any player state. 1013 = "Try Again
        // Later" — semantically right for a transient overload.
        try { ws.close(1013, 'too_many_connections') } catch {}
        console.warn(`[ws] connection cap hit for ${ip}`)
        return
      }
      this._ipInc(ip)

      const playerId = uuidv4()
      console.log(`Connected: ${playerId}`)

      // Token-bucket rate limiter scoped to this socket. Refills based on
      // wall-clock so a long idle period doesn't lose tokens.
      ws._tokenBucket = {
        tokens: MAX_MESSAGE_BURST,
        lastRefill: Date.now()
      }
      // Separate, much larger bucket for casino spam. See CASINO_BURST
      // / CASINO_REFILL_PER_SEC comments above for sizing rationale.
      ws._casinoBucket = {
        tokens: CASINO_BURST,
        lastRefill: Date.now()
      }

      const player = this.playerManager.addPlayer(playerId, ws)

      player.send({
        type: MESSAGE_TYPES.CONNECT,
        // sessionToken is the client's ticket back to this exact seat
        // after a reload/network drop. Persisted to localStorage and
        // replayed via the RECONNECT message. Rotates on every successful
        // reconnect, so a leaked token is single-use.
        data: {
          playerId,
          username: player.username,
          chips: player.chips,
          sessionToken: player.sessionToken
        }
      })

      ws.on('message', (msg) => {
        // Cheap size guard up front — drops oversized frames before parse.
        if (msg.length > MAX_MESSAGE_BYTES) {
          player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Message too large.' } })
          return
        }

        // Parse once up front so we can route to the right bucket by
        // message type before charging tokens. Re-parse inside the handler
        // would be wasted work; we hand the parsed payload through.
        const msgStr = msg.toString()
        let parsed
        try { parsed = JSON.parse(msgStr) }
        catch {
          player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Malformed message.' } })
          return
        }

        // Pick the right bucket. Casino messages get their own dedicated
        // bucket sized for spam-fire; everything else shares the global
        // bucket whose tight ceiling is what protects against chat /
        // trade / poker action floods.
        const now = Date.now()
        const isCasino = CASINO_MESSAGE_TYPES.has(parsed?.type)
        const bucket = isCasino ? ws._casinoBucket : ws._tokenBucket
        const burst = isCasino ? CASINO_BURST : MAX_MESSAGE_BURST
        const refill = isCasino ? CASINO_REFILL_PER_SEC : REFILL_PER_SEC

        // Refill then spend. elapsedSec is capped at the time needed to
        // fully top up the bucket — without this, a client idle for
        // hours/days then sending one frame would multiply a huge
        // elapsed value by refill before Math.min clamps.
        const rawElapsedSec = (now - bucket.lastRefill) / 1000
        const maxRefillSec = burst / refill
        const elapsedSec = rawElapsedSec > maxRefillSec ? maxRefillSec : rawElapsedSec
        if (elapsedSec > 0) {
          bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * refill)
          bucket.lastRefill = now
        }
        if (bucket.tokens < 1) {
          // Casino overflows are silenced on the client (by `code` AND by
          // message-text fallback for old-client compatibility). Other
          // types still surface the toast — chat / trade flood feedback
          // is real "you're doing something wrong" UX.
          if (!isCasino) {
            player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Slow down — rate limited.', code: 'rate_limited' } })
          }
          // Casino: drop the message silently. The user is mashing Space
          // past the engine's already-generous spam ceiling; the engine
          // simply won't fire that one spin. No error noise, no animation,
          // bank balance just doesn't move for that beat.
          return
        }
        bucket.tokens -= 1

        // After a successful RECONNECT, the WS's owning playerId changes
        // from the placeholder issued at connect-time to the player we
        // re-attached. Honor that here so every subsequent message routes
        // to the right Player. The reattach handler sets this on the WS
        // itself, not on a per-message basis.
        const activePlayerId = ws._reattachedPlayerId || playerId
        // Pass the pre-parsed payload so handle() doesn't JSON.parse the
        // string a second time. handle() falls back to parsing the string
        // if `parsed` is omitted (preserves the old call signature for
        // anything that still calls it without it).
        this.messageHandler.handle(activePlayerId, msgStr, parsed)
      })

      // Guard against close + error firing back-to-back on the same socket.
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        this._ipDec(ip)
        // If the WS was re-attached via RECONNECT, the placeholder Player
        // has already been deleted — handleDisconnect should target the
        // current owner of this socket, not the original placeholder id.
        const activeId = ws._reattachedPlayerId || playerId
        this.handleDisconnect(activeId)
      }

      ws.on('close', () => {
        const activeId = ws._reattachedPlayerId || playerId
        console.log(`Disconnected: ${activeId}`)
        cleanup()
      })

      ws.on('error', (err) => {
        const activeId = ws._reattachedPlayerId || playerId
        console.error(`WS error ${activeId}:`, err.message)
        cleanup()
      })

      ws.isAlive = true
      ws.on('pong', () => { ws.isAlive = true })
    })

    // Heartbeat
    this.heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate()
        ws.isAlive = false
        ws.ping()
      })
    }, 30000)
    // Turn inactivity is now event-driven via PokerGame's per-turn setTimeout.
    // No more 1-second polling across every room.
  }

  handleDisconnect(playerId) {
    const player = this.playerManager.getPlayer(playerId)
    if (!player) return
    // Begin the grace window: don't tear the player down immediately, give
    // the client a chance to reconnect via the RECONNECT message and pick
    // up exactly where they left off. PlayerManager handles the timer and
    // calls _finalizeDisconnect if grace expires.
    //
    // Why not start grace for spectators? They have no seat to hold, no
    // pending action, and adding/removing them is cheap. Falling through
    // to the immediate teardown for them avoids carrying ghost spectators
    // in every room snapshot for 45s after they tab away.
    if (player.isSpectator || !player.currentRoom) {
      this._finalizeDisconnect(playerId)
      return
    }
    player.isConnected = false
    this.playerManager.beginGrace(playerId)
    // Tell the room so seated players' UIs can show "(reconnecting…)" on
    // the affected seat. The seat is NOT released — PokerRoom keeps the
    // chips, hole cards, and bet state intact for the grace window.
    try {
      const room = this.roomManager.getPlayerRoom(player)
      if (room?.broadcastDisconnect) {
        room.broadcastDisconnect(playerId)
      } else if (room?.broadcast) {
        room.broadcast({
          type: MESSAGE_TYPES.PLAYER_DISCONNECTED,
          data: { playerId, graceExpiresAt: player.graceExpiresAt }
        })
      }
    } catch (err) {
      console.warn('[ws] disconnect broadcast failed:', err.message)
    }
  }

  // Called either: (a) immediately, for spectators / players not in a
  // room, or (b) from PlayerManager after the grace window expires
  // without a RECONNECT.
  _finalizeDisconnect(playerId) {
    const player = this.playerManager.getPlayer(playerId)
    if (!player) return
    player.isConnected = false
    untrackPresence(playerId)
    this.roomManager.leaveGame(player)
    this.playerManager.deletePlayer(playerId)
  }

  close() {
    clearInterval(this.heartbeat)
    this.wss.close()
  }
}
