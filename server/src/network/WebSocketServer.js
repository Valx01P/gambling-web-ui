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

      const player = this.playerManager.addPlayer(playerId, ws)

      player.send({
        type: MESSAGE_TYPES.CONNECT,
        data: { playerId, username: player.username, chips: player.chips }
      })

      ws.on('message', (msg) => {
        // Cheap size guard up front — drops oversized frames before parse.
        if (msg.length > MAX_MESSAGE_BYTES) {
          player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Message too large.' } })
          return
        }

        // Refill the bucket then spend a token.
        const bucket = ws._tokenBucket
        const now = Date.now()
        const elapsedSec = (now - bucket.lastRefill) / 1000
        if (elapsedSec > 0) {
          bucket.tokens = Math.min(MAX_MESSAGE_BURST, bucket.tokens + elapsedSec * REFILL_PER_SEC)
          bucket.lastRefill = now
        }
        if (bucket.tokens < 1) {
          player.send({ type: MESSAGE_TYPES.ERROR, data: { message: 'Slow down — rate limited.' } })
          return
        }
        bucket.tokens -= 1

        this.messageHandler.handle(playerId, msg.toString())
      })

      // Guard against close + error firing back-to-back on the same socket.
      let cleaned = false
      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        this._ipDec(ip)
        this.handleDisconnect(playerId)
      }

      ws.on('close', () => {
        console.log(`Disconnected: ${playerId}`)
        cleanup()
      })

      ws.on('error', (err) => {
        console.error(`WS error ${playerId}:`, err.message)
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
    player.isConnected = false
    // Drop this WS from the presence registry first so any in-flight
    // "is this user online?" lookups stop counting the dead socket.
    untrackPresence(playerId)
    this.roomManager.leaveGame(player)
    this.playerManager.deletePlayer(playerId)
  }

  close() {
    clearInterval(this.heartbeat)
    this.wss.close()
  }
}
