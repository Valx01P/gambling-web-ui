'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import PokerChip from '../components/PokerChip'
import CardSprite from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes, SeatYells } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'
import HomeBackLink from '../components/HomeBackLink'
import StatsPanel from '../components/StatsPanel'
import SpectatorPanel from '../components/SpectatorPanel'
import { buildPokerStatistics, buildSpectatorStatistics, formatPercent } from '../lib/pokerOdds'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const USERNAME_STORAGE_KEY = 'poker_username'
const AVATAR_STORAGE_KEY = 'poker_avatar_id'
const POKER_STARTING_CHIPS = 1000

function formatProfit(value) {
  const amount = Number(value) || 0
  if (amount === 0) return '+0'
  return amount > 0 ? `+${amount}` : String(amount)
}

function profitClass(value) {
  if (value > 0) return 'text-emerald-300'
  if (value < 0) return 'text-red-300'
  return 'text-zinc-400'
}

function visibleBetAmount(player) {
  if (player.lastAction?.chipThrow && player.lastAction.amount > 0) {
    return player.lastAction.amount
  }

  return player.bet || 0
}

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
    case 0: return 'bottom-[calc(100%+0.25rem)] lg:bottom-[105%] left-1/2 -translate-x-1/2'
    case 1: case 2: return 'left-[105%] sm:left-[110%] top-1/2 -translate-y-1/2'
    case 3: case 4: return 'right-[105%] sm:right-[110%] top-1/2 -translate-y-1/2'
    default: return ''
  }
}

const getChipThrowOrigin = (posIndex) => {
  switch(posIndex) {
    case 1:
    case 2:
      return 'left'
    case 3:
    case 4:
      return 'right'
    case 0:
    default:
      return 'bottom'
  }
}

export default function PokerPage() {
  const wsRef = useRef(null)
  const chatEndRef = useRef(null)
  const throwTimersRef = useRef(new Map())
  const emoteTimersRef = useRef(new Map())
  const yellTimersRef = useRef(new Map())
  const splitNoticeTimerRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  const [username, setUsername] = useState('')
  const [joined, setJoined] = useState(false)
  const [isSpectator, setIsSpectator] = useState(false)
  const [gameState, setGameState] = useState(null)
  const [gameStateReceivedAt, setGameStateReceivedAt] = useState(Date.now())
  const [turnClock, setTurnClock] = useState(Date.now())
  const [showdownData, setShowdownData] = useState(null)
  const [raiseAmount, setRaiseAmount] = useState(0)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [yellInput, setYellInput] = useState('')
  const [sysMessages, setSysMessages] = useState([])
  const [chipThrowEvents, setChipThrowEvents] = useState([])
  const [emoteEvents, setEmoteEvents] = useState([])
  const [yellEvents, setYellEvents] = useState([])
  const [splitPotNotice, setSplitPotNotice] = useState('')
  const [selectedAvatarId, setSelectedAvatarId] = useState('op1')
  const [statsMode, setStatsMode] = useState(false)
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [tableList, setTableList] = useState([])
  const [spectatorBlindMode, setSpectatorBlindMode] = useState(false)
  const [spectatorVisiblePlayerId, setSpectatorVisiblePlayerId] = useState(null)
  const [spectatorHoveredPlayerId, setSpectatorHoveredPlayerId] = useState(null)
  
  // New room feature states
  const [joinMode, setJoinMode] = useState('general') // 'general', 'create_private', 'join_private'
  const [inputCode, setInputCode] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [inviteCode, setInviteCode] = useState(null)

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  const applyGameState = useCallback((nextGameState) => {
    setGameState(nextGameState)
    setGameStateReceivedAt(Date.now())
    setTurnClock(Date.now())
  }, [])

  const clearChipThrows = useCallback(() => {
    throwTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    throwTimersRef.current.clear()
    setChipThrowEvents([])
  }, [])

  const addChipThrow = useCallback((event) => {
    if (!event?.playerId || !event?.amount) return

    const eventId = `${event.playerId}-${event.actionId || Date.now()}`
    const nextEvent = { ...event, eventId }

    setChipThrowEvents(prev => [...prev.filter(e => e.eventId !== eventId).slice(-10), nextEvent])

    const timerId = setTimeout(() => {
      setChipThrowEvents(prev => prev.filter(e => e.eventId !== eventId))
      throwTimersRef.current.delete(eventId)
    }, 1500)

    throwTimersRef.current.set(eventId, timerId)
  }, [])

  const clearEmotes = useCallback(() => {
    emoteTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    emoteTimersRef.current.clear()
    setEmoteEvents([])
  }, [])

  const addTableEmote = useCallback((event) => {
    if (!event?.playerId || !event?.emote) return

    const eventId = `${event.playerId}-${event.emoteId || Date.now()}`
    const nextEvent = { ...event, eventId }

    setEmoteEvents(prev => [...prev.slice(-18), nextEvent])

    const timerId = setTimeout(() => {
      setEmoteEvents(prev => prev.filter(e => e.eventId !== eventId))
      emoteTimersRef.current.delete(eventId)
    }, 1900)

    emoteTimersRef.current.set(eventId, timerId)
  }, [])

  const clearYells = useCallback(() => {
    yellTimersRef.current.forEach((timerId) => clearTimeout(timerId))
    yellTimersRef.current.clear()
    setYellEvents([])
  }, [])

  const clearSplitPotNotice = useCallback(() => {
    if (splitNoticeTimerRef.current) {
      clearTimeout(splitNoticeTimerRef.current)
      splitNoticeTimerRef.current = null
    }
    setSplitPotNotice('')
  }, [])

  const showSplitPotNotice = useCallback((winners) => {
    if (!winners?.length || winners.length < 2) return

    const names = winners
      .map(w => w.username || w.playerId?.substring(0, 6))
      .filter(Boolean)
      .slice(0, 4)
      .join(' / ')

    if (!names) return

    if (splitNoticeTimerRef.current) clearTimeout(splitNoticeTimerRef.current)
    setSplitPotNotice(`Split pot: ${names}`)
    splitNoticeTimerRef.current = setTimeout(() => {
      setSplitPotNotice('')
      splitNoticeTimerRef.current = null
    }, 4500)
  }, [])

  const addTableYell = useCallback((event) => {
    if (!event?.playerId || !event?.message) return

    const eventId = `${event.playerId}-${event.yellId || Date.now()}`
    const nextEvent = { ...event, eventId }

    setYellEvents(prev => [...prev.slice(-14), nextEvent])

    const timerId = setTimeout(() => {
      setYellEvents(prev => prev.filter(e => e.eventId !== eventId))
      yellTimersRef.current.delete(eventId)
    }, 2600)

    yellTimersRef.current.set(eventId, timerId)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, sysMessages])

  useEffect(() => {
    if (!joined || !gameState?.activeTurnExpiresAt) return

    const timerId = setInterval(() => setTurnClock(Date.now()), 1000)
    return () => clearInterval(timerId)
  }, [joined, gameState?.activeTurnExpiresAt])

  // Parse URL for invite code
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUsername = window.localStorage.getItem(USERNAME_STORAGE_KEY)
      const savedAvatarId = window.localStorage.getItem(AVATAR_STORAGE_KEY)
      if (savedUsername) setUsername(savedUsername)
      if (savedAvatarId) setSelectedAvatarId(getProfileAvatar(savedAvatarId).id)

      const params = new URLSearchParams(window.location.search)
      const codeParam = params.get('code')
      if (codeParam && codeParam.length === 5) {
        setJoinMode('join_private')
        setInputCode(codeParam.toUpperCase())
      }
    }
  }, [])

  useEffect(() => {
    if (connected && !joined && joinMode === 'spectate') {
      send('list_tables')
    }
  }, [connected, joined, joinMode])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => setConnected(true)
    ws.onclose = () => { setConnected(false); setJoined(false); setIsSpectator(false) }
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
          setIsSpectator(msg.data.isSpectator || false)
          applyGameState(msg.data.gameState)
          setIsPrivate(msg.data.isPrivate || false)
          setInviteCode(msg.data.inviteCode || null)
          if (msg.data.isSpectator) {
            setStatsMode(false)
            setStatsExpanded(false)
          }
          setSpectatorVisiblePlayerId(null)
          setSpectatorHoveredPlayerId(null)
          clearChipThrows()
          clearEmotes()
          clearYells()
          clearSplitPotNotice()
          break
        case 'leave_game':
          setJoined(false); applyGameState(null)
          setIsPrivate(false); setInviteCode(null)
          setIsSpectator(false)
          setSpectatorVisiblePlayerId(null)
          setSpectatorHoveredPlayerId(null)
          setSpectatorBlindMode(false)
          clearChipThrows()
          clearEmotes()
          clearYells()
          clearSplitPotNotice()
          break
        case 'table_list':
          setTableList(msg.data.tables || [])
          break
        case 'game_state':
          applyGameState(msg.data)
          if (msg.data.phase !== 'showdown') {
            setShowdownData(null) 
          }
          break
        case 'room_update':
          if (msg.data.gameState) applyGameState(msg.data.gameState)
          if (msg.data.isSpectator !== undefined) setIsSpectator(msg.data.isSpectator)
          if (msg.data.isPrivate !== undefined) setIsPrivate(msg.data.isPrivate)
          if (msg.data.inviteCode !== undefined) setInviteCode(msg.data.inviteCode)
          break
        case 'chip_throw':
          addChipThrow(msg.data)
          break
        case 'player_emote':
          addTableEmote(msg.data)
          break
        case 'player_yell':
          addTableYell(msg.data)
          break
        case 'spectator_update':
          setIsSpectator(true)
          if (msg.data.gameState) applyGameState(msg.data.gameState)
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'system_message':
          if (msg.data.message) addSys(msg.data.message)
          break
        case 'showdown':
          if (msg.data) {
            setShowdownData(msg.data)
            if (msg.data.winners?.length) {
              showSplitPotNotice(msg.data.winners)
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
    return () => {
      clearChipThrows()
      clearEmotes()
      clearYells()
      clearSplitPotNotice()
      ws.close()
    }
  }, [addSys, addChipThrow, addTableEmote, addTableYell, applyGameState, clearChipThrows, clearEmotes, clearYells, clearSplitPotNotice, showSplitPotNotice])

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

  function joinPayload(mode = joinMode, extra = {}) {
    const payload = {
      username: username || undefined,
      mode,
      ...extra,
    }

    if (mode !== 'spectate') {
      payload.avatarId = selectedAvatarId
    }

    return payload
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
  const canUseEmotes = !isSpectator && Boolean(myPlayer)
  const estimatedServerTime = gameState?.serverTime
    ? gameState.serverTime + (turnClock - gameStateReceivedAt)
    : turnClock
  const activeTurnTimeRemaining = gameState?.activeTurnExpiresAt
    ? gameState.activeTurnExpiresAt - estimatedServerTime
    : null
  const isActiveTurnWarning = activeTurnTimeRemaining !== null &&
    activeTurnTimeRemaining <= (gameState?.activeTurnWarningMs || 10000) &&
    phase !== 'waiting' &&
    phase !== 'showdown'
  const statistics = useMemo(
    () => statsMode ? buildPokerStatistics(gameState, playerId, { includeDetails: statsExpanded }) : null,
    [statsMode, statsExpanded, gameState, playerId]
  )
  const allInOddsByPlayer = useMemo(() => {
    if (!statistics?.allIn?.players) return new Map()
    return new Map(statistics.allIn.players.map((player) => [player.id, player]))
  }, [statistics])
  const spectatorStatistics = useMemo(
    () => isSpectator ? buildSpectatorStatistics(gameState, { blindMode: spectatorBlindMode }) : null,
    [isSpectator, gameState, spectatorBlindMode]
  )
  const spectatorOddsByPlayer = useMemo(() => {
    if (!spectatorStatistics?.players) return new Map()
    return new Map(spectatorStatistics.players.map((player) => [player.id, player]))
  }, [spectatorStatistics])
  const spectatorVisiblePlayerIds = useMemo(() => (
    spectatorVisiblePlayerId ? new Set([spectatorVisiblePlayerId]) : new Set()
  ), [spectatorVisiblePlayerId])

  const minRaise = currentBetAmount === 0 ? 10 : currentBetAmount * 2

  function sendEmote(emote) {
    if (!canUseEmotes) return
    send('player_emote', { emote })
  }

  function sendYell() {
    if (!canUseEmotes) return

    const message = yellInput.trim()
    if (!message) return

    send('player_yell', { message })
  }

  function toggleStatsMode() {
    if (statsMode) setStatsExpanded(false)
    setStatsMode(prev => !prev)
  }

  function toggleSpectatorPlayer(playerIdToToggle) {
    setSpectatorVisiblePlayerId(prev => prev === playerIdToToggle ? null : playerIdToToggle)
  }

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
        <HomeBackLink className="absolute right-4 top-4" />
        <div className="flex flex-col items-center gap-6 w-full max-w-[620px]">
          <div className={`text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
            {connected ? '● Connected' : '○ Connecting...'}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 w-full bg-zinc-800/80 p-2 gap-2 rounded-xl border border-zinc-600/50 shadow-md">
             <button onClick={() => setJoinMode('general')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'general' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>General</button>
             <button onClick={() => setJoinMode('create_private')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'create_private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Create Private</button>
             <button onClick={() => setJoinMode('join_private')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'join_private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Join Private</button>
             <button onClick={() => setJoinMode('spectate')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'spectate' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Spectate</button>
          </div>

          {joinMode !== 'spectate' && (
            <ProfileSelector value={selectedAvatarId} onChange={selectAvatar} />
          )}

          <input
            className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-xl px-5 py-4 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg"
            placeholder="Username (optional)"
            value={username}
            onChange={e => persistUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && connected && joinMode !== 'join_private' && joinMode !== 'spectate' && send('join_game', joinPayload(joinMode))}
          />

          {joinMode === 'join_private' && (
            <input
               className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-xl px-5 py-4 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg uppercase tracking-widest font-black"
               placeholder="5-LETTER CODE"
               maxLength={5}
               value={inputCode}
               onChange={e => setInputCode(e.target.value.toUpperCase())}
               onKeyDown={e => e.key === 'Enter' && connected && inputCode.length === 5 && send('join_game', joinPayload(joinMode, { code: inputCode }))}
            />
          )}

          {joinMode === 'spectate' ? (
            <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-black text-white">Live Tables</div>
                  <div className="text-xs font-bold text-zinc-500">Join any occupied table as a spectator.</div>
                </div>
                <button
                  type="button"
                  onClick={() => send('list_tables')}
                  disabled={!connected}
                  className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-600 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {tableList.map((table) => (
                  <div key={table.roomId} className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-white">
                          Table {table.roomId.replace('poker_', '#')}
                        </div>
                        <div className="truncate text-[10px] font-bold text-zinc-500">
                          {table.phase?.toUpperCase()} - {table.playerCount}/{table.maxPlayers} seated - {table.spectatorCount} watching
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => send('join_game', joinPayload('spectate', { roomId: table.roomId }))}
                        disabled={!connected}
                        className="shrink-0 rounded-md border border-amber-400/50 bg-amber-500/15 px-3 py-2 text-xs font-black text-amber-100 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
                      >
                        Watch
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {table.players.slice(0, 5).map((player) => (
                        <span key={player.id} className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-300">
                          {player.username}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {tableList.length === 0 && (
                  <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-500">
                    No occupied tables yet.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              onClick={() => send('join_game', joinPayload(joinMode, { code: joinMode === 'join_private' ? inputCode : undefined }))}
              disabled={!connected || (joinMode === 'join_private' && inputCode.length !== 5)}
              className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-4 rounded-xl text-base font-bold text-white transition-colors border border-zinc-500/50 shadow-lg"
            >
              {joinMode === 'general' ? 'Find Table' : joinMode === 'create_private' ? 'Create Private Room' : 'Join Private Room'}
            </button>
          )}
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
        <div className="flex items-center gap-2">
          <HomeBackLink />
          {!isSpectator && (
            <button
              type="button"
              onClick={toggleStatsMode}
              className={`text-xs sm:text-sm font-bold px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border shadow-sm transition-colors ${
                statsMode
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-100'
                  : 'bg-zinc-800/80 hover:bg-zinc-700/80 border-zinc-500/50 text-white'
              }`}
            >
              Stats {statsMode ? 'On' : 'Off'}
            </button>
          )}
          <button onClick={() => send('leave_game')} className="text-xs sm:text-sm font-bold text-white bg-zinc-700/80 hover:bg-zinc-600 px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-zinc-500/50 shadow-sm transition-colors">
            Leave Table
          </button>
        </div>
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

          {splitPotNotice && (
            <div className="absolute top-[34%] left-1/2 z-50 -translate-x-1/2 rounded-md border border-amber-300/70 bg-zinc-950/90 px-3 py-1.5 text-center text-[10px] sm:text-xs font-black uppercase tracking-wide text-amber-100 shadow-xl">
              {splitPotNotice}
            </div>
          )}

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
            const isTurnWarning = isActive && isActiveTurnWarning
            const isDealer = getOriginalIndex(player) === gameState?.dealerIndex
            const isPlayerWaiting = player.waitingNextHand

            const isWinner = phase === 'showdown' && showdownData?.winners?.some(w => w.playerId === player.id)
            const wonAmount = showdownData?.winners?.find(w => w.playerId === player.id)?.chips
            const handName = showdownData?.playerHandNames?.[player.id]
            const playerChipThrowEvents = chipThrowEvents.filter(event => event.playerId === player.id)
            const playerEmotes = emoteEvents.filter(event => event.playerId === player.id)
            const playerYells = yellEvents.filter(event => event.playerId === player.id)
            const playerAllInOdds = allInOddsByPlayer.get(player.id)
            const playerVisibleBet = visibleBetAmount(player)
            const playerProfit = typeof player.profit === 'number'
              ? player.profit
              : (player.chips || 0) + (player.totalBet || 0) - POKER_STARTING_CHIPS
            const spectatorCanRevealCards = isSpectator &&
              !spectatorBlindMode &&
              !isPlayerWaiting &&
              (spectatorVisiblePlayerId
                ? spectatorVisiblePlayerId === player.id
                : spectatorHoveredPlayerId === player.id)
            const visibleCards = isSpectator && player.cards?.length
              ? (spectatorCanRevealCards ? player.cards : player.cards.map(() => null))
              : player.cards

            return (
              <div key={player.id} className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center ${seatIndex === 0 ? 'mt-8 lg:mt-0' : ''}`} style={{ top: pos.top, left: pos.left }}>
                
                {/* Bet Stack projected into the table */}
                {(player.lastAction || playerChipThrowEvents.length > 0) && (
                  <div className={`absolute flex flex-col items-center justify-center gap-1 z-20 ${getBetPosClasses(seatIndex)}`}>
                    {(playerVisibleBet > 0 || playerChipThrowEvents.length > 0) && (
                      <div className={`relative flex items-center justify-center ${playerChipThrowEvents.length > 0 ? 'w-16 h-14 sm:w-20 sm:h-16' : ''}`}>
                        {playerVisibleBet > 0 && <BetChips amount={playerVisibleBet} />}
                        {playerChipThrowEvents.map(event => (
                          <div key={event.eventId} className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <BetChips
                              amount={event.amount}
                              thrown
                              animationKey={event.seed || event.eventId}
                              origin={getChipThrowOrigin(seatIndex)}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <ActionBadge action={player.lastAction} />
                  </div>
                )}

                {/* Info & Cards Wrapper */}
                <div className="relative flex flex-col items-center gap-1">
                  <SeatYells
                    yells={playerYells}
                    className="absolute -top-16 left-1/2 -translate-x-1/2 z-[9999]"
                  />

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
                    ${isActive
                      ? isTurnWarning
                        ? 'ring-2 ring-red-500 shadow-[0_0_22px_rgba(239,68,68,0.55)]'
                        : 'ring-2 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)]'
                      : ''}
                  `}>
                    <SeatEmotes
                      emotes={playerEmotes}
                      className="absolute -top-3 -left-2 sm:-top-3.5 sm:-left-2.5 z-40"
                    />
                    {isActive && (
                      <div className={`absolute -top-4 sm:-top-5 left-1/2 -translate-x-1/2 text-xs sm:text-sm animate-bounce ${isTurnWarning ? 'text-red-500' : 'text-amber-400'}`}>▼</div>
                    )}
                    <div className="text-[10px] sm:text-sm font-bold truncate max-w-[70px] sm:max-w-[100px] text-white">
                      {isMe ? 'You' : player.username}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[9px] sm:text-xs text-zinc-200 font-medium">
                      <ProfileAvatar
                        avatarId={player.avatarId}
                        avatarUrl={player.avatarUrl}
                        className="h-5 w-5 sm:h-6 sm:w-6"
                      />
                      {isPlayerWaiting ? (
                        <span className="text-zinc-400 font-bold italic">Waiting...</span>
                      ) : phase === 'showdown' && handName && !player.folded ? (
                        <span className="text-amber-300 font-bold">{handName}</span>
                      ) : (
                        `${player.chips} chips`
                      )}
                    </div>
                    <div className={`mt-0.5 text-[8px] sm:text-[10px] font-black leading-none ${profitClass(playerProfit)}`}>
                      P/L {formatProfit(playerProfit)}
                    </div>
                    {statsMode && playerAllInOdds && (
                      <div className="mt-0.5 text-[8px] sm:text-[10px] font-black text-amber-200">
                        {formatPercent(playerAllInOdds.equity, 1)}
                      </div>
                    )}
                  </div>

                  {/* Player Cards */}
                  {!isPlayerWaiting && (
                    <div
                      className={`flex gap-0.5 sm:gap-1 z-20 relative ${player.folded ? 'opacity-40 grayscale' : ''}`}
                      onMouseEnter={() => isSpectator && setSpectatorHoveredPlayerId(player.id)}
                      onMouseLeave={() => isSpectator && setSpectatorHoveredPlayerId(prev => prev === player.id ? null : prev)}
                    >
                      {(visibleCards || []).map((card, ci) => (
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

      {isSpectator && (
        <SpectatorPanel
          players={orderedPlayers}
          oddsByPlayer={spectatorOddsByPlayer}
          blindMode={spectatorBlindMode}
          visiblePlayerIds={spectatorVisiblePlayerIds}
          onToggleBlind={() => {
            setSpectatorBlindMode(prev => !prev)
            setSpectatorHoveredPlayerId(null)
          }}
          onTogglePlayer={toggleSpectatorPlayer}
        />
      )}

      {/* Natural Flow Bottom UI */}
      <div className={`w-full flex flex-col md:flex-row justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto ${isSpectator ? 'pb-[310px] md:pb-0' : 'pb-4 md:pb-0'}`}>
        
        {/* Actions Panel */}
        {!isSpectator && (
        <div className="w-[92%] max-w-[360px] md:w-[360px] md:max-w-none shrink-0">
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
          {canUseEmotes && (
            <>
              <div className="grid grid-cols-6 gap-1.5 mt-2 py-2 px-2 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md">
                {EMOTE_OPTIONS.map((emote) => (
                  <button
                    key={emote.id}
                    type="button"
                    title={emote.label}
                    aria-label={emote.label}
                    onClick={() => sendEmote(emote.id)}
                    className="h-10 rounded-md border flex items-center justify-center transition-all active:scale-95 bg-zinc-700 hover:bg-zinc-600 border-zinc-500/50 text-zinc-200"
                  >
                    <EmoteIcon emote={emote.id} />
                  </button>
                ))}
              </div>
              <div className="mt-2 flex overflow-hidden rounded-xl border border-zinc-600/50 bg-zinc-800/95 shadow-2xl backdrop-blur-md">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-zinc-400 outline-none"
                  placeholder="Yell..."
                  aria-label="Yell"
                  value={yellInput}
                  onChange={e => setYellInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendYell()}
                  maxLength={80}
                />
                <button
                  type="button"
                  onClick={sendYell}
                  disabled={!yellInput.trim()}
                  className="shrink-0 px-4 text-sm font-black text-amber-100 transition-colors hover:bg-zinc-700 disabled:text-zinc-500"
                >
                  Yell
                </button>
              </div>
            </>
          )}
          {statsMode && (
            <StatsPanel
              statistics={statistics}
              expanded={statsExpanded}
              onToggleExpanded={() => setStatsExpanded(prev => !prev)}
            />
          )}
        </div>
        )}

        {/* Chat Panel */}
        <div className={`${isSpectator ? 'fixed bottom-3 right-3 z-40 w-[calc(100vw-1.5rem)] max-w-[320px] sm:bottom-4 sm:right-4 md:w-[320px]' : 'w-[92%] max-w-[320px] md:w-[280px] md:max-w-none'} flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
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
                  {msg.playerId === playerId ? 'You' : msg.username}{msg.isSpectator ? ' (spectator)' : ''}:
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
