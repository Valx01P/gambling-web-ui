'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import PokerChip from '../components/PokerChip'
import CardSprite, { CARD_W, CARD_H, CARD_SCALE } from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

function ActionBadge({ action }) {
  if (!action || !action.action) return null
  const labels = {
    fold:   { text: 'FOLD',                   color: 'text-red-100 bg-red-800/90 border-red-600/50' },
    check:  { text: 'CHECK',                  color: 'text-white bg-zinc-600/90 border-zinc-400/50' },
    call:   { text: `CALL ${action.amount || ''}`.trim(),   color: 'text-emerald-100 bg-emerald-700/90 border-emerald-500/50' },
    raise:  { text: `RAISE ${action.amount || ''}`.trim(),  color: 'text-amber-100 bg-amber-700/90 border-amber-500/50' },
    all_in: { text: 'ALL IN',                 color: 'text-amber-100 bg-amber-600/90 border-amber-400/50' },
    sb:     { text: 'SB',                     color: 'text-white bg-zinc-600/90 border-zinc-400/50' },
    bb:     { text: 'BB',                     color: 'text-white bg-zinc-600/90 border-zinc-400/50' },
  }
  const info = labels[action.action]
  if (!info) return null
  return (
    <div className={`text-xs sm:text-sm font-bold px-2.5 py-1 rounded-md border ${info.color} whitespace-nowrap shadow-sm`}>
      {info.text}
    </div>
  )
}

function PhaseLabel({ phase }) {
  const map = {
    waiting:  'WAITING',
    preflop:  'PRE-FLOP',
    flop:     'FLOP',
    turn:     'TURN',
    river:    'RIVER',
    showdown: 'SHOWDOWN',
  }
  return (
    <span className="text-sm sm:text-base font-bold text-white tracking-wider bg-zinc-700/80 px-3 py-1.5 rounded-lg border border-zinc-500/50">
      {map[phase] || phase.toUpperCase()}
    </span>
  )
}

// Adjusted coordinates slightly outwards to accommodate 1.5x bigger cards
const SEATS = [
  { top: '88%', left: '50%' }, // Bottom Center (Me)
  { top: '50%', left: '10%' }, // Bottom Left
  { top: '15%', left: '18%' }, // Top Left
  { top: '8%',  left: '50%' }, // Top Center
  { top: '15%', left: '82%' }, // Top Right
  { top: '50%', left: '90%' }, // Bottom Right
]

// Determine where the chips go relative to the player so they land "on the table"
const getBetPosClasses = (posIndex) => {
  switch(posIndex) {
    case 0: return 'bottom-full mb-5 left-1/2 -translate-x-1/2'
    case 1: case 2: return 'left-full ml-6 top-1/2 -translate-y-1/2'
    case 3: return 'top-full mt-5 left-1/2 -translate-x-1/2'
    case 4: case 5: return 'right-full mr-6 top-1/2 -translate-y-1/2'
    default: return ''
  }
}

export default function PokerPage() {
  const wsRef = useRef(null)
  const chatEndRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [isSpectator, setIsSpectator] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [raiseAmount, setRaiseAmount] = useState(0)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sysMessages, setSysMessages] = useState([])

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, sysMessages])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => { setConnected(false); setJoined(false) }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'connect':
          setPlayerId(msg.data.playerId)
          setUsername(msg.data.username)
          break
        case 'join_game':
          setJoined(true)
          setIsSpectator(msg.data.isSpectator || false)
          setGameState(msg.data.gameState)
          break
        case 'leave_game':
          setJoined(false); setGameState(null)
          break
        case 'game_state':
          setGameState(msg.data)
          break
        case 'room_update':
          if (msg.data.gameState) setGameState(msg.data.gameState)
          break
        case 'spectator_update':
          setIsSpectator(true)
          if (msg.data.gameState) setGameState(msg.data.gameState)
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'showdown':
          if (msg.data.winners?.length) {
            const w = msg.data.winners[0]
            addSys(`Winner: ${w.playerId.substring(0, 6)} — ${w.handName}`)
          }
          break
        case 'chat':
          setChatMessages(prev => [...prev.slice(-50), msg.data])
          break
        case 'error':
          addSys(`Error: ${msg.data.message}`)
          break
      }
    }
    return () => ws.close()
  }, [addSys])

  function send(type, data = {}) {
    wsRef.current?.send(JSON.stringify({ type, data }))
  }
  function sendChat() {
    const text = chatInput.trim()
    if (!text) return
    send('chat', { message: text })
    setChatInput('')
  }
  function getOrderedPlayers() {
    if (!gameState?.players) return []
    const ps = gameState.players
    const mi = ps.findIndex((p) => p.id === playerId)
    if (mi <= 0) return ps
    return [...ps.slice(mi), ...ps.slice(0, mi)]
  }
  function getOriginalIndex(player) {
    return gameState?.players?.findIndex((p) => p.id === player.id) ?? -1
  }

  const orderedPlayers = getOrderedPlayers()
  const myPlayer = gameState?.players?.find((p) => p.id === playerId)
  const isMyTurn = gameState?.activePlayerId === playerId
  const myBet = myPlayer?.bet || 0
  const toCall = (gameState?.currentBet || 0) - myBet
  const phase = gameState?.phase || 'waiting'
  const minRaise = (gameState?.currentBet || 0) + 10

  if (!joined) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center gap-4 w-full max-w-72">
          <div className={`text-sm px-4 py-1.5 rounded-full font-bold ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>
          <input
            className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-lg px-4 py-3 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg"
            placeholder="Username (optional)"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && connected && send('join_game', { username: username || undefined })}
          />
          <button
            onClick={() => send('join_game', { username: username || undefined })}
            disabled={!connected}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3 rounded-lg text-base font-bold text-white transition-colors border border-zinc-500/50 shadow-lg"
          >
            Find Table
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] flex flex-col px-4 pt-4 max-w-7xl mx-auto relative overflow-hidden pb-64">
      
      {/* Top Header Row */}
      <div className="flex items-center justify-between mb-8 z-50">
        <div className="flex items-center gap-3">
          {isSpectator && (
            <span className="text-sm font-bold bg-zinc-700/80 text-white border border-zinc-500/50 px-3 py-1.5 rounded-lg shadow-sm">Spectating</span>
          )}
          <PhaseLabel phase={phase} />
        </div>
        <button onClick={() => send('leave_game')} className="text-sm font-bold text-white bg-zinc-700/80 hover:bg-zinc-600 px-4 py-2 rounded-lg border border-zinc-500/50 shadow-sm transition-colors">
          Leave Table
        </button>
      </div>

      {/* Main Table Area */}
      <div className="relative w-full aspect-[2.4/1] sm:aspect-[2.2/1] min-h-[400px] flex-shrink-0">
        <div
          className="absolute inset-[3%] sm:inset-[4%] rounded-[50%] border-4 border-emerald-900/40"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 50% 45%, #1a5c3a 0%, #14472c 45%, #0f3521 80%, #0a2a18 100%)',
            boxShadow: 'inset 0 2px 50px rgba(0,0,0,0.5), 0 0 100px rgba(0,0,0,0.4)',
          }}
        />

        {/* Pot positioned higher so it doesn't overlap cards */}
        <div className="absolute top-[18%] sm:top-[16%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-0">
          <PotChips amount={gameState?.pot || 0} />
          <div className="text-xs text-white/60 font-bold tracking-widest bg-black/30 px-2 py-0.5 rounded-md mt-1">POT</div>
          <div className="font-black text-2xl sm:text-3xl text-white drop-shadow-md">{gameState?.pot || 0}</div>
        </div>

        {/* Community Cards */}
        <div className="absolute top-[48%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1.5 sm:gap-2 z-0">
          {(gameState?.communityCards || []).map((card, i) => (
            <CardSprite key={i} card={card} />
          ))}
          {Array.from({ length: Math.max(0, 5 - (gameState?.communityCards?.length || 0)) }).map((_, i) => (
            <div key={`e-${i}`} className="border-2 border-white/[0.08] rounded-md" style={{ width: CARD_W * CARD_SCALE, height: CARD_H * CARD_SCALE, background: 'rgba(255,255,255,0.02)' }} />
          ))}
        </div>

        {/* Players */}
        {orderedPlayers.map((player, seatIndex) => {
          const pos = SEATS[seatIndex]
          if (!pos) return null
          const isMe = player.id === playerId
          const isActive = gameState?.activePlayerId === player.id
          const isDealer = getOriginalIndex(player) === gameState?.dealerIndex

          return (
            <div key={player.id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ top: pos.top, left: pos.left }}>
              
              {/* Bet Stack projected onto the table */}
              {player.lastAction && (
                <div className={`absolute flex flex-col items-center justify-center gap-1 z-20 ${getBetPosClasses(seatIndex)}`}>
                  <ActionBadge action={player.lastAction} />
                  {player.bet > 0 && <BetChips amount={player.bet} />}
                </div>
              )}

              {/* Stack / Info Box (Behind Cards) */}
              <div className="relative flex justify-center mt-6">
                <div className={`
                  absolute -top-10 left-1/2 -translate-x-1/2
                  px-3 py-1.5 rounded-lg text-center min-w-[120px] shadow-xl
                  transition-all border z-0
                  ${isMe ? 'bg-zinc-600/95 border-zinc-400/50' : 'bg-zinc-700/95 border-zinc-500/50'}
                  ${player.folded ? 'opacity-40' : ''}
                  ${isActive ? 'ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)]' : ''}
                `}>
                  {isActive && (
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-amber-400 text-sm animate-bounce">▼</div>
                  )}
                  <div className="text-sm font-bold truncate max-w-[110px] text-white">
                    {isMe ? 'You' : player.username}
                    {isDealer && <span className="ml-1 text-[10px] bg-amber-500 text-black px-1.5 py-0.5 rounded-sm">D</span>}
                  </div>
                  <div className="text-xs text-zinc-200 font-medium">{player.chips} chips</div>
                </div>

                {/* Player Cards (In front of Stack) */}
                <div className={`flex gap-1 z-10 relative ${player.folded ? 'opacity-40 grayscale' : ''}`}>
                  {(player.cards || []).map((card, ci) => (
                    <CardSprite key={ci} card={card} />
                  ))}
                </div>
              </div>

            </div>
          )
        })}
      </div>

      {/* Fixed Bottom UI overlay for Chat and Actions */}
      <div className="fixed bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none z-50">
        
        {/* Left Side: Actions */}
        <div className="pointer-events-auto w-full max-w-[300px]">
          {isMyTurn && !isSpectator && !myPlayer?.folded && phase !== 'waiting' && phase !== 'showdown' && (
            <div className="flex flex-col gap-4 py-4 px-5 bg-zinc-700/95 border border-zinc-500/50 rounded-xl shadow-2xl backdrop-blur-md">
              <div className="text-xs font-black text-amber-400 tracking-widest animate-pulse text-center">● YOUR TURN</div>
              
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => send('poker_fold')}
                  className="px-4 py-2.5 rounded-lg text-sm font-bold transition-all bg-zinc-600 hover:bg-zinc-500 border border-zinc-400/50 text-white shadow-sm active:scale-95">
                  Fold
                </button>
                {toCall === 0 ? (
                  <button onClick={() => send('poker_check')}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold transition-all bg-zinc-600 hover:bg-zinc-500 border border-zinc-400/50 text-white shadow-sm active:scale-95">
                    Check
                  </button>
                ) : (
                  <button onClick={() => send('poker_call')}
                    className="px-4 py-2.5 rounded-lg text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white shadow-sm active:scale-95">
                    Call {toCall}
                  </button>
                )}
                <button onClick={() => send('poker_all_in')}
                  className="col-span-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all bg-amber-600 hover:bg-amber-500 border border-amber-400/50 text-white shadow-sm active:scale-95">
                  All In
                </button>
              </div>

              <div className="flex items-center gap-3 w-full">
                <input type="range" min={minRaise} max={myPlayer?.chips || 100} step={5}
                  value={raiseAmount || minRaise} onChange={e => setRaiseAmount(parseInt(e.target.value))}
                  className="flex-1 accent-white h-1.5 bg-zinc-900 rounded-full" />
                <button onClick={() => send('poker_raise', { amount: raiseAmount || minRaise })}
                  className="px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap bg-zinc-600 hover:bg-zinc-500 border border-zinc-400/50 text-white shadow-sm active:scale-95">
                  Raise {raiseAmount || minRaise}
                </button>
              </div>
            </div>
          )}
          {!isMyTurn && !isSpectator && phase !== 'waiting' && phase !== 'showdown' && (
             <div className="py-3 px-4 bg-zinc-700/95 border border-zinc-500/50 rounded-xl shadow-2xl backdrop-blur-md text-center text-zinc-200 text-sm font-bold">
               Waiting for {gameState?.players?.find((p) => p.id === gameState.activePlayerId)?.username || '...'}
             </div>
          )}
          {phase === 'waiting' && !isSpectator && (
            <div className="py-3 px-4 bg-zinc-700/95 border border-zinc-500/50 rounded-xl shadow-2xl backdrop-blur-md text-center text-zinc-200 text-sm font-bold">
               Waiting for players...
            </div>
          )}
        </div>

        {/* Right Side: Chat */}
        <div className="pointer-events-auto w-full max-w-[300px] flex flex-col h-56 bg-zinc-700/95 border border-zinc-500/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {chatMessages.length === 0 && sysMessages.length === 0 && (
              <div className="text-xs text-zinc-300 italic">No messages...</div>
            )}
            {sysMessages.map((msg, i) => (
              <div key={`s-${i}`} className="text-xs text-zinc-300 italic font-medium">{msg}</div>
            ))}
            {chatMessages.map((msg, i) => (
              <div key={`c-${i}`} className="text-sm">
                <span className={`font-bold ${msg.playerId === playerId ? 'text-white' : 'text-zinc-300'}`}>
                  {msg.playerId === playerId ? 'You' : msg.username}:
                </span>
                <span className="text-zinc-100 ml-1.5">{msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex border-t border-zinc-500/50 bg-zinc-800/50">
            <input className="flex-1 bg-transparent px-4 py-3 text-sm text-white placeholder-zinc-400 outline-none"
              placeholder="Message..." value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()} maxLength={200} />
            <button onClick={sendChat} className="px-5 text-sm font-bold text-white hover:bg-zinc-600 transition-colors">Send</button>
          </div>
        </div>

      </div>
    </div>
  )
}