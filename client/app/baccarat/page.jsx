'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CardSprite from '../components/CardSprite'
import { BetChips } from '../components/ChipStack'
import HomeBackLink from '../components/HomeBackLink'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const USERNAME_STORAGE_KEY = 'poker_username'
const AVATAR_STORAGE_KEY = 'poker_avatar_id'

const DESKTOP_SEATS = [
  'top-[80%] left-1/2',
  'top-[67%] left-[24%]',
  'top-[67%] left-[76%]',
  'top-[50%] left-[16%]',
  'top-[50%] left-[84%]',
]

const MOBILE_SEATS_BY_COUNT = {
  1: ['top-[79%] left-1/2'],
  2: ['top-[80%] left-1/2', 'top-[60%] left-[18%]'],
  3: ['top-[80%] left-1/2', 'top-[62%] left-[17%]', 'top-[62%] left-[83%]'],
  4: ['top-[81%] left-1/2', 'top-[67%] left-[16%]', 'top-[55%] left-[84%]', 'top-[50%] left-[16%]'],
  5: ['top-[82%] left-1/2', 'top-[70%] left-[15%]', 'top-[70%] left-[85%]', 'top-[53%] left-[16%]', 'top-[53%] left-[84%]'],
}

const BET_OPTIONS = [
  { id: 'player', label: 'Player', color: 'border-blue-400/50 bg-blue-700 text-blue-50' },
  { id: 'banker', label: 'Banker', color: 'border-red-400/50 bg-red-800 text-red-50' },
  { id: 'tie', label: 'Tie', color: 'border-amber-400/50 bg-amber-700 text-amber-50' },
]

function mobileSeatClass(totalPlayers, index) {
  return MOBILE_SEATS_BY_COUNT[Math.min(Math.max(totalPlayers, 1), 5)]?.[index] || ''
}

function formatProfit(value = 0) {
  if (value > 0) return `+${value.toLocaleString()}`
  return value.toLocaleString()
}

function formatNumber(value = 0) {
  return Number(value || 0).toLocaleString()
}

function resultLabel(result) {
  const labels = {
    win: 'WIN',
    lose: 'LOSE',
    push: 'PUSH',
  }
  return labels[result] || ''
}

function outcomeLabel(outcome) {
  const labels = {
    player: 'Player wins',
    banker: 'Banker wins',
    tie: 'Tie wins',
  }
  return labels[outcome] || null
}

function BettingChipPreview({ amount }) {
  return (
    <div className="relative h-12 w-10 overflow-hidden">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        <BetChips amount={amount} />
      </div>
    </div>
  )
}

function BaccaratHand({ title, hand }) {
  const cards = hand?.cards || []
  const value = hand?.value

  return (
    <div className="flex min-h-[118px] flex-col items-center justify-start text-center">
      <div className="mb-2 flex items-center justify-center gap-2 rounded-lg border border-zinc-600/50 bg-black/30 px-3 py-1 text-white shadow-lg">
        <div className="text-[11px] font-black uppercase tracking-[0.24em]">{title}</div>
        {value !== null && value !== undefined && <div className="text-lg font-black">{value}</div>}
      </div>
      <div className="flex min-h-[72px] items-center justify-center gap-1.5">
        {cards.map((card, index) => (
          <CardSprite key={index} card={card} className="w-11 drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)] sm:w-14" />
        ))}
      </div>
    </div>
  )
}

function PlayerSeat({ player, isMe, emotes }) {
  const profit = player.profit || 0
  const profitClass = profit > 0 ? 'text-emerald-300' : profit < 0 ? 'text-red-300' : 'text-zinc-400'
  const bet = player.bet
  const betOption = BET_OPTIONS.find(option => option.id === bet?.type)
  const isAfk = player.sittingOut

  return (
    <div className="relative z-30 flex w-[112px] flex-col items-center gap-1 sm:w-[150px]">
      {isAfk && (
        <div className="absolute -top-4 left-1/2 z-50 -translate-x-1/2 rounded border border-zinc-400/60 bg-zinc-950/90 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-200 shadow-lg">
          AFK
        </div>
      )}
      <div className={`relative flex min-h-12 w-full items-center justify-center rounded-md border px-2 py-1 text-center shadow-xl ${
        isAfk
          ? 'border-zinc-700/50 bg-zinc-950/45 opacity-55 grayscale'
          : 'border-zinc-600/40 bg-zinc-900/50'
      }`}>
        {bet ? (
          <div className="flex items-center justify-center gap-1.5">
            <BettingChipPreview amount={bet.amount} />
            <div className="min-w-0 text-left">
              <div className={`rounded border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${betOption?.color || 'border-zinc-500/50 bg-zinc-700 text-white'}`}>
                {betOption?.label || bet.type}
              </div>
              <div className="mt-0.5 text-[10px] font-black text-white">{formatNumber(bet.amount)}</div>
              {bet.result && <div className="text-[8px] font-black text-amber-200">{resultLabel(bet.result)}</div>}
            </div>
          </div>
        ) : (
          <div className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
            {isAfk ? 'AFK' : player.waitingNextRound ? 'Next coup' : 'No bet'}
          </div>
        )}
      </div>

      <div className={`relative w-full rounded-lg border px-1.5 py-1.5 text-center shadow-2xl sm:px-2.5 sm:py-2 ${
        isAfk
          ? 'border-zinc-700/60 bg-zinc-900/90 opacity-60 grayscale'
          : 'border-zinc-600/50 bg-zinc-800/95'
      }`}>
        <SeatEmotes emotes={emotes} className="absolute -top-3 -left-2 z-40" />
        <div className="flex items-center justify-center gap-1.5">
          <ProfileAvatar avatarId={player.avatarId} avatarUrl={player.avatarUrl} className="h-5 w-5 shrink-0 sm:h-7 sm:w-7" />
          <div className="min-w-0 text-left">
            <div className="truncate text-[10px] font-black text-white sm:text-xs">{isMe ? 'You' : player.username}</div>
            <div className="text-[8px] font-bold text-zinc-300 sm:text-[10px]">{formatNumber(player.chips)} chips</div>
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

export default function BaccaratPage() {
  const wsRef = useRef(null)
  const chatEndRef = useRef(null)
  const emoteTimersRef = useRef(new Map())
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [username, setUsername] = useState('')
  const [selectedAvatarId, setSelectedAvatarId] = useState('op1')
  const [joined, setJoined] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [betType, setBetType] = useState('banker')
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

  function joinBaccarat() {
    send('join_game', {
      game: 'baccarat',
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
  const phase = gameState?.phase || 'waiting'
  const minBet = gameState?.minBet || 10
  const maxBet = Math.min(myPlayer?.chips || 0, gameState?.maxDisplayChips || 1000000)
  const clampedBet = Math.min(Math.max(betAmount, minBet), Math.max(minBet, maxBet))
  const hasBet = Boolean(myPlayer?.bet)
  const canBet = joined && phase === 'betting' && myPlayer && !myPlayer.waitingNextRound && !myPlayer.sittingOut && !hasBet
  const totalWagered = (gameState?.players || []).reduce((sum, player) => sum + (player.bet?.amount || 0), 0)
  const tableStatus = phase === 'betting' ? 'Waiting on player bets' : outcomeLabel(gameState?.outcome)

  if (!joined) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10">
        <HomeBackLink className="absolute right-4 top-4" />
        <div className="flex w-full max-w-[620px] flex-col items-center gap-6">
          <div className={`rounded-full px-6 py-2.5 text-sm font-bold shadow-sm sm:text-base ${connected ? 'border border-emerald-600/50 bg-emerald-800/80 text-emerald-100' : 'border border-red-600/50 bg-red-800/80 text-red-100'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>

          <ProfileSelector value={selectedAvatarId} onChange={selectAvatar} />

          <input
            className="w-full rounded-xl border border-zinc-500/50 bg-zinc-800/90 px-5 py-4 text-center text-base text-white shadow-lg outline-none placeholder-zinc-400 focus:border-zinc-300"
            placeholder="Username (optional)"
            value={username}
            onChange={event => persistUsername(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && connected && joinBaccarat()}
          />

          <button
            onClick={joinBaccarat}
            disabled={!connected}
            className="w-full rounded-xl border border-zinc-500/50 bg-zinc-700 py-4 text-base font-bold text-white shadow-lg transition-colors hover:bg-zinc-600 disabled:opacity-50"
          >
            Find Baccarat Table
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">
      <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-zinc-500/50 bg-zinc-700/80 px-3 py-1.5 text-xs font-bold tracking-wider text-white sm:text-sm">
            BACCARAT
          </span>
          <span className="rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-3 py-1.5 text-xs font-bold text-zinc-200 sm:text-sm">
            {phase.replace('_', ' ').toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <HomeBackLink />
          <button
            type="button"
            onClick={() => send('baccarat_set_afk', { afk: !myPlayer?.sittingOut })}
            className={`rounded-lg border px-3 py-1.5 text-xs font-bold shadow-sm transition-colors sm:text-sm ${
              myPlayer?.sittingOut
                ? 'border-emerald-500/50 bg-emerald-700/80 text-white hover:bg-emerald-600'
                : 'border-zinc-500/50 bg-zinc-800/80 text-white hover:bg-zinc-700'
            }`}
          >
            {myPlayer?.sittingOut ? 'Return' : 'AFK'}
          </button>
          <button onClick={() => send('leave_game')} className="rounded-lg border border-zinc-500/50 bg-zinc-700/80 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-colors hover:bg-zinc-600 sm:text-sm">
            Leave Table
          </button>
        </div>
      </div>

      <div className="relative mb-3 flex flex-col sm:flex-1 sm:justify-center">
        <div className="relative mx-auto h-[470px] w-full max-w-[430px] overflow-visible sm:hidden">
          <div
            className="absolute inset-0 z-0 rounded-[50%] border-4 border-emerald-900/40 shadow-2xl"
            style={{
              background: 'radial-gradient(ellipse 74% 58% at 50% 44%, #165d3f 0%, #10452e 52%, #082719 100%)',
              boxShadow: 'inset 0 2px 46px rgba(0,0,0,0.58), 0 0 76px rgba(0,0,0,0.32)',
            }}
          />

          <div className="absolute left-1/2 top-[8%] z-20 flex w-[78%] -translate-x-1/2 flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <BaccaratHand title="Player" hand={gameState?.playerHand} />
              <BaccaratHand title="Banker" hand={gameState?.bankerHand} />
            </div>
            <div className="mx-auto flex items-center gap-2 rounded-lg border border-zinc-600/50 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">
              <span>Total bets</span>
              <span className="text-amber-200">{formatNumber(totalWagered)}</span>
            </div>
            {tableStatus && (
              <div className="mx-auto text-[10px] font-black uppercase tracking-widest text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)]">
                {tableStatus}
              </div>
            )}
          </div>

          {orderedPlayers.map((player, index) => {
            const seatClass = mobileSeatClass(orderedPlayers.length, index)
            if (!seatClass) return null
            const playerEmotes = emoteEvents.filter(event => event.playerId === player.id)

            return (
              <div key={player.id} className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 ${seatClass}`}>
                <PlayerSeat
                  player={player}
                  isMe={player.id === playerId}
                  emotes={playerEmotes}
                />
              </div>
            )
          })}
        </div>

        <div className="relative mx-auto mt-1 hidden w-full max-w-6xl rounded-[42%] border-4 border-emerald-900/40 sm:block sm:aspect-[1.65/1] sm:min-h-[440px] md:aspect-[2.05/1] md:min-h-[500px]"
             style={{
               background: 'radial-gradient(ellipse 72% 58% at 50% 44%, #165d3f 0%, #10452e 48%, #082719 100%)',
               boxShadow: 'inset 0 2px 50px rgba(0,0,0,0.55), 0 0 100px rgba(0,0,0,0.35)',
             }}>
          <div className="absolute left-1/2 top-[9%] z-20 w-[58%] -translate-x-1/2">
            <div className="grid grid-cols-2 gap-4">
              <BaccaratHand title="Player" hand={gameState?.playerHand} />
              <BaccaratHand title="Banker" hand={gameState?.bankerHand} />
            </div>
            <div className="mx-auto mt-2 flex w-fit items-center gap-2 rounded-lg border border-zinc-600/50 bg-black/30 px-4 py-1 text-xs font-black uppercase tracking-widest text-zinc-300">
              <span>Total Bets</span>
              <span className="text-amber-200">{formatNumber(totalWagered)}</span>
            </div>
            {tableStatus && (
              <div className="mx-auto mt-1 w-fit text-xs font-black uppercase tracking-widest text-white drop-shadow-[0_2px_5px_rgba(0,0,0,0.9)]">
                {tableStatus}
              </div>
            )}
          </div>

          {orderedPlayers.map((player, index) => {
            const seatClass = DESKTOP_SEATS[index]
            if (!seatClass) return null
            const playerEmotes = emoteEvents.filter(event => event.playerId === player.id)

            return (
              <div key={player.id} className={`absolute z-30 -translate-x-1/2 -translate-y-1/2 ${seatClass}`}>
                <PlayerSeat
                  player={player}
                  isMe={player.id === playerId}
                  emotes={playerEmotes}
                />
              </div>
            )
          })}
        </div>
      </div>

      <div className="w-full flex flex-col md:flex-row justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto pb-4 md:pb-0">
        <div className="w-[92%] max-w-[380px] md:w-[380px] md:max-w-none shrink-0">
          {canBet && (
            <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 shadow-2xl backdrop-blur-md">
              <div className="mb-2 text-center text-[10px] font-black uppercase tracking-widest text-amber-300">Place Bet</div>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {BET_OPTIONS.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setBetType(option.id)}
                    className={`rounded-md border px-2 py-2 text-xs font-black uppercase tracking-wider transition-all active:scale-95 ${
                      betType === option.id
                        ? option.color
                        : 'border-zinc-600/50 bg-zinc-900/50 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mb-2 flex h-12 items-end justify-center gap-2 overflow-hidden">
                <BettingChipPreview amount={clampedBet} />
                <div className="text-xl font-black text-white">{formatNumber(clampedBet)}</div>
              </div>
              <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <span>Min {minBet}</span>
                <button
                  type="button"
                  onClick={() => setBetAmount(maxBet)}
                  disabled={maxBet < minBet}
                  className="rounded border border-zinc-500/50 px-2 py-0.5 text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  Max {formatNumber(maxBet)}
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
                onClick={() => send('baccarat_bet', { betType, amount: clampedBet })}
                disabled={maxBet < minBet}
                className="w-full rounded-md border border-amber-400/50 bg-amber-600 px-3 py-2 text-sm font-black text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
              >
                Bet {formatNumber(clampedBet)}
              </button>
            </div>
          )}

          {!canBet && (
            <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-4 py-3 text-center text-xs font-bold text-zinc-200 shadow-2xl backdrop-blur-md sm:text-sm">
              {myPlayer?.sittingOut ? 'Sitting out. Return when ready.' : myPlayer?.waitingNextRound ? 'Seated - entering next coup.' : phase === 'betting' ? 'Waiting for bets...' : phase === 'settle' ? 'Settling bets...' : 'Revealing cards...'}
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
