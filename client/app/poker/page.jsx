'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import PokerChip from '../components/PokerChip'
import CardSprite from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'

function ActionBadge({ action }) {
  if (!action || !action.action) return null
  const labels = {
    fold:   { bg: 'bg-red-800/90 border-red-600/50 text-red-100', defaultText: 'FOLD' },
    check:  { bg: 'bg-zinc-600/90 border-zinc-400/50 text-white', defaultText: 'CHECK' },
    call:   { bg: 'bg-emerald-700/90 border-emerald-500/50 text-emerald-100', defaultText: 'CALL' },
    raise:  { bg: 'bg-amber-700/90 border-amber-500/50 text-amber-100', defaultText: 'RAISE' },
    all_in: { bg: 'bg-amber-600/90 border-amber-400/50 text-amber-100', defaultText: 'ALL IN' },
    sb:     { bg: 'bg-zinc-800/95 border-zinc-600/50 text-zinc-200', defaultText: 'SB' },
    bb:     { bg: 'bg-zinc-800/95 border-zinc-600/50 text-zinc-200', defaultText: 'BB' },
  }
  const info = labels[action.action]
  if (!info) return null
  
  let text = action.text || info.defaultText
  if (action.amount > 0 && action.action !== 'sb' && action.action !== 'bb') {
    text += ` ${action.amount}`
  }

  return (
    <div className={`text-[10px] sm:text-xs font-bold px-2 py-0.5 sm:py-1 rounded-md border ${info.bg} whitespace-nowrap shadow-sm`}>
      {text}
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
    <span className="text-xs sm:text-sm font-bold text-white tracking-wider bg-zinc-700/80 px-3 py-1.5 rounded-lg border border-zinc-500/50">
      {map[phase] || phase.toUpperCase()}
    </span>
  )
}

const SEATS = [
  { top: '100%', left: '50%' }, // 0: Bottom Center (Me)
  { top: '65%', left: '5%' },   // 1: Bottom Left
  { top: '15%', left: '20%' },  // 2: Top Left (Pushed down to avoid header overlap)
  { top: '15%', left: '80%' },  // 3: Top Right (Pushed down to avoid header overlap)
  { top: '65%', left: '95%' },  // 4: Bottom Right
]

const getBetPosClasses = (posIndex) => {
  switch(posIndex) {
    case 0: return 'bottom-[105%] sm:bottom-[105%] left-1/2 -translate-x-1/2'
    case 1: case 2: return 'left-[105%] sm:left-[110%] top-1/2 -translate-y-1/2'
    case 3: case 4: return 'right-[105%] sm:right-[110%] top-1/2 -translate-y-1/2'
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
  const [showdownData, setShowdownData] = useState(null)
  const [raiseAmount, setRaiseAmount] = useState(0)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sysMessages, setSysMessages] = useState([])
  
  // New room feature states
  const [joinMode, setJoinMode] = useState('general') // 'general', 'create_private', 'join_private'
  const [inputCode, setInputCode] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [inviteCode, setInviteCode] = useState(null)

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, sysMessages])

  // Parse URL for invite code
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const codeParam = params.get('code')
      if (codeParam && codeParam.length === 5) {
        setJoinMode('join_private')
        setInputCode(codeParam.toUpperCase())
      }
    }
  }, [])

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
          setIsPrivate(msg.data.isPrivate || false)
          setInviteCode(msg.data.inviteCode || null)
          break
        case 'leave_game':
          setJoined(false); setGameState(null)
          setIsPrivate(false); setInviteCode(null)
          break
        case 'game_state':
          setGameState(msg.data)
          if (msg.data.phase !== 'showdown') {
            setShowdownData(null) 
          }
          break
        case 'room_update':
          if (msg.data.gameState) setGameState(msg.data.gameState)
          if (msg.data.isPrivate !== undefined) setIsPrivate(msg.data.isPrivate)
          if (msg.data.inviteCode !== undefined) setInviteCode(msg.data.inviteCode)
          break
        case 'spectator_update':
          setIsSpectator(true)
          if (msg.data.gameState) setGameState(msg.data.gameState)
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'system_message':
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'showdown':
          if (msg.data) {
            setShowdownData(msg.data)
            if (msg.data.winners?.length) {
              msg.data.winners.forEach(w => {
                const name = w.username || w.playerId.substring(0, 6);
                addSys(`Winner: ${name} (+${w.chips}) — ${w.handName}`)
              })
            }
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

  const copyInviteLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?code=${inviteCode}`;
    navigator.clipboard.writeText(url);
    addSys(`Invite link copied to clipboard!`);
  }

  const orderedPlayers = getOrderedPlayers()
  const myPlayer = gameState?.players?.find((p) => p.id === playerId)
  const isMyTurn = gameState?.activePlayerId === playerId
  const myBet = myPlayer?.bet || 0
  const currentBetAmount = gameState?.currentBet || 0
  const toCall = currentBetAmount - myBet
  const phase = gameState?.phase || 'waiting'
  const isWaitingNextHand = myPlayer?.waitingNextHand

  const minRaise = currentBetAmount === 0 ? 10 : currentBetAmount * 2

  const isWinningCard = (card, specificPlayerId = null) => {
    if (phase !== 'showdown' || !showdownData?.winners) return false
    if (!card) return false

    const winnersToCheck = specificPlayerId
      ? showdownData.winners.filter(w => w.playerId === specificPlayerId)
      : showdownData.winners

    return winnersToCheck.some(w =>
      w.winningCards?.some(wc => wc.suit === card.suit && wc.rank === card.rank)
    )
  }

  if (!joined) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center gap-5 w-full max-w-[380px]">
          <div className={`text-sm px-5 py-2 rounded-full font-bold ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>

          <div className="flex w-full bg-zinc-800/80 p-1.5 gap-1.5 rounded-xl border border-zinc-600/50 shadow-md">
             <button onClick={() => setJoinMode('general')} className={`flex-1 text-sm py-2.5 rounded-lg font-bold transition-all ${joinMode === 'general' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>General</button>
             <button onClick={() => setJoinMode('create_private')} className={`flex-1 text-sm py-2.5 rounded-lg font-bold transition-all ${joinMode === 'create_private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Create Private</button>
             <button onClick={() => setJoinMode('join_private')} className={`flex-1 text-sm py-2.5 rounded-lg font-bold transition-all ${joinMode === 'join_private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Join Private</button>
          </div>

          <input
            className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-xl px-4 py-3.5 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg"
            placeholder="Username (optional)"
            value={username}
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && connected && joinMode !== 'join_private' && send('join_game', { username: username || undefined, mode: joinMode })}
          />

          {joinMode === 'join_private' && (
            <input
               className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-xl px-4 py-3.5 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg uppercase tracking-widest font-black"
               placeholder="5-LETTER CODE"
               maxLength={5}
               value={inputCode}
               onChange={e => setInputCode(e.target.value.toUpperCase())}
               onKeyDown={e => e.key === 'Enter' && connected && inputCode.length === 5 && send('join_game', { username: username || undefined, mode: joinMode, code: inputCode })}
            />
          )}

          <button
            onClick={() => send('join_game', { username: username || undefined, mode: joinMode, code: joinMode === 'join_private' ? inputCode : undefined })}
            disabled={!connected || (joinMode === 'join_private' && inputCode.length !== 5)}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3.5 rounded-xl text-base font-bold text-white transition-colors border border-zinc-500/50 shadow-lg"
          >
            {joinMode === 'general' ? 'Find Table' : joinMode === 'create_private' ? 'Create Private Room' : 'Join Private Room'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">
      
      {/* Top Header Row */}
      <div className="flex items-center justify-between mb-3 sm:mb-4 z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {isSpectator && (
            <span className="text-xs sm:text-sm font-bold bg-zinc-700/80 text-white border border-zinc-500/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm">Spectating</span>
          )}
          <PhaseLabel phase={phase} />
          {isPrivate && inviteCode && (
             <button onClick={copyInviteLink} title="Click to copy invite link" className="text-xs sm:text-sm font-bold text-white bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors px-2 sm:px-3 py-1.5 rounded-lg border border-zinc-500/50 shadow-sm flex items-center gap-1.5 sm:gap-2 active:scale-95">
               <span className="text-zinc-400">CODE:</span>
               <span className="text-amber-400 tracking-widest">{inviteCode}</span>
             </button>
          )}
        </div>
        <button onClick={() => send('leave_game')} className="text-xs sm:text-sm font-bold text-white bg-zinc-700/80 hover:bg-zinc-600 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-zinc-500/50 shadow-sm transition-colors">
          Leave Table
        </button>
      </div>

      {/* Main Table Wrapper */}
      <div className="flex-1 flex flex-col justify-center relative w-full mb-4">
        
        <div className="relative w-full max-w-5xl mx-auto aspect-[1.1/1] sm:aspect-[1.8/1] md:aspect-[2.2/1] rounded-[50%] border-4 border-emerald-900/40 shrink-0 mt-10 sm:mt-6 mb-24 md:mb-24"
             style={{
               background: 'radial-gradient(ellipse 70% 60% at 50% 45%, #1a5c3a 0%, #14472c 45%, #0f3521 80%, #0a2a18 100%)',
               boxShadow: 'inset 0 2px 50px rgba(0,0,0,0.5), 0 0 100px rgba(0,0,0,0.4)',
             }}>

          {/* Pot */}
          <div className="absolute top-[12%] sm:top-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-0">
            <PotChips amount={gameState?.pot || 0} />
            <div className="text-[10px] sm:text-xs text-white/60 font-bold tracking-widest bg-black/30 px-2 py-0.5 rounded-md mt-1">POT</div>
            <div className="font-black text-2xl sm:text-3xl text-white drop-shadow-md">{gameState?.pot || 0}</div>
          </div>

          {/* Community Cards */}
          <div className="absolute top-[50%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1 sm:gap-2 z-0">
            {(gameState?.communityCards || []).map((card, i) => (
              <CardSprite key={i} card={card} highlight={isWinningCard(card)} className="w-[14vw] sm:w-[60px] md:w-[80px]" />
            ))}
            {Array.from({ length: Math.max(0, 5 - (gameState?.communityCards?.length || 0)) }).map((_, i) => (
              <div key={`e-${i}`} className="border border-white/[0.08] rounded-md w-[14vw] sm:w-[60px] md:w-[80px] aspect-[80/110]" style={{ background: 'rgba(255,255,255,0.02)' }} />
            ))}
          </div>

          {/* Players */}
          {orderedPlayers.map((player, seatIndex) => {
            const pos = SEATS[seatIndex]
            if (!pos) return null
            const isMe = player.id === playerId
            const isActive = gameState?.activePlayerId === player.id
            const isDealer = getOriginalIndex(player) === gameState?.dealerIndex
            const isPlayerWaiting = player.waitingNextHand

            const isWinner = phase === 'showdown' && showdownData?.winners?.some(w => w.playerId === player.id)
            const wonAmount = showdownData?.winners?.find(w => w.playerId === player.id)?.chips
            const handName = showdownData?.playerHandNames?.[player.id]

            return (
              <div key={player.id} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center" style={{ top: pos.top, left: pos.left }}>
                
                {/* Bet Stack projected into the table */}
                {player.lastAction && (
                  <div className={`absolute flex flex-col items-center justify-center gap-1 z-20 ${getBetPosClasses(seatIndex)}`}>
                    {player.bet > 0 && <BetChips amount={player.bet} />}
                    <ActionBadge action={player.lastAction} />
                  </div>
                )}

                {/* Info & Cards Wrapper */}
                <div className="relative flex flex-col items-center gap-1">
                  
                  {/* Dealer Button Badge */}
                  {isDealer && (
                    <div className="absolute -right-3 sm:-right-4 -top-2 w-4 h-4 sm:w-5 sm:h-5 bg-white rounded-full flex items-center justify-center text-black font-black text-[9px] sm:text-[10px] shadow-md border border-zinc-300 z-30">
                      D
                    </div>
                  )}

                  {/* Uniform Nameplate styling */}
                  <div className={`
                    px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-center min-w-[70px] sm:min-w-[100px] shadow-xl
                    transition-all border z-10 relative bg-zinc-800/95 border-zinc-600/50
                    ${player.folded && !isPlayerWaiting ? 'opacity-40' : ''}
                    ${isPlayerWaiting ? 'opacity-60' : ''}
                    ${isActive ? 'ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)]' : ''}
                  `}>
                    {isActive && (
                      <div className="absolute -top-4 sm:-top-5 left-1/2 -translate-x-1/2 text-amber-400 text-xs sm:text-sm animate-bounce">▼</div>
                    )}
                    <div className="text-[10px] sm:text-sm font-bold truncate max-w-[70px] sm:max-w-[100px] text-white">
                      {isMe ? 'You' : player.username}
                    </div>
                    <div className="text-[9px] sm:text-xs text-zinc-200 font-medium">
                      {isPlayerWaiting ? (
                        <span className="text-zinc-400 font-bold italic">Waiting...</span>
                      ) : phase === 'showdown' && handName && !player.folded ? (
                        <span className="text-amber-300 font-bold">{handName}</span>
                      ) : (
                        `${player.chips} chips`
                      )}
                    </div>
                  </div>

                  {/* Player Cards */}
                  {!isPlayerWaiting && (
                    <div className={`flex gap-0.5 sm:gap-1 z-20 relative ${player.folded ? 'opacity-40 grayscale' : ''}`}>
                      {(player.cards || []).map((card, ci) => (
                        <CardSprite 
                          key={ci} 
                          card={card} 
                          highlight={isWinningCard(card, player.id)}
                          className={isMe ? "w-[12vw] sm:w-[60px] md:w-[82px]" : "w-[9vw] sm:w-[45px] md:w-[60px]"} 
                        />
                      ))}
                    </div>
                  )}

                  {/* Winner Floating Text */}
                  {isWinner && (
                    <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-amber-400 font-black text-xs sm:text-sm whitespace-nowrap z-40 drop-shadow-[0_2px_4px_rgba(0,0,0,1)]">
                      WINNER +{wonAmount}
                    </div>
                  )}

                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Natural Flow Bottom UI */}
      <div className="w-full flex flex-col md:flex-row justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto pb-4 md:pb-0">
        
        {/* Actions Panel */}
        <div className="w-[92%] max-w-[320px] md:w-[260px] md:max-w-none shrink-0">
          {isMyTurn && !isSpectator && !myPlayer?.folded && phase !== 'waiting' && phase !== 'showdown' && (
            <div className="flex flex-col gap-2 py-3 px-4 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md">
              <div className="text-[9px] sm:text-[10px] font-black text-amber-400 tracking-widest animate-pulse text-center">● YOUR TURN</div>
              
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => send('poker_fold')}
                  className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95">
                  Fold
                </button>
                {toCall === 0 ? (
                  <button onClick={() => send('poker_check')}
                    className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95">
                    Check
                  </button>
                ) : (
                  <button onClick={() => send('poker_call')}
                    className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-50 border border-emerald-400/50 text-white shadow-sm active:scale-95">
                    Call {Math.min(toCall, myPlayer?.chips || 0)}
                  </button>
                )}
                <button onClick={() => send('poker_all_in')}
                  className="col-span-2 px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-amber-600 hover:bg-amber-500 border border-amber-400/50 text-white shadow-sm active:scale-95">
                  All In
                </button>
              </div>

              {/* Only show raise slider if the player has enough chips to legally raise */}
              {myPlayer?.chips > minRaise && (
                <div className="flex items-center gap-2 w-full mt-0.5">
                  <input type="range" min={minRaise} max={myPlayer?.chips || 100} step={5}
                    value={raiseAmount < minRaise ? minRaise : raiseAmount} onChange={e => setRaiseAmount(parseInt(e.target.value))}
                    className="flex-1 accent-white h-1 bg-zinc-900 rounded-full" />
                  <button onClick={() => send('poker_raise', { amount: raiseAmount < minRaise ? minRaise : raiseAmount })}
                    className="px-2 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95">
                    Raise {raiseAmount < minRaise ? minRaise : raiseAmount}
                  </button>
                </div>
              )}
            </div>
          )}
          {isWaitingNextHand && (
            <div className="py-2 sm:py-2.5 px-3 sm:px-4 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md text-center text-amber-300 text-xs sm:text-sm font-bold">
               Sitting out this hand. You will join the next round.
            </div>
          )}
          {!isMyTurn && !isSpectator && !isWaitingNextHand && phase !== 'waiting' && phase !== 'showdown' && (
             <div className="py-2 sm:py-2.5 px-3 sm:px-4 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md text-center text-zinc-200 text-xs sm:text-sm font-bold">
               Waiting for {gameState?.players?.find((p) => p.id === gameState.activePlayerId)?.username || '...'}
             </div>
          )}
          {phase === 'waiting' && !isSpectator && (
            <div className="py-2 sm:py-2.5 px-3 sm:px-4 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md text-center text-zinc-200 text-xs sm:text-sm font-bold">
               {gameState?.players?.length <= 1 ? "Waiting for others to join..." : "Waiting for players..."}
            </div>
          )}
        </div>

        {/* Chat Panel */}
        <div className="w-[92%] max-w-[320px] md:w-[280px] md:max-w-none flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {chatMessages.length === 0 && sysMessages.length === 0 && (
              <div className="text-xs text-zinc-600 italic">No messages...</div>
            )}
            {sysMessages.map((msg, i) => (
              <div key={`s-${i}`} className="text-xs text-zinc-600 italic font-medium">{msg}</div>
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
          <div className="flex border-t border-zinc-600/50 bg-zinc-900/50 shrink-0">
            <input className="flex-1 bg-transparent px-4 py-2.5 text-sm text-white placeholder-zinc-400 outline-none"
              placeholder="Message..." value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()} maxLength={200} />
            <button onClick={sendChat} className="px-4 text-sm font-bold text-white hover:bg-zinc-700 transition-colors">Send</button>
          </div>
        </div>

      </div>
    </div>
  )
}