'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CardSprite from '../components/CardSprite'
import { BetChips } from '../components/ChipStack'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'
import HomeBackLink from '../components/HomeBackLink'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const USERNAME_STORAGE_KEY = 'poker_username'
const AVATAR_STORAGE_KEY = 'poker_avatar_id'

const SEATS = [
  { className: 'top-[79%] left-1/2' },
  { className: 'top-[66%] left-[28%]' },
  { className: 'top-[66%] left-[72%]' },
  { className: 'top-[50%] left-[18%]' },
  { className: 'top-[50%] left-[82%]' },
]

const MOBILE_SEATS_BY_COUNT = {
  1: ['top-[78%] left-1/2'],
  2: ['top-[80%] left-1/2', 'top-[58%] left-[18%]'],
  3: ['top-[80%] left-1/2', 'top-[62%] left-[17%]', 'top-[62%] left-[83%]'],
  4: ['top-[81%] left-1/2', 'top-[67%] left-[16%]', 'top-[54%] left-[84%]', 'top-[48%] left-[16%]'],
  5: ['top-[82%] left-1/2', 'top-[69%] left-[15%]', 'top-[69%] left-[85%]', 'top-[51%] left-[16%]', 'top-[51%] left-[84%]'],
}

function mobileSeatClass(totalPlayers, index) {
  return MOBILE_SEATS_BY_COUNT[Math.min(Math.max(totalPlayers, 1), 5)]?.[index] || ''
}

function handValue(cards = []) {
  let total = 0
  let aces = 0

  for (const card of cards) {
    if (!card) continue
    if (card.rank === 'A') {
      total += 11
      aces += 1
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10
    } else {
      total += Number(card.rank)
    }
  }

  while (total > 21 && aces > 0) {
    total -= 10
    aces -= 1
  }

  return total
}

function formatProfit(value = 0) {
  if (value > 0) return `+${value}`
  return String(value)
}

function resultLabel(result) {
  const labels = {
    win: 'WIN',
    lose: 'LOSE',
    push: 'PUSH',
    blackjack: 'BLACKJACK',
    surrender: 'SURRENDER',
    busted: 'BUST',
  }

  return labels[result] || ''
}

function BlackjackHand({ hand, active = false, compact = false }) {
  const cards = hand?.cards || []
  const value = hand?.value ?? handValue(cards)
  const status = resultLabel(hand?.result || hand?.status)
  const cardWidthClass = compact ? 'w-6 sm:w-8' : 'w-8 sm:w-10'

  return (
    <div className={`rounded-md border bg-zinc-900/80 px-1 py-1 shadow-xl sm:px-1.5 sm:py-1.5 ${active ? 'border-amber-300 ring-2 ring-amber-400/50' : 'border-zinc-600/50'}`}>
      <div className="mb-1 flex items-center justify-between gap-1 text-[7px] font-black uppercase tracking-widest sm:gap-2 sm:text-[8px]">
        <span className="text-zinc-500">Bet {hand?.bet || 0}</span>
        <span className={hand?.status === 'busted' || hand?.result === 'lose' ? 'text-red-300' : 'text-amber-200'}>
          {status || value}
        </span>
      </div>
      <div className="flex justify-center overflow-visible px-2">
        {cards.map((card, index) => (
          <CardSprite
            key={index}
            card={card}
            className={`${cardWidthClass} ${index > 0 ? '-ml-4 sm:-ml-5' : ''}`}
            style={{ zIndex: index + 1 }}
          />
        ))}
      </div>
      {hand?.doubled && (
        <div className="mt-1 text-center text-[7px] font-black uppercase tracking-widest text-blue-300 sm:text-[8px]">Doubled</div>
      )}
    </div>
  )
}

function DealerSpot({ dealer }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="rounded-lg border border-zinc-600/50 bg-zinc-900/80 px-3 py-1.5 text-center shadow-xl">
        <div className="text-xs font-black text-white">Dealer</div>
        <div className="text-[10px] font-bold text-zinc-400">
          {dealer?.hidden ? `${dealer?.value || 0}+` : dealer?.value || ''}
        </div>
      </div>
      <div className="flex justify-center gap-1.5">
        {(dealer?.cards || []).map((card, index) => (
          <CardSprite key={index} card={card} className="w-8 sm:w-10" />
        ))}
      </div>
    </div>
  )
}

function BettingChipPreview({ amount }) {
  return (
    <div className="relative h-10 w-9 overflow-hidden">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        <BetChips amount={amount} />
      </div>
    </div>
  )
}

function PlayerSeat({ player, isMe, activeHandId, emotes, fluid = false }) {
  const profit = player.profit || 0
  const profitClass = profit > 0 ? 'text-emerald-300' : profit < 0 ? 'text-red-300' : 'text-zinc-400'
  const hands = player.hands || []
  const hasSplitHands = hands.length > 1

  return (
    <div className={`relative z-30 flex flex-col items-center gap-1 ${fluid ? 'w-full min-w-0' : 'w-[108px] sm:w-[150px]'}`}>
      <div className={`grid w-full gap-1 ${hasSplitHands ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {hands.length > 0 ? hands.map((hand) => (
          <BlackjackHand key={hand.id} hand={hand} active={hand.id === activeHandId} compact={hasSplitHands} />
        )) : (
          <div className="rounded-md border border-zinc-600/40 bg-zinc-900/45 px-2 py-1.5 text-center text-[8px] font-black uppercase tracking-widest text-zinc-400 sm:py-3 sm:text-[9px]">
            {player.waitingNextRound ? 'Next hand' : 'No bet'}
          </div>
        )}
      </div>

      <div className="relative w-full rounded-lg border border-zinc-600/50 bg-zinc-800/95 px-1.5 py-1.5 text-center shadow-2xl sm:px-2.5 sm:py-2">
        <SeatEmotes emotes={emotes} className="absolute -top-3 -left-2 z-40" />
        <div className="flex items-center justify-center gap-1.5">
          <ProfileAvatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} className="h-5 w-5 shrink-0 sm:h-7 sm:w-7" />
          <div className="min-w-0 text-left">
            <div className="truncate text-[10px] font-black text-white sm:text-xs">{isMe ? 'You' : player.username}</div>
            <div className="text-[8px] font-bold text-zinc-300 sm:text-[10px]">{player.chips} chips</div>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-center gap-1 text-[7px] font-black uppercase tracking-wide sm:text-[9px]">
          <span className="text-zinc-500">Total profit</span>
          <span className={profitClass}>{formatProfit(profit)}</span>
        </div>
      </div>
    </div>
  )
}

export default function BlackjackPage() {
  const wsRef = useRef(null)
  const chatEndRef = useRef(null)
  const emoteTimersRef = useRef(new Map())
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [username, setUsername] = useState('')
  const [selectedAvatarId, setSelectedAvatarId] = useState('op1')
  const [joined, setJoined] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [betAmount, setBetAmount] = useState(25)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sysMessages, setSysMessages] = useState([])
  const [emoteEvents, setEmoteEvents] = useState([])

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  const clearEmotes = useCallback(() => {
    emoteTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    emoteTimersRef.current.clear()
    setEmoteEvents([])
  }, [])

  const addTableEmote = useCallback((event) => {
    if (!event?.playerId || !event?.emote) return
    const eventId = `${event.playerId}-${event.emoteId || Date.now()}`
    setEmoteEvents(prev => [...prev.slice(-18), { ...event, eventId }])
    const timerId = setTimeout(() => {
      setEmoteEvents(prev => prev.filter(e => e.eventId !== eventId))
      emoteTimersRef.current.delete(eventId)
    }, 1900)
    emoteTimersRef.current.set(eventId, timerId)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const savedUsername = window.localStorage.getItem(USERNAME_STORAGE_KEY)
    const savedAvatarId = window.localStorage.getItem(AVATAR_STORAGE_KEY)
    if (savedUsername) setUsername(savedUsername)
    if (savedAvatarId) setSelectedAvatarId(getProfileAvatar(savedAvatarId).id)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, sysMessages])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      setJoined(false)
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'connect':
          setPlayerId(msg.data.playerId)
          setUsername(prev => prev || msg.data.username)
          break
        case 'join_game':
          setJoined(true)
          setGameState(msg.data.gameState)
          clearEmotes()
          break
        case 'leave_game':
          setJoined(false)
          setGameState(null)
          clearEmotes()
          break
        case 'game_state':
          setGameState(msg.data)
          break
        case 'room_update':
          if (msg.data.gameState) setGameState(msg.data.gameState)
          break
        case 'player_emote':
          addTableEmote(msg.data)
          break
        case 'chat':
          setChatMessages(prev => [...prev.slice(-50), msg.data])
          break
        case 'system_message':
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'error':
          addSys(`Error: ${msg.data.message}`)
          break
      }
    }
    return () => {
      clearEmotes()
      ws.close()
    }
  }, [addSys, addTableEmote, clearEmotes])

  function send(type, data = {}) {
    wsRef.current?.send(JSON.stringify({ type, data }))
  }

  function persistUsername(nextUsername) {
    setUsername(nextUsername)
    if (typeof window === 'undefined') return
    const trimmed = nextUsername.trim()
    if (trimmed) window.localStorage.setItem(USERNAME_STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(USERNAME_STORAGE_KEY)
  }

  function selectAvatar(avatarId) {
    setSelectedAvatarId(avatarId)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AVATAR_STORAGE_KEY, avatarId)
    }
  }

  function joinBlackjack() {
    send('join_game', {
      game: 'blackjack',
      mode: 'general',
      username: username || undefined,
      avatarId: selectedAvatarId,
    })
  }

  function sendChat() {
    const text = chatInput.trim()
    if (!text) return
    send('chat', { message: text })
    setChatInput('')
  }

  function sendEmote(emote) {
    send('player_emote', { emote })
  }

  const orderedPlayers = useMemo(() => {
    const players = gameState?.players || []
    const myIndex = players.findIndex(player => player.id === playerId)
    if (myIndex <= 0) return players
    return [...players.slice(myIndex), ...players.slice(0, myIndex)]
  }, [gameState, playerId])

  const myPlayer = gameState?.players?.find(player => player.id === playerId)
  const myHand = myPlayer?.hands?.find(hand => hand.id === gameState?.currentHandId)
  const phase = gameState?.phase || 'waiting'
  const hasBet = Boolean(myPlayer?.hands?.length)
  const canBet = joined && phase === 'betting' && myPlayer && !myPlayer.waitingNextRound && !hasBet
  const isMyTurn = gameState?.currentPlayerId === playerId && myHand?.canAct
  const minBet = gameState?.minBet || 10
  const maxBet = myPlayer?.chips || 0
  const clampedBet = Math.min(Math.max(betAmount, minBet), Math.max(minBet, maxBet))

  if (!joined) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10">
        <HomeBackLink className="absolute right-4 top-4" />
        <div className="flex w-full max-w-[620px] flex-col items-center gap-6">
          <div className={`text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>

          <ProfileSelector value={selectedAvatarId} onChange={selectAvatar} />

          <input
            className="w-full rounded-xl border border-zinc-500/50 bg-zinc-800/90 px-5 py-4 text-center text-base text-white shadow-lg outline-none placeholder-zinc-400 focus:border-zinc-300"
            placeholder="Username (optional)"
            value={username}
            onChange={event => persistUsername(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && connected && joinBlackjack()}
          />

          <button
            onClick={joinBlackjack}
            disabled={!connected}
            className="w-full rounded-xl border border-zinc-500/50 bg-zinc-700 py-4 text-base font-bold text-white shadow-lg transition-colors hover:bg-zinc-600 disabled:opacity-50"
          >
            Find Blackjack Table
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-zinc-500/50 bg-zinc-700/80 px-3 py-1.5 text-xs sm:text-sm font-bold tracking-wider text-white">
            BLACKJACK
          </span>
          <span className="rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-3 py-1.5 text-xs sm:text-sm font-bold text-zinc-200">
            {phase.toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <HomeBackLink />
          <button onClick={() => send('leave_game')} className="rounded-lg border border-zinc-500/50 bg-zinc-700/80 px-3 py-1.5 text-xs sm:text-sm font-bold text-white shadow-sm transition-colors hover:bg-zinc-600">
            Leave Table
          </button>
        </div>
      </div>

      <div className="relative mb-3 flex flex-col sm:flex-1 sm:justify-center">
        <div
          className="relative mx-auto h-[460px] w-full max-w-[430px] overflow-visible sm:hidden"
        >
          <div
            className="absolute inset-0 z-0 rounded-[50%] border-4 border-emerald-900/40 shadow-2xl"
            style={{
              background: 'radial-gradient(ellipse 74% 58% at 50% 44%, #155d3b 0%, #0f422a 52%, #092818 100%)',
              boxShadow: 'inset 0 2px 46px rgba(0,0,0,0.58), 0 0 76px rgba(0,0,0,0.32)',
            }}
          />
          <div className="absolute left-1/2 top-[7%] z-20 -translate-x-1/2">
            <DealerSpot dealer={gameState?.dealer} />
          </div>

          {orderedPlayers.map((player, index) => {
            const seatClass = mobileSeatClass(orderedPlayers.length, index)
            if (!seatClass) return null
            const playerEmotes = emoteEvents.filter(event => event.playerId === player.id)

            return (
              <div
                key={player.id}
                className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 ${seatClass}`}
              >
                <PlayerSeat
                  player={player}
                  isMe={player.id === playerId}
                  activeHandId={gameState?.currentHandId}
                  emotes={playerEmotes}
                />
              </div>
            )
          })}
        </div>

        <div className="relative mx-auto mt-1 hidden w-full max-w-6xl rounded-[42%] border-4 border-emerald-900/40 sm:block sm:aspect-[1.65/1] sm:min-h-[440px] md:aspect-[2.05/1] md:min-h-[500px]"
             style={{
               background: 'radial-gradient(ellipse 72% 58% at 50% 44%, #155d3b 0%, #0f422a 48%, #092818 100%)',
               boxShadow: 'inset 0 2px 50px rgba(0,0,0,0.55), 0 0 100px rgba(0,0,0,0.35)',
             }}>
          <div className="absolute top-[6%] left-1/2 flex -translate-x-1/2 flex-col items-center">
            <DealerSpot dealer={gameState?.dealer} />
          </div>

          {orderedPlayers.map((player, index) => {
            const pos = SEATS[index]
            if (!pos) return null
            const playerEmotes = emoteEvents.filter(event => event.playerId === player.id)

            return (
              <div
                key={player.id}
                className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 ${pos.className}`}
              >
                <PlayerSeat
                  player={player}
                  isMe={player.id === playerId}
                  activeHandId={gameState?.currentHandId}
                  emotes={playerEmotes}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="w-full flex flex-col md:flex-row justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto pb-4 md:pb-0">
        <div className="w-[92%] max-w-[360px] md:w-[360px] md:max-w-none shrink-0">
          {canBet && (
            <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 shadow-2xl backdrop-blur-md">
              <div className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-amber-300">Place Bet</div>
              <div className="mb-2 flex h-12 items-end justify-center gap-2 overflow-hidden">
                <BettingChipPreview amount={clampedBet} />
                <div className="text-xl font-black text-white">{clampedBet}</div>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <span>Min {minBet}</span>
                <button
                  type="button"
                  onClick={() => setBetAmount(maxBet)}
                  disabled={maxBet < minBet}
                  className="rounded border border-zinc-500/50 px-2 py-0.5 text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  Max stack {maxBet}
                </button>
              </div>
              <input
                type="range"
                min={minBet}
                max={Math.max(minBet, maxBet)}
                step={5}
                value={clampedBet}
                onChange={event => setBetAmount(Number(event.target.value))}
                className="mb-3 w-full accent-white"
              />
              <button
                onClick={() => send('blackjack_bet', { amount: clampedBet })}
                disabled={maxBet < minBet}
                className="w-full rounded-md border border-amber-400/50 bg-amber-600 px-3 py-2 text-sm font-black text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
              >
                Deal {clampedBet}
              </button>
            </div>
          )}

          {!canBet && !isMyTurn && (
            <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 text-center text-xs sm:text-sm font-bold text-zinc-200 shadow-2xl backdrop-blur-md">
              {myPlayer?.waitingNextRound ? 'Seated - entering next hand.' : phase === 'betting' ? 'Waiting for bets...' : phase === 'settle' ? 'Settling hands...' : gameState?.currentPlayerId ? 'Waiting for player action...' : 'Dealer is playing...'}
            </div>
          )}

          {isMyTurn && (
            <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 shadow-2xl backdrop-blur-md">
              <div className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-amber-300">Your Hand</div>
              <div className="grid grid-cols-2 gap-1.5">
                <button onClick={() => send('blackjack_hit')} className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-600">Hit</button>
                <button onClick={() => send('blackjack_stand')} className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-zinc-600">Stand</button>
                <button
                  onClick={() => send('blackjack_double')}
                  disabled={!myHand?.canDouble || (myPlayer?.chips || 0) < (myHand?.bet || 0)}
                  className="rounded-md border border-blue-400/50 bg-blue-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-40"
                >
                  Double
                </button>
                <button
                  onClick={() => send('blackjack_split')}
                  disabled={!myHand?.canSplit || (myPlayer?.chips || 0) < (myHand?.bet || 0) || (myPlayer?.hands?.length || 0) >= 2}
                  className="rounded-md border border-emerald-400/50 bg-emerald-700 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-40"
                >
                  Split
                </button>
                <button
                  onClick={() => send('blackjack_surrender')}
                  disabled={!myHand?.canSurrender}
                  className="col-span-2 rounded-md border border-red-500/50 bg-red-800 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
                >
                  Surrender
                </button>
              </div>
            </div>
          )}

          <div className="mt-2 grid grid-cols-5 gap-1.5 rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-2 py-2 shadow-2xl backdrop-blur-md">
            {EMOTE_OPTIONS.map((emote) => (
              <button
                key={emote.id}
                type="button"
                title={emote.label}
                aria-label={emote.label}
                onClick={() => sendEmote(emote.id)}
                className="flex h-10 items-center justify-center rounded-md border border-zinc-500/50 bg-zinc-700 text-zinc-200 transition-all hover:bg-zinc-600 active:scale-95"
              >
                <EmoteIcon emote={emote.id} />
              </button>
            ))}
          </div>
        </div>

        <div className="w-[92%] max-w-[320px] md:w-[300px] md:max-w-none flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
            {chatMessages.length === 0 && sysMessages.length === 0 && (
              <div className="text-xs text-zinc-600 italic">No messages...</div>
            )}
            {sysMessages.map((msg, index) => (
              <div key={`s-${index}`} className="text-xs text-zinc-600 italic font-medium">{msg}</div>
            ))}
            {chatMessages.map((msg, index) => (
              <div key={`c-${index}`} className="text-sm">
                <span className={`font-bold ${msg.playerId === playerId ? 'text-white' : 'text-zinc-300'}`}>
                  {msg.playerId === playerId ? 'You' : msg.username}:
                </span>
                <span className="ml-1.5 text-zinc-100">{msg.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className="flex shrink-0 border-t border-zinc-600/50 bg-zinc-900/50">
            <input
              className="flex-1 bg-transparent px-4 py-2.5 text-sm text-white outline-none placeholder-zinc-400"
              placeholder="Message..."
              value={chatInput}
              onChange={event => setChatInput(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && sendChat()}
              maxLength={200}
            />
            <button onClick={sendChat} className="px-4 text-sm font-bold text-white transition-colors hover:bg-zinc-700">Send</button>
          </div>
        </div>
      </div>
    </div>
  )
}
