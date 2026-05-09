import { WebSocketServer as WSServer } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import { PlayerManager } from '../players/PlayerManager.js'
import { RoomManager } from '../rooms/RoomManager.js'
import { MessageHandler } from './MessageHandler.js'
import { MESSAGE_TYPES, POKER_CONFIG } from '../config/constants.js'

export class WebSocketServer {
  constructor(httpServer) {
    this.wss = new WSServer({ server: httpServer })
    this.playerManager = new PlayerManager()
    this.roomManager = new RoomManager()
    this.messageHandler = new MessageHandler(this.playerManager, this.roomManager)
    this.init()
  }

  init() {
    this.wss.on('connection', (ws) => {
      const playerId = uuidv4()
      console.log(`Connected: ${playerId}`)

      const player = this.playerManager.addPlayer(playerId, ws)

      player.send({
        type: MESSAGE_TYPES.CONNECT,
        data: { playerId, username: player.username, chips: player.chips }
      })

      ws.on('message', (msg) => {
        this.messageHandler.handle(playerId, msg.toString())
      })

      ws.on('close', () => {
        console.log(`Disconnected: ${playerId}`)
        this.handleDisconnect(playerId)
      })

      ws.on('error', (err) => {
        console.error(`WS error ${playerId}:`, err.message)
        this.handleDisconnect(playerId)
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

    this.turnInactivityCheck = setInterval(() => {
      const now = Date.now()

      for (const room of this.roomManager.rooms.values()) {
        if (room.roomType !== 'poker') continue
        const game = room.game
        
        if (game.phase !== 'waiting' && game.phase !== 'showdown') {
          const activePlayerId = game.players[game.activeIndex]?.id
          
          if (activePlayerId && game.lastTurnChange && (now - game.lastTurnChange > POKER_CONFIG.TURN_LIMIT_MS)) {
            const player = this.playerManager.getPlayer(activePlayerId)
            
            if (player) {
              console.log(`Booting ${player.username} for turn inactivity.`)
              
              // Auto-check or fold the inactive player
              const toCall = game.currentBet - (game.playerBets.get(activePlayerId) || 0)
              game.handleAction(activePlayerId, toCall === 0 ? 'check' : 'fold')

              player.send({ type: 'error', data: { message: 'You were removed from the room for taking too long to act.' } })
              
              // Disconnect them from the room
              const result = this.roomManager.leaveGame(player)
              if (result.success) {
                player.send({ type: MESSAGE_TYPES.LEAVE_GAME, data: result })
              }
            }
          }
        }
      }
    }, 1000)
  }

  handleDisconnect(playerId) {
    const player = this.playerManager.getPlayer(playerId)
    if (!player) return
    player.isConnected = false
    this.roomManager.leaveGame(player)
    this.playerManager.deletePlayer(playerId)
  }

  close() {
    clearInterval(this.heartbeat)
    clearInterval(this.turnInactivityCheck)
    this.wss.close()
  }
}
