'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import PokerChip from '../components/PokerChip'
import CardSprite from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes, SeatYells, getEmoteOptions } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'
import HomeBackLink from '../components/HomeBackLink'
import AccountMenu from '../components/AccountMenu'
import AuthGateModal from '../components/AuthGateModal'
import AchievementToast from '../components/AchievementToast'
import BotAvatar from '../components/BotAvatar'
import { useAuth } from '../lib/useAuth'
import { api } from '../lib/api'
import {
  BANKS,
  LOAN_AMOUNT,
  LOAN_INTEREST_HAND_INTERVAL,
  CREDIT_SCORE_MIN,
  CREDIT_SCORE_MAX,
  effectiveLoanRate,
  nextUnlockTier,
  creditScoreLabel,
  creditScoreColorClass
} from '../lib/banks'
import Link from 'next/link'
import StatsPanel from '../components/StatsPanel'
import SpectatorPanel from '../components/SpectatorPanel'
import { buildPokerStatistics, buildSpectatorStatistics, evaluateHand, formatCard, formatPercent, getHandName } from '../lib/pokerOdds'
// Seat geometry lives in ./lib/seatLayout — shared by spectator view, the
// table render, and the chip-throw animation. Pure data + helpers, no state.
import { SEATS, getBetPosClasses, getChipThrowOrigin } from './lib/seatLayout'
import LobbyView from './components/LobbyView'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const USERNAME_STORAGE_KEY = 'poker_username'
const AVATAR_STORAGE_KEY = 'poker_avatar_id'
const ZOOM_STORAGE_KEY = 'poker_zoom'
const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 10
const POKER_STARTING_CHIPS = 1000

const BLIND_LEVELS = [
  { id: '5_10',     small: 5,    big: 10   },
  { id: '15_25',    small: 15,   big: 25   },
  { id: '25_50',    small: 25,   big: 50   },
  { id: '50_100',   small: 50,   big: 100  },
  { id: '100_200',  small: 100,  big: 200  },
  { id: '250_500',  small: 250,  big: 500  },
  { id: '500_1000', small: 500,  big: 1000 }
]

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

const HOW_TO_HANDS = [
  {
    name: 'Royal Flush',
    cards: [
      { rank: '10', suit: 'spades' },
      { rank: 'J', suit: 'spades' },
      { rank: 'Q', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
    ],
    text: 'A-K-Q-J-10 all in one suit.',
  },
  {
    name: 'Straight Flush',
    cards: [
      { rank: '5', suit: 'hearts' },
      { rank: '6', suit: 'hearts' },
      { rank: '7', suit: 'hearts' },
      { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
    ],
    text: 'Five cards in sequence, same suit.',
  },
  {
    name: 'Four of a Kind',
    cards: [
      { rank: '9', suit: 'clubs' },
      { rank: '9', suit: 'diamonds' },
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ],
    text: 'Four cards of the same rank.',
  },
  {
    name: 'Full House',
    cards: [
      { rank: 'Q', suit: 'clubs' },
      { rank: 'Q', suit: 'diamonds' },
      { rank: 'Q', suit: 'spades' },
      { rank: '4', suit: 'hearts' },
      { rank: '4', suit: 'clubs' },
    ],
    text: 'Three of one rank plus a pair.',
  },
  {
    name: 'Flush',
    cards: [
      { rank: 'A', suit: 'diamonds' },
      { rank: 'J', suit: 'diamonds' },
      { rank: '8', suit: 'diamonds' },
      { rank: '5', suit: 'diamonds' },
      { rank: '2', suit: 'diamonds' },
    ],
    text: 'Any five cards of one suit.',
  },
  {
    name: 'Straight',
    cards: [
      { rank: '6', suit: 'clubs' },
      { rank: '7', suit: 'diamonds' },
      { rank: '8', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
      { rank: '10', suit: 'clubs' },
    ],
    text: 'Five cards in sequence.',
  },
  {
    name: 'Three of a Kind',
    cards: [
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'diamonds' },
      { rank: '7', suit: 'hearts' },
      { rank: 'A', suit: 'spades' },
      { rank: '3', suit: 'clubs' },
    ],
    text: 'Three cards of one rank.',
  },
  {
    name: 'Two Pair',
    cards: [
      { rank: 'A', suit: 'clubs' },
      { rank: 'A', suit: 'hearts' },
      { rank: '6', suit: 'diamonds' },
      { rank: '6', suit: 'spades' },
      { rank: 'Q', suit: 'clubs' },
    ],
    text: 'Two different pairs.',
  },
  {
    name: 'Pair',
    cards: [
      { rank: 'K', suit: 'clubs' },
      { rank: 'K', suit: 'diamonds' },
      { rank: '9', suit: 'spades' },
      { rank: '5', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ],
    text: 'Two cards of one rank.',
  },
  {
    name: 'High Card',
    cards: [
      { rank: 'A', suit: 'clubs' },
      { rank: 'J', suit: 'diamonds' },
      { rank: '8', suit: 'spades' },
      { rank: '5', suit: 'hearts' },
      { rank: '2', suit: 'clubs' },
    ],
    text: 'No pair or better; highest card plays.',
  },
]

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


function ArenaStartingChipsInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value ?? 1000))
  useEffect(() => { setDraft(String(value ?? 1000)) }, [value])
  function commit() {
    const n = Math.max(100, Math.min(1_000_000, Math.floor(Number(draft) || 0)))
    if (n !== value) onCommit(n)
    setDraft(String(n))
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={100}
        max={1_000_000}
        step={100}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && e.target.blur()}
        className="flex-1 rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-zinc-300 tabular-nums"
      />
      {[1000, 5000, 25_000, 100_000].map(preset => (
        <button
          key={preset}
          type="button"
          onClick={() => { setDraft(String(preset)); onCommit(preset) }}
          className="rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-[10px] font-black text-zinc-100 hover:bg-zinc-700"
        >
          ${preset >= 1000 ? `${preset / 1000}k` : preset}
        </button>
      ))}
    </div>
  )
}

function LoanAutoPayRow({ loan, onCommit }) {
  const [draft, setDraft] = useState(String(loan.autoPay ?? 0))

  // Resync if the canonical autoPay changes (e.g. via room_update).
  useEffect(() => {
    setDraft(String(loan.autoPay ?? 0))
  }, [loan.autoPay])

  function commit() {
    const next = Math.max(0, Math.floor(Number(draft) || 0))
    if (next !== (loan.autoPay ?? 0)) onCommit(next)
  }

  const minToRecover = loan.perTurnInterest + 1 // anything more than per-turn interest erodes principal
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-zinc-700/70 bg-zinc-950/45 px-2 py-1.5">
      <span className="text-[9px] font-black uppercase tracking-widest text-zinc-300">Auto-pay / turn</span>
      <input
        type="number"
        min={0}
        step={50}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && (e.target.blur())}
        className="w-24 rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 text-xs font-bold text-white outline-none focus:border-zinc-300"
      />
      <button
        type="button"
        onClick={() => { setDraft(String(minToRecover)); onCommit(minToRecover) }}
        className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
        title="Set the minimum that beats interest each turn"
      >
        Min ${minToRecover.toLocaleString()}
      </button>
      <button
        type="button"
        onClick={() => { setDraft('0'); onCommit(0) }}
        className="rounded-md border border-zinc-500/60 bg-zinc-800 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-zinc-200 hover:bg-zinc-700"
      >
        Off
      </button>
      <span className="ml-auto text-[10px] font-bold text-zinc-300">
        {loan.autoPay > 0
          ? `Drains $${loan.autoPay.toLocaleString()} from your stack each hand.`
          : 'Off — interest accrues until you pay manually.'}
      </span>
    </div>
  )
}

export default function PokerPage() {
  const { user: authUser } = useAuth()
  const wsRef = useRef(null)
  const chatEndRef = useRef(null)
  const playerIdRef = useRef('')
  const gameStateRef = useRef(null)
  const tableMenuRef = useRef(null)
  const pokerPanelRef = useRef(null)
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
  const [yellHistory, setYellHistory] = useState([])
  const [yellHistoryIndex, setYellHistoryIndex] = useState(-1)
  const [yellDraft, setYellDraft] = useState('')
  const [sysMessages, setSysMessages] = useState([])
  const [chipThrowEvents, setChipThrowEvents] = useState([])
  const [emoteEvents, setEmoteEvents] = useState([])
  const [yellEvents, setYellEvents] = useState([])
  const [splitPotNotice, setSplitPotNotice] = useState('')
  const [selectedAvatarId, setSelectedAvatarId] = useState('op1')
  const [statsMode, setStatsMode] = useState(false)
  const [statsExpansion, setStatsExpansion] = useState('minimized')
  const statsPanelRef = useRef(null)
  const [tableList, setTableList] = useState([])
  const [spectatorBlindMode, setSpectatorBlindMode] = useState(false)
  const [spectatorVisibleIdSet, setSpectatorVisibleIdSet] = useState(() => new Set())
  const [spectatorRevealAll, setSpectatorRevealAll] = useState(false)
  const [spectatorHoveredPlayerId, setSpectatorHoveredPlayerId] = useState(null)
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const [activePokerPanel, setActivePokerPanel] = useState(null)
  const [sessionHands, setSessionHands] = useState([])
  const [botRoster, setBotRoster] = useState({ mine: [], public: [], loading: false, error: null })
  // Pending bot picks for the arena tool. Holds bot IDs (duplicates allowed),
  // capped at MAX_ARENA_PICK. Flushed when the user hits "Add N bots".
  const [arenaPickQueue, setArenaPickQueue] = useState([])
  const [allInArmed, setAllInArmed] = useState(false)
  const allInArmTimerRef = useRef(null)
  const [leaveTableArmed, setLeaveTableArmed] = useState(false)
  const leaveTableArmTimerRef = useRef(null)
  const [bankState, setBankState] = useState({
    loans: [],
    loanedTotal: 0,
    creditScore: 700,
    maxLoans: 2,
    peakSwing: 0,
    handsAtSession: 0,
    bigYahuCalls: 0,
    lifetimeBorrowed: 0,
    lifetimeInterestPaid: 0,
    creditScoreMin: 700,
    creditScoreMax: 700,
    error: null
  })
  const [profileDraftName, setProfileDraftName] = useState('')
  const [profileDraftAvatar, setProfileDraftAvatar] = useState(null)
  const [resetConfirmArmed, setResetConfirmArmed] = useState(false)
  const [bigYahuArmed, setBigYahuArmed] = useState(false)
  const [pendingBlindsProposal, setPendingBlindsProposal] = useState(null)
  const [contestMode, setContestMode] = useState({ enabled: false, currentLevelIndex: 0, handsUntilNextLevel: null, currentLevel: null, nextLevel: null, handsPerLevel: 10 })
  const [isArena, setIsArena] = useState(false)
  const [arenaRunning, setArenaRunning] = useState(false)
  // Live ref of arenaRunning so stable useCallbacks can read the latest value
  // without taking a dependency on it (which would invalidate React.memo).
  const arenaRunningRef = useRef(false)
  useEffect(() => { arenaRunningRef.current = arenaRunning }, [arenaRunning])
  const [arenaStartingChips, setArenaStartingChips] = useState(1000)
  const [pageZoom, setPageZoom] = useState(100)
  const [myBotsExpanded, setMyBotsExpanded] = useState(false)
  
  // New room feature states
  // 'general' | 'private' | 'spectate'. `private` is a UI tab only — the
  // actual join sends the legacy `create_private` / `join_private` modes.
  const [joinMode, setJoinMode] = useState('general')
  // String message shown in the auth-gate modal (Sign in to ...). null hides.
  const [authGateMessage, setAuthGateMessage] = useState(null)
  // Most recent achievement payload from the server. Renders as a toast
  // overlay; null = hidden. The toast handles its own auto-dismiss timer.
  const [achievement, setAchievement] = useState(null)
  const [inputCode, setInputCode] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [inviteCode, setInviteCode] = useState(null)

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  const applyGameState = useCallback((nextGameState) => {
    gameStateRef.current = nextGameState
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
    }, 3600)

    yellTimersRef.current.set(eventId, timerId)
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, sysMessages])

  useEffect(() => {
    playerIdRef.current = playerId
  }, [playerId])

  useEffect(() => {
    if (!joined || !gameState?.activeTurnExpiresAt) return

    const timerId = setInterval(() => setTurnClock(Date.now()), 1000)
    return () => clearInterval(timerId)
  }, [joined, gameState?.activeTurnExpiresAt])

  useEffect(() => {
    if (!tableMenuOpen) return

    function handlePointerDown(event) {
      if (tableMenuRef.current?.contains(event.target)) return
      setTableMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [tableMenuOpen])

  useEffect(() => {
    if (!activePokerPanel) return

    function handlePointerDown(event) {
      if (pokerPanelRef.current?.contains(event.target)) return
      if (tableMenuRef.current?.contains(event.target)) return
      setActivePokerPanel(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [activePokerPanel])

  // Parse URL for invite code
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedUsername = window.localStorage.getItem(USERNAME_STORAGE_KEY)
      const savedAvatarId = window.localStorage.getItem(AVATAR_STORAGE_KEY)
      const savedZoom = parseInt(window.localStorage.getItem(ZOOM_STORAGE_KEY) || '', 10)
      if (savedUsername) setUsername(savedUsername)
      if (savedAvatarId) setSelectedAvatarId(getProfileAvatar(savedAvatarId).id)
      if (Number.isFinite(savedZoom) && savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) {
        setPageZoom(savedZoom)
      }

      const params = new URLSearchParams(window.location.search)
      const codeParam = params.get('code')
      if (codeParam && codeParam.length === 5) {
        // Private create+join now share one tab.
        setJoinMode('private')
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
    ws.onopen = () => {
      setConnected(true)
      // Tell the server who we are if we have a session token. The server
      // uses this to gate features that require an account (Bot Arena, etc).
      try {
        const token = typeof window !== 'undefined'
          ? window.localStorage.getItem('gwu_session_token')
          : null
        if (token) ws.send(JSON.stringify({ type: 'auth_hello', data: { token } }))
      } catch {}
    }
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
          setSessionHands([])
          setActivePokerPanel(null)
          setTableMenuOpen(false)
          setIsSpectator(msg.data.isSpectator || false)
          applyGameState(msg.data.gameState)
          setIsPrivate(msg.data.isPrivate || false)
          setInviteCode(msg.data.inviteCode || null)
          if (msg.data.contestMode) setContestMode(msg.data.contestMode)
          if (typeof msg.data.isArena === 'boolean') setIsArena(msg.data.isArena)
          if (typeof msg.data.arenaRunning === 'boolean') setArenaRunning(msg.data.arenaRunning)
          if (typeof msg.data.arenaStartingChips === 'number') setArenaStartingChips(msg.data.arenaStartingChips)
          {
            const me = msg.data.players?.find(p => p.id === playerIdRef.current)
            if (me) setBankState(prev => ({
              ...prev,
              loans: me.loans || [],
              loanedTotal: me.loanedTotal || 0,
              creditScore: me.creditScore ?? prev.creditScore,
              maxLoans: me.maxLoans ?? prev.maxLoans,
              peakSwing: me.peakSwing ?? prev.peakSwing,
              handsAtSession: me.handsAtSession ?? prev.handsAtSession,
              bigYahuCalls: me.bigYahuCalls ?? prev.bigYahuCalls ?? 0,
              lifetimeBorrowed: me.lifetimeBorrowed ?? prev.lifetimeBorrowed ?? 0,
              lifetimeInterestPaid: me.lifetimeInterestPaid ?? prev.lifetimeInterestPaid ?? 0,
              creditScoreMin: me.creditScoreMin ?? prev.creditScoreMin ?? me.creditScore ?? 700,
              creditScoreMax: me.creditScoreMax ?? prev.creditScoreMax ?? me.creditScore ?? 700
            }))
          }
          if (msg.data.isSpectator) {
            setStatsMode(false)
            setStatsExpansion('minimized')
          }
          setSpectatorVisibleIdSet(new Set()); setSpectatorRevealAll(false)
          setSpectatorHoveredPlayerId(null)
          clearChipThrows()
          clearEmotes()
          clearYells()
          clearSplitPotNotice()
          break
        case 'leave_game':
          setJoined(false); applyGameState(null)
          setActivePokerPanel(null)
          setTableMenuOpen(false)
          setIsPrivate(false); setInviteCode(null)
          setIsSpectator(false)
          setSpectatorVisibleIdSet(new Set()); setSpectatorRevealAll(false)
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
          if (msg.data.contestMode) setContestMode(msg.data.contestMode)
          if (typeof msg.data.isArena === 'boolean') setIsArena(msg.data.isArena)
          if (typeof msg.data.arenaRunning === 'boolean') setArenaRunning(msg.data.arenaRunning)
          if (typeof msg.data.arenaStartingChips === 'number') setArenaStartingChips(msg.data.arenaStartingChips)
          {
            const me = msg.data.players?.find(p => p.id === playerIdRef.current)
            if (me) setBankState(prev => ({
              ...prev,
              loans: me.loans || [],
              loanedTotal: me.loanedTotal || 0,
              creditScore: me.creditScore ?? prev.creditScore,
              maxLoans: me.maxLoans ?? prev.maxLoans,
              peakSwing: me.peakSwing ?? prev.peakSwing,
              handsAtSession: me.handsAtSession ?? prev.handsAtSession,
              bigYahuCalls: me.bigYahuCalls ?? prev.bigYahuCalls ?? 0,
              lifetimeBorrowed: me.lifetimeBorrowed ?? prev.lifetimeBorrowed ?? 0,
              lifetimeInterestPaid: me.lifetimeInterestPaid ?? prev.lifetimeInterestPaid ?? 0,
              creditScoreMin: me.creditScoreMin ?? prev.creditScoreMin ?? me.creditScore ?? 700,
              creditScoreMax: me.creditScoreMax ?? prev.creditScoreMax ?? me.creditScore ?? 700
            }))
          }
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
        case 'achievement':
          // Server-driven milestone toast. Currently the only one is the
          // 12-hand player-clone unlock. Future achievements can dispatch
          // through the same channel.
          setAchievement(msg.data || null)
          break
        case 'showdown':
          if (msg.data) {
            setShowdownData(msg.data)
            const currentPlayerId = playerIdRef.current
            const currentGameState = gameStateRef.current
            const hero = currentGameState?.players?.find(player => player.id === currentPlayerId)
            if (currentPlayerId && hero && !hero.waitingNextHand) {
              const winner = msg.data.winners?.find(w => w.playerId === currentPlayerId)
              const cards = msg.data.hands?.[currentPlayerId] || (hero.cards || []).filter(card => card?.rank && card?.suit)
              setSessionHands(prev => [{
                id: `${Date.now()}-${prev.length}`,
                at: Date.now(),
                cards,
                board: currentGameState?.communityCards || [],
                handName: msg.data.playerHandNames?.[currentPlayerId] || winner?.handName || (hero.folded ? 'Folded' : 'No showdown'),
                result: winner ? 'Won' : hero.folded ? 'Folded' : 'Lost',
                won: winner?.chips || 0,
                profit: hero.profit || 0,
                split: (msg.data.winners?.length || 0) > 1,
              }, ...prev].slice(0, 30))
            }
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
        case 'poker_loan':
          if (msg.data?.success) {
            setBankState(prev => ({ ...prev, loans: msg.data.loans, loanedTotal: msg.data.loanedTotal, error: null }))
          }
          break
        case 'update_profile':
          if (msg.data?.success) {
            persistUsername(msg.data.username)
            if (msg.data.avatarId) selectAvatar(msg.data.avatarId)
          }
          break
        case 'reset_money':
          if (msg.data?.success) {
            setBankState({ loans: [], loanedTotal: 0, banks: [], loading: false, error: null })
          }
          break
        case 'poker_blinds_proposal':
          // Don't show our own proposal back to us — we already know we sent it.
          if (msg.data?.proposerId === playerIdRef.current) break
          setPendingBlindsProposal(msg.data)
          break
        case 'poker_blinds_resolved':
          setPendingBlindsProposal(null)
          if (msg.data?.outcome === 'applied') {
            addSys(`Blinds set to $${msg.data.small}/$${msg.data.big}.`)
          } else if (msg.data?.outcome === 'rejected') {
            addSys(`Blinds proposal rejected${msg.data.byName ? ' by ' + msg.data.byName : ''}.`)
          } else if (msg.data?.outcome === 'expired') {
            addSys('Blinds proposal expired.')
          }
          break
        case 'poker_blinds_changed':
          // Just acknowledged via the system_message; the next game_state has new blinds.
          break
        case 'poker_contest_mode_update':
          setContestMode(msg.data || {})
          break
        case 'error':
          if (msg.data?.message && /sign in/i.test(msg.data.message)) {
            setAuthGateMessage(msg.data.message)
          } else {
            addSys(`Error: ${msg.data.message}`)
          }
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

    if (mode !== 'spectate' && mode !== 'bot_arena') {
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
  
  function getOriginalIndex(player) {
    return gameState?.players?.findIndex((p) => p.id === player.id) ?? -1
  }

  const copyInviteLink = () => {
    const url = `${window.location.origin}${window.location.pathname}?code=${inviteCode}`;
    navigator.clipboard.writeText(url);
    addSys(`Invite link copied to clipboard!`);
  }

  // Memoized so React.memo'd children (SpectatorPanel, etc.) see a stable
  // array reference between renders that don't change the player list.
  const orderedPlayers = useMemo(() => {
    if (!gameState?.players) return []
    const ps = gameState.players
    const mi = ps.findIndex((p) => p.id === playerId)
    if (mi <= 0) return ps
    return [...ps.slice(mi), ...ps.slice(0, mi)]
  }, [gameState?.players, playerId])
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
    () => statsMode ? buildPokerStatistics(gameState, playerId, { includeDetails: statsExpansion === 'detailed' }) : null,
    [statsMode, statsExpansion, gameState, playerId]
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
  // What the spectator currently has revealed. "Show all" overrides per-player picks.
  const spectatorVisiblePlayerIds = useMemo(() => {
    if (spectatorRevealAll) {
      return new Set((gameState?.players || []).map(p => p.id))
    }
    return spectatorVisibleIdSet
  }, [spectatorRevealAll, spectatorVisibleIdSet, gameState?.players])

  const tableBigBlind = gameState?.bigBlind ?? 10
  const tableSmallBlind = gameState?.smallBlind ?? 5
  const minRaise = currentBetAmount === 0 ? tableBigBlind : currentBetAmount * 2
  const myCards = (myPlayer?.cards || []).filter(card => card?.rank && card?.suit)
  const boardCards = (gameState?.communityCards || []).filter(card => card?.rank && card?.suit)
  const currentHandEvaluation = myCards.length === 2 && boardCards.length >= 3
    ? evaluateHand([...myCards, ...boardCards])
    : null
  const currentHandName = showdownData?.playerHandNames?.[playerId] ||
    (currentHandEvaluation ? getHandName(currentHandEvaluation) : myCards.length ? myCards.map(formatCard).join(' ') : 'No cards yet')
  const sessionSummary = useMemo(() => {
    const wins = sessionHands.filter(hand => hand.result === 'Won').length
    const folds = sessionHands.filter(hand => hand.result === 'Folded').length
    const totalWon = sessionHands.reduce((sum, hand) => sum + (hand.won || 0), 0)

    return {
      hands: sessionHands.length,
      wins,
      folds,
      losses: Math.max(0, sessionHands.length - wins - folds),
      totalWon,
      currentProfit: myPlayer?.profit || 0,
    }
  }, [sessionHands, myPlayer?.profit])

  function sendEmote(emote) {
    if (!canUseEmotes) return
    send('player_emote', { emote })
  }

  function sendYell() {
    if (!canUseEmotes) return

    const message = yellInput.trim()
    if (!message) return

    send('player_yell', { message })
    setYellInput('')
    setYellHistory(prev => {
      const without = prev.filter(y => y !== message)
      return [message, ...without].slice(0, 20)
    })
    setYellHistoryIndex(-1)
    setYellDraft('')
  }

  function onYellKeyDown(e) {
    if (e.key === 'Enter') return sendYell()
    if (e.key === 'ArrowUp') {
      if (yellHistory.length === 0) return
      e.preventDefault()
      if (yellHistoryIndex === -1) setYellDraft(yellInput)
      const next = Math.min(yellHistory.length - 1, yellHistoryIndex + 1)
      setYellHistoryIndex(next)
      setYellInput(yellHistory[next])
    } else if (e.key === 'ArrowDown') {
      if (yellHistoryIndex === -1) return
      e.preventDefault()
      const next = yellHistoryIndex - 1
      setYellHistoryIndex(next)
      setYellInput(next === -1 ? yellDraft : yellHistory[next])
    }
  }

  function openPokerPanel(panel) {
    setActivePokerPanel(prev => prev === panel ? null : panel)
    setTableMenuOpen(false)
    if (panel === 'bots' || panel === 'arena') refreshBotRoster()
    if (panel === 'profile') {
      setProfileDraftName(username)
      setProfileDraftAvatar(selectedAvatarId)
    }
    if (panel === 'reset') setResetConfirmArmed(false)
    if (panel === 'big_yahu') setBigYahuArmed(false)
  }

  // Two-step Leave Table confirm — same pattern as All-In.
  function clickLeaveTable() {
    if (leaveTableArmed) {
      if (leaveTableArmTimerRef.current) clearTimeout(leaveTableArmTimerRef.current)
      leaveTableArmTimerRef.current = null
      setLeaveTableArmed(false)
      send('leave_game')
      return
    }
    setLeaveTableArmed(true)
    if (leaveTableArmTimerRef.current) clearTimeout(leaveTableArmTimerRef.current)
    leaveTableArmTimerRef.current = setTimeout(() => {
      setLeaveTableArmed(false)
      leaveTableArmTimerRef.current = null
    }, 4000)
  }

  // Two-step All-In confirm — first click arms it, second within 4s fires.
  function clickAllIn() {
    if (allInArmed) {
      if (allInArmTimerRef.current) clearTimeout(allInArmTimerRef.current)
      allInArmTimerRef.current = null
      setAllInArmed(false)
      send('poker_all_in')
      return
    }
    setAllInArmed(true)
    if (allInArmTimerRef.current) clearTimeout(allInArmTimerRef.current)
    allInArmTimerRef.current = setTimeout(() => {
      setAllInArmed(false)
      allInArmTimerRef.current = null
    }, 4000)
  }

  function takeLoan(bankId) {
    setBankState(prev => ({ ...prev, error: null }))
    send('poker_loan', { bankId })
  }

  function repayLoan(bankId) {
    setBankState(prev => ({ ...prev, error: null }))
    send('poker_repay_loan', { bankId })
  }

  function setLoanAutoPay(bankId, amount) {
    const n = Math.max(0, Math.floor(Number(amount) || 0))
    send('poker_set_autopay', { bankId, amount: n })
  }

  // Zoom is actually applied by ZoomLayer in layout.jsx so the FuzzyBackground
  // canvas stays at viewport size regardless of zoom level. Here we just track
  // the value, persist it, and notify the layer via a custom event so it can
  // re-read localStorage and re-apply.
  //
  // Side effects (localStorage + dispatchEvent) live OUTSIDE the React state
  // setter so we never trigger another component's setState during this
  // component's update — React 19 warns about that pattern.
  function adjustZoom(delta) {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(pageZoom + delta)))
    if (next === pageZoom) return
    setPageZoom(next)
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, String(next))
      window.dispatchEvent(new Event('gwu:zoom-changed'))
    } catch {}
  }

  function resetZoom() {
    if (pageZoom === 100) return
    setPageZoom(100)
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, '100')
      window.dispatchEvent(new Event('gwu:zoom-changed'))
    } catch {}
  }

  function callBigYahu() {
    if (!bigYahuArmed) { setBigYahuArmed(true); return }
    send('poker_big_yahu')
    setBigYahuArmed(false)
    setActivePokerPanel(null)
  }

  function proposeBlinds(level) {
    send('poker_propose_blinds', { small: level.small, big: level.big })
  }

  function toggleContestMode(enabled, startingLevelId) {
    send('poker_toggle_contest_mode', { enabled, startingLevelId })
  }

  function setArenaRunningState(running) {
    send('poker_arena_set_running', { running: !!running })
  }

  function commitArenaStartingChips(value) {
    const n = Math.max(100, Math.min(1_000_000, Math.floor(Number(value) || 0)))
    if (n === arenaStartingChips) return
    send('poker_arena_set_starting_chips', { chips: n })
  }

  function voteOnBlindsProposal(vote) {
    if (!pendingBlindsProposal) return
    send('poker_blinds_vote', { proposalId: pendingBlindsProposal.proposalId, vote })
    if (vote === 'reject') setPendingBlindsProposal(null)
  }

  // "Back" on a Tools panel returns to the dropdown so you can pick another
  // tool without re-clicking the Tools button.
  function backToToolsMenu() {
    setActivePokerPanel(null)
    setTableMenuOpen(true)
  }

  function saveProfileChanges() {
    const name = (profileDraftName || '').trim().slice(0, 24)
    if (!name && !profileDraftAvatar) return
    send('update_profile', { username: name || undefined, avatarId: profileDraftAvatar || undefined })
    setActivePokerPanel(null)
  }

  function confirmReset() {
    if (!resetConfirmArmed) {
      setResetConfirmArmed(true)
      return
    }
    send('reset_money')
    setResetConfirmArmed(false)
    setActivePokerPanel(null)
  }

  async function refreshBotRoster() {
    setBotRoster(prev => ({ ...prev, loading: true, error: null }))
    try {
      const [mine, pub] = await Promise.all([
        authUser ? api.listMyBots() : Promise.resolve({ bots: [] }),
        api.listPublicBots()
      ])
      setBotRoster({ mine: mine.bots, public: pub.bots, loading: false, error: null })
    } catch (err) {
      setBotRoster(prev => ({ ...prev, loading: false, error: err.message || 'Failed to load' }))
    }
  }

  function addBotToTable(botId) {
    // Keep the panel open so the user can add multiple bots in a row.
    // The roster doesn't change after a successful add (each bot row stays
    // available), so this just removes a click between adds.
    send('add_bot', { botId })
  }

  // Maximum bots the arena pick queue holds before "Add" is required. The
  // table itself caps at 5 seated, so 5 is the natural ceiling.
  const MAX_ARENA_PICK = 5

  function arenaQueueAdd(botId) {
    setArenaPickQueue(prev => prev.length >= MAX_ARENA_PICK ? prev : [...prev, botId])
  }
  function arenaQueueRemoveAt(idx) {
    setArenaPickQueue(prev => prev.filter((_, i) => i !== idx))
  }
  function arenaQueueClear() { setArenaPickQueue([]) }
  function arenaQueueFlush() {
    for (const id of arenaPickQueue) send('add_bot', { botId: id })
    setArenaPickQueue([])
  }

  function removeBotFromTable(botSeatId) {
    send('remove_bot', { botSeatId })
  }

  function toggleStatsMode() {
    setStatsMode(prev => {
      const next = !prev
      if (next) setStatsExpansion('minimized')
      return next
    })
  }

  // Click outside the stats panel auto-minimizes it (instead of closing).
  // The panel stays mounted and visible — just shrinks to its compact pill.
  useEffect(() => {
    if (!statsMode) return
    if (statsExpansion === 'minimized') return
    function handlePointerDown(e) {
      if (statsPanelRef.current?.contains(e.target)) return
      setStatsExpansion('minimized')
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [statsMode, statsExpansion])

  // useCallback so the SpectatorPanel's React.memo can actually skip renders
  // when the parent re-renders for unrelated reasons (chat msg, sys msg, etc).
  const toggleSpectatorPlayer = useCallback((playerIdToToggle) => {
    // Toggling a single player turns off "reveal all" first, so the explicit
    // pick takes precedence over the master switch.
    setSpectatorRevealAll(false)
    setSpectatorVisibleIdSet(prev => {
      const next = new Set(prev)
      if (next.has(playerIdToToggle)) next.delete(playerIdToToggle)
      else next.add(playerIdToToggle)
      return next
    })
  }, [])

  const toggleSpectatorRevealAll = useCallback(() => {
    setSpectatorRevealAll(prev => {
      const next = !prev
      // Clear any per-player picks when flipping to "show all" so the UI
      // unambiguously reflects the master state.
      if (next) setSpectatorVisibleIdSet(new Set())
      return next
    })
  }, [])

  const toggleSpectatorBlind = useCallback(() => {
    setSpectatorBlindMode(prev => !prev)
    setSpectatorHoveredPlayerId(null)
  }, [])

  // Stable handler for the spectator-panel pause/start button. Reads the live
  // arenaRunning via a ref so this callback's identity never flips and
  // SpectatorPanel's memo can skip renders.
  const toggleArenaRunning = useCallback(() => {
    send('poker_arena_set_running', { running: !arenaRunningRef.current })
  }, [])


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
      <LobbyView
        connected={connected}
        joinMode={joinMode}
        setJoinMode={setJoinMode}
        inputCode={inputCode}
        setInputCode={setInputCode}
        username={username}
        persistUsername={persistUsername}
        selectedAvatarId={selectedAvatarId}
        selectAvatar={selectAvatar}
        tableList={tableList}
        authUser={authUser}
        authGateMessage={authGateMessage}
        setAuthGateMessage={setAuthGateMessage}
        send={send}
        joinPayload={joinPayload}
      />
    )
  }

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">
      
      {/* Top Header Row */}
      <div className="relative flex items-center justify-between mb-3 sm:mb-4 z-50 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3">
          {isArena && (
            <button
              type="button"
              onClick={() => openPokerPanel('arena')}
              title="Open arena controls"
              className={`text-xs sm:text-sm font-bold border px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm transition-transform active:scale-95 cursor-pointer ${arenaRunning ? 'bg-emerald-700/80 text-emerald-50 border-emerald-500/50 hover:bg-emerald-700/90' : 'bg-amber-700/70 text-amber-50 border-amber-500/50 hover:bg-amber-700/85'}`}
            >
              Arena {arenaRunning ? '· Live' : '· Paused'}
            </button>
          )}
          {isSpectator && !isArena && (
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
          <div ref={tableMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTableMenuOpen(prev => {
                const nextOpen = !prev
                if (nextOpen) setActivePokerPanel(null)
                return nextOpen
              })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
            >
              Tools
            </button>
            {tableMenuOpen && (
              <div className="absolute right-0 top-full mt-2 z-[100] w-56 overflow-hidden rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
                <button type="button" onClick={() => openPokerPanel('help')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                  How to Play
                </button>
                <button type="button" onClick={() => openPokerPanel('hand')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                  Current Hand
                </button>
                <button type="button" onClick={() => openPokerPanel('session')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                  Session History
                </button>
                {(!isSpectator || isArena) && (
                  <button type="button" onClick={() => openPokerPanel('bots')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                    Add Bot
                  </button>
                )}
                {!isSpectator && (
                  <button type="button" onClick={() => openPokerPanel('bank')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                    Bank Account
                  </button>
                )}
                {(!isSpectator || isArena) && (
                  <button type="button" onClick={() => openPokerPanel('blinds')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                    Change Blinds
                  </button>
                )}
                {(!isSpectator || isArena) && (
                  <button type="button" onClick={() => openPokerPanel('contest')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                    Contest Mode {contestMode?.enabled ? '· On' : ''}
                  </button>
                )}
                {isArena && (
                  <button type="button" onClick={() => openPokerPanel('arena')} className={`block w-full px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${arenaRunning ? 'text-emerald-200' : 'text-amber-200'}`}>
                    Arena · {arenaRunning ? 'Running' : 'Paused'}
                  </button>
                )}
                <button type="button" onClick={() => openPokerPanel('profile')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                  Edit Profile
                </button>
                <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-white">
                  <span>Zoom</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustZoom(-ZOOM_STEP)}
                      disabled={pageZoom <= ZOOM_MIN}
                      aria-label="Zoom out"
                      className="h-6 w-6 rounded-md border border-zinc-600/60 bg-zinc-800 text-sm font-black text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      −
                    </button>
                    <span className="min-w-[44px] text-center text-xs font-black tabular-nums">{pageZoom}%</span>
                    <button
                      type="button"
                      onClick={() => adjustZoom(ZOOM_STEP)}
                      disabled={pageZoom >= ZOOM_MAX}
                      aria-label="Zoom in"
                      className="h-6 w-6 rounded-md border border-zinc-600/60 bg-zinc-800 text-sm font-black text-white hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                  </div>
                </div>
                {!isSpectator && (
                  <button type="button" onClick={toggleStatsMode} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                    Table Stats {statsMode ? 'On' : 'Off'}
                  </button>
                )}
                {!isSpectator && (
                  <button type="button" onClick={() => openPokerPanel('reset')} className="block w-full px-3 py-2 text-left text-xs font-bold text-red-200 hover:bg-zinc-800">
                    Reset Money
                  </button>
                )}
                {!isSpectator && (
                  <button type="button" onClick={() => openPokerPanel('big_yahu')} className="block w-full px-3 py-2 text-left text-xs font-bold text-amber-200 hover:bg-zinc-800">
                    Call Big Yahu
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={clickLeaveTable}
            onBlur={() => {
              if (leaveTableArmTimerRef.current) clearTimeout(leaveTableArmTimerRef.current)
              leaveTableArmTimerRef.current = null
              setLeaveTableArmed(false)
            }}
            title="Leave the table and return to the lobby"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-black shadow-sm transition-colors active:scale-95 sm:px-3 sm:text-sm ${
              leaveTableArmed
                ? 'border-red-400/70 bg-red-700/90 hover:bg-red-600 text-white'
                : 'border-zinc-500/50 bg-zinc-800/80 hover:bg-zinc-700/90 text-white'
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
            <span className="hidden sm:inline">{leaveTableArmed ? 'Confirm leave' : 'Lobby'}</span>
          </button>
        </div>
      </div>

      {activePokerPanel && (
        <div ref={pokerPanelRef} className="fixed right-3 top-16 z-[90] max-h-[calc(100dvh-5rem)] w-[calc(100vw-1.5rem)] max-w-[460px] overflow-y-auto rounded-xl border border-zinc-600/60 bg-zinc-900/95 p-3 text-white shadow-2xl backdrop-blur-md sm:right-4 sm:top-20">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-black truncate">
              {activePokerPanel === 'help' ? 'How to Play'
                : activePokerPanel === 'hand' ? 'Current Hand'
                : activePokerPanel === 'bots' ? 'Add Bot'
                : activePokerPanel === 'bank' ? 'Bank Account'
                : activePokerPanel === 'profile' ? 'Edit Profile'
                : activePokerPanel === 'blinds' ? 'Change Blinds'
                : activePokerPanel === 'reset' ? 'Reset Money'
                : activePokerPanel === 'big_yahu' ? 'Call Big Yahu'
                : activePokerPanel === 'contest' ? 'Contest Mode'
                : activePokerPanel === 'arena' ? 'Bot Arena'
                : 'Session'}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={backToToolsMenu}
                className="rounded-md border border-zinc-600/60 px-2 py-1 text-xs font-black text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
                title="Back to Tools"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => setActivePokerPanel(null)}
                className="rounded-md border border-zinc-600/60 px-2 py-1 text-xs font-black text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>

          {activePokerPanel === 'help' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 text-xs font-black text-zinc-300">Table Basics</div>
                <div className="space-y-2 text-xs font-bold leading-relaxed text-zinc-400">
                  <p>Make the best five-card poker hand from your two cards and the five community cards.</p>
                  <p>Pre-flop starts after the blinds. Then the flop deals three cards, turn deals one, and river deals one.</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 bg-white text-[11px] font-black text-black">D</span>
                  <span className="text-xs font-bold text-zinc-400">Dealer button: action order rotates around this seat.</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ActionBadge action={{ action: 'sb', text: 'SB' }} />
                  <ActionBadge action={{ action: 'bb', text: 'BB' }} />
                  <span className="text-xs font-bold text-zinc-400">Blinds: forced bets that start the pot.</span>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 text-xs font-black text-zinc-300">Actions</div>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-zinc-400">
                  <div><span className="text-white">Fold</span>: give up the hand.</div>
                  <div><span className="text-white">Check</span>: pass when no bet is owed.</div>
                  <div><span className="text-white">Call</span>: match the current bet.</div>
                  <div><span className="text-white">Raise</span>: increase the price to continue.</div>
                  <div><span className="text-white">All In</span>: commit all remaining chips.</div>
                  <div><span className="text-white">Timer</span>: act within one minute or you are removed from the table.</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-black text-zinc-300">Hand Rankings</div>
                {HOW_TO_HANDS.map(hand => (
                  <div key={hand.name} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-xs font-black text-white">{hand.name}</div>
                      <div className="text-[10px] font-bold text-zinc-500">{hand.text}</div>
                    </div>
                    <div className="flex gap-1">
                      {hand.cards.map((card, index) => (
                        <CardSprite key={`${hand.name}-${index}`} card={card} className="w-8 sm:w-9" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePokerPanel === 'hand' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 text-xs font-black text-zinc-300">Your Cards</div>
                <div className="flex gap-1.5">
                  {(myCards.length ? myCards : [null, null]).map((card, index) => (
                    <CardSprite key={index} card={card} className="w-12 sm:w-14" />
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-zinc-300">Best Right Now</span>
                  <span className="text-xs font-black text-amber-200">{currentHandName}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-bold text-zinc-400">
                  <div>Pot <span className="text-white">{gameState?.pot || 0}</span></div>
                  <div>To call <span className="text-white">{Math.max(0, toCall)}</span></div>
                  <div>Phase <span className="text-white">{phase.toUpperCase()}</span></div>
                  <div>P/L <span className={profitClass(myPlayer?.profit || 0)}>{formatProfit(myPlayer?.profit || 0)}</span></div>
                </div>
              </div>
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 text-xs font-black text-zinc-300">Board</div>
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <CardSprite key={index} card={boardCards[index] || null} className="w-9 sm:w-10" />
                  ))}
                </div>
              </div>
            </div>
          )}

          {activePokerPanel === 'session' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2 text-center">
                  <div className="text-[10px] font-black text-zinc-500">Hands</div>
                  <div className="text-sm font-black text-white">{sessionSummary.hands}</div>
                </div>
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2 text-center">
                  <div className="text-[10px] font-black text-zinc-500">Wins</div>
                  <div className="text-sm font-black text-white">{sessionSummary.wins}</div>
                </div>
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2 text-center">
                  <div className="text-[10px] font-black text-zinc-500">Match P/L</div>
                  <div className={`text-sm font-black ${profitClass(sessionSummary.currentProfit)}`}>{formatProfit(sessionSummary.currentProfit)}</div>
                </div>
              </div>

              <div className="space-y-2">
                {sessionHands.length === 0 && (
                  <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-4 text-center text-xs font-bold text-zinc-500">
                    No hands recorded yet.
                  </div>
                )}
                {sessionHands.map(hand => (
                  <div key={hand.id} className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="truncate text-xs font-black text-white">{hand.handName}</div>
                      <div className={`shrink-0 text-xs font-black ${hand.result === 'Won' ? 'text-emerald-300' : hand.result === 'Folded' ? 'text-zinc-400' : 'text-red-300'}`}>
                        {hand.result}{hand.won ? ` +${hand.won}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex gap-1">
                        {(hand.cards || []).slice(0, 2).map((card, index) => (
                          <CardSprite key={index} card={card} className="w-7" />
                        ))}
                      </div>
                      <div className="truncate text-[10px] font-bold text-zinc-500">
                        {(hand.board || []).map(formatCard).filter(Boolean).join(' ')}
                      </div>
                    </div>
                    {hand.split && (
                      <div className="mt-1 text-[10px] font-black uppercase text-amber-200">Split pot</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activePokerPanel === 'bots' && (
            <div className="space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Picks one and the bot sits at this table with the same chip stack as you (1000 minimum).
              </div>

              {authUser && (
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setMyBotsExpanded(v => !v)}
                      className="flex flex-1 items-center gap-1.5 text-left"
                      aria-expanded={myBotsExpanded}
                    >
                      <span className={`text-xs font-black text-zinc-200 transition-transform ${myBotsExpanded ? 'rotate-90' : ''}`}>›</span>
                      <span className="text-xs font-black text-zinc-300">My Bots</span>
                      <span className="text-[10px] font-bold text-zinc-500">({botRoster.mine.length})</span>
                    </button>
                    <Link href="/poker/bots" className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">
                      Manage →
                    </Link>
                  </div>
                  {myBotsExpanded && (
                    <div className="mt-2">
                      {botRoster.loading ? (
                        <div className="text-xs font-bold text-zinc-500 text-center py-2">Loading…</div>
                      ) : botRoster.mine.length === 0 ? (
                        <div className="text-xs font-bold text-zinc-500 text-center py-2">No bots yet. Build one in My Bots.</div>
                      ) : (
                        <div className="space-y-1.5">
                          {botRoster.mine.map(b => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => addBotToTable(b.id)}
                              className="flex w-full items-center gap-2 rounded-md border border-zinc-700/70 bg-zinc-900/60 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/80"
                            >
                              <BotAvatar name={b.name} color={b.color} textColor={b.textColor} size={28} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-black text-white">{b.name}</div>
                                <div className="truncate text-[10px] font-bold text-zinc-500">ELO {b.elo}</div>
                              </div>
                              <span className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-0.5 text-[10px] font-bold text-white">Add</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-black text-zinc-300">Public Roster</div>
                  <button
                    type="button"
                    onClick={refreshBotRoster}
                    className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-zinc-600"
                  >
                    Refresh
                  </button>
                </div>
                {botRoster.loading ? (
                  <div className="text-xs font-bold text-zinc-500 text-center py-2">Loading…</div>
                ) : botRoster.error ? (
                  <div className="text-xs font-bold text-red-300 text-center py-2">{botRoster.error}</div>
                ) : botRoster.public.length === 0 ? (
                  <div className="text-xs font-bold text-zinc-500 text-center py-2">No public bots yet.</div>
                ) : (
                  <div className="space-y-1.5">
                    {botRoster.public.map(b => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => addBotToTable(b.id)}
                        className="flex w-full items-center gap-2 rounded-md border border-zinc-700/70 bg-zinc-900/60 px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/80"
                      >
                        <BotAvatar name={b.name} color={b.color} textColor={b.textColor} size={28} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-black text-white">{b.name}</div>
                          <div className="truncate text-[10px] font-bold text-zinc-500">
                            ELO {b.elo} · BY {(b.ownerDisplayName || 'UNKNOWN').toUpperCase()}
                          </div>
                        </div>
                        <span className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-0.5 text-[10px] font-bold text-white">Add</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activePokerPanel === 'bank' && (() => {
            const score = bankState.creditScore ?? 700
            const maxLoans = bankState.maxLoans ?? 2
            const peakSwing = bankState.peakSwing ?? 0
            const slotsUsed = bankState.loans?.length ?? 0
            const slotsLeft = Math.max(0, maxLoans - slotsUsed)
            const totalOwed = (bankState.loans || []).reduce((sum, l) => sum + (l.owed || 0), 0)
            const nextTier = nextUnlockTier(peakSwing)
            const handsAt = bankState.handsAtSession ?? 0
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Credit</div>
                      <div className={`text-base font-black ${creditScoreColorClass(score)}`}>{score}</div>
                      <div className="text-[10px] font-bold text-zinc-300">{creditScoreLabel(score)}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Slots</div>
                      <div className="text-base font-black text-white">{slotsUsed}/{maxLoans}</div>
                      <div className="text-[10px] font-bold text-zinc-300">{slotsLeft} open</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Owed</div>
                      <div className="text-base font-black text-amber-300">${totalOwed.toLocaleString()}</div>
                      <div className="text-[10px] font-bold text-zinc-300">+ interest</div>
                    </div>
                  </div>
                  {nextTier ? (
                    <div className="text-[11px] font-bold text-zinc-300 leading-snug">
                      Swing your P/L by <span className="text-emerald-300">${(nextTier.swingAtLeast - peakSwing).toLocaleString()}</span> more
                      (in either direction) to unlock <span className="text-emerald-300">{nextTier.maxLoans}</span> total slots.
                    </div>
                  ) : (
                    <div className="text-[11px] font-bold text-emerald-300">All 20 banks unlocked. The market is yours.</div>
                  )}
                  <div className="text-[10px] font-bold text-zinc-400 leading-snug">
                    Each loan: ${LOAN_AMOUNT.toLocaleString()} principal. Interest accrues every hand at 1/{LOAN_INTEREST_HAND_INTERVAL} of the loan's locked-in rate.
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">Lifetime stats</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Borrowed</div>
                      <div className="text-sm font-black text-white">${(bankState.lifetimeBorrowed ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Interest paid</div>
                      <div className="text-sm font-black text-amber-300">${(bankState.lifetimeInterestPaid ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Credit low</div>
                      <div className={`text-sm font-black ${creditScoreColorClass(bankState.creditScoreMin ?? score)}`}>{bankState.creditScoreMin ?? score}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Credit high</div>
                      <div className={`text-sm font-black ${creditScoreColorClass(bankState.creditScoreMax ?? score)}`}>{bankState.creditScoreMax ?? score}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-bold text-zinc-300">
                    <div>Peak |P/L| swing: <span className="text-zinc-100">${(bankState.peakSwing ?? 0).toLocaleString()}</span></div>
                    <div>Hands at table: <span className="text-zinc-100">{bankState.handsAtSession ?? 0}</span></div>
                    <div>Big Yahu calls: <span className="text-amber-200">{bankState.bigYahuCalls ?? 0}</span></div>
                    <div>Active loans: <span className="text-zinc-100">{slotsUsed}</span></div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {BANKS.map(bank => {
                    const loan = (bankState.loans || []).find(l => l.bankId === bank.id)
                    const used = !!loan
                    const slotFull = !used && slotsUsed >= maxLoans
                    const rate = used ? loan.interestRate : effectiveLoanRate(bank, score)
                    return (
                      <div
                        key={bank.id}
                        className={`rounded-md border px-3 py-2 ${
                          used
                            ? 'border-emerald-500/50 bg-emerald-500/10'
                            : slotFull
                              ? 'border-zinc-700/70 bg-zinc-950/40 opacity-60'
                              : 'border-zinc-600/60 bg-zinc-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-white truncate">{bank.name}</span>
                              <span className={`shrink-0 rounded border px-1 py-px text-[9px] font-black uppercase tracking-widest ${
                                rate <= 0.04 ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                                : rate <= 0.08 ? 'border-zinc-600/60 bg-zinc-900 text-zinc-200'
                                : rate <= 0.15 ? 'border-amber-500/40 bg-amber-500/15 text-amber-200'
                                : 'border-red-500/40 bg-red-500/15 text-red-200'
                              }`}>
                                {(rate * 100).toFixed(1)}%
                              </span>
                              {used && loan.perTurnInterest > 0 && (
                                <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-px text-[9px] font-black uppercase tracking-widest text-amber-200">
                                  +${loan.perTurnInterest.toLocaleString()}/turn
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-bold text-zinc-300 truncate">
                              {used
                                ? `Owed $${loan.owed.toLocaleString()} · principal $${(loan.principal || 0).toLocaleString()} of $${loan.originalPrincipal.toLocaleString()}`
                                : bank.tagline}
                            </div>
                          </div>
                          {used ? (
                            <button
                              type="button"
                              onClick={() => repayLoan(bank.id)}
                              className="shrink-0 rounded-md border border-emerald-500/50 bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-emerald-500"
                            >
                              Pay ${loan.owed.toLocaleString()}
                            </button>
                          ) : slotFull ? (
                            <span className="shrink-0 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-200">
                              Slots full
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => takeLoan(bank.id)}
                              className="shrink-0 rounded-md border border-zinc-500/60 bg-zinc-700 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white hover:bg-zinc-600"
                            >
                              Take $10k
                            </button>
                          )}
                        </div>
                        {used && (
                          <LoanAutoPayRow
                            loan={loan}
                            onCommit={(amount) => setLoanAutoPay(bank.id, amount)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {activePokerPanel === 'blinds' && (() => {
            const currentSmall = gameState?.smallBlind ?? 5
            const currentBig = gameState?.bigBlind ?? 10
            const seatedHumans = (gameState?.players || []).filter(p => p && !p.isBot && p.isConnected !== false).length
            const humansWithMe = Math.max(seatedHumans, 1)
            const needs = humansWithMe <= 1 ? 1 : (humansWithMe === 5 ? 3 : 2)
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Current blinds</div>
                  <div className="text-base font-black text-white">${currentSmall.toLocaleString()} / ${currentBig.toLocaleString()}</div>
                  <div className="text-[10px] font-bold text-zinc-300 leading-snug">
                    {humansWithMe <= 1
                      ? 'You\'re alone with bots — your pick applies instantly.'
                      : `${humansWithMe} humans at the table. Need ${needs}/${humansWithMe} approvals to change.`}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {BLIND_LEVELS.map(level => {
                    const isCurrent = level.small === currentSmall && level.big === currentBig
                    return (
                      <button
                        key={level.id}
                        type="button"
                        disabled={isCurrent}
                        onClick={() => proposeBlinds(level)}
                        className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                          isCurrent
                            ? 'border-emerald-500/50 bg-emerald-500/15 opacity-90'
                            : 'border-zinc-600/60 bg-zinc-900 hover:bg-zinc-800'
                        }`}
                      >
                        <div>
                          <div className="text-sm font-black text-white">${level.small.toLocaleString()} / ${level.big.toLocaleString()}</div>
                          <div className="text-[10px] font-bold text-zinc-300">
                            {level.small <= 10 ? 'Casual'
                              : level.small <= 50 ? 'Mid stakes'
                              : level.small <= 200 ? 'High stakes'
                              : level.small <= 500 ? 'Whale tank'
                              : 'Degenerate territory'}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                          isCurrent
                            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
                            : 'border-zinc-500/60 bg-zinc-700 text-white'
                        }`}>
                          {isCurrent ? 'Current' : humansWithMe <= 1 ? 'Apply' : 'Propose'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {activePokerPanel === 'arena' && (() => {
            const seatedBots = (gameState?.players || []).filter(p => p && p.isBot)
            const currentSmall = gameState?.smallBlind ?? 5
            const currentBig = gameState?.bigBlind ?? 10
            const cm = contestMode || {}
            return (
              <div className="space-y-3">
                {/* Status + start/stop */}
                <div className={`rounded-lg border p-3 ${arenaRunning ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-[10px] font-black uppercase tracking-widest ${arenaRunning ? 'text-emerald-200' : 'text-amber-200'}`}>
                      {arenaRunning ? '● Match running' : '○ Match paused'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setArenaRunningState(!arenaRunning)}
                      className={`rounded-md px-3 py-1.5 text-xs font-black transition-colors border ${arenaRunning
                        ? 'border-amber-400/60 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100'
                        : 'border-emerald-400/60 bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                    >
                      {arenaRunning ? 'Stop' : 'Start'}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-zinc-100 leading-snug">
                    {arenaRunning ? 'Pause to safely change blinds or roster.' : 'Configure below, then start.'}
                  </div>
                </div>

                {/* Roster: seated bots + inline add */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Bots ({seatedBots.length})</span>
                    <Link href="/poker/bots" className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">Manage →</Link>
                  </div>
                  {seatedBots.length === 0 ? (
                    <div className="text-[11px] font-bold text-zinc-500 text-center py-2">No bots yet — add some below.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {seatedBots.map(b => (
                        <span key={b.id} className="inline-flex items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-900/60 pl-1 pr-0.5 py-0.5">
                          <BotAvatar name={b.username} color={b.botColor} textColor={b.botTextColor} size={18} />
                          <span className="max-w-[90px] truncate text-[10px] font-black text-white">{b.username}</span>
                          <button
                            type="button"
                            onClick={() => removeBotFromTable(b.id)}
                            className="ml-0.5 rounded px-1 text-[10px] font-black text-red-200 hover:bg-red-500/20"
                            title="Remove bot"
                            aria-label={`Remove ${b.username}`}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Multi-pick: tap a bot to push it onto the queue. Same bot
                      can be queued multiple times. Hit "Add N bots" to commit. */}
                  {(() => {
                    // Dedupe roster: each bot shows once. If the user owns it,
                    // tag with `owned` so the row renders the MINE pill —
                    // public list often contains the user's own public bots,
                    // which would otherwise appear twice.
                    const mineIds = new Set(botRoster.mine.map(b => b.id))
                    const seen = new Set()
                    const combinedRoster = []
                    for (const b of botRoster.mine) {
                      if (seen.has(b.id)) continue
                      seen.add(b.id)
                      combinedRoster.push({ ...b, owned: true })
                    }
                    for (const b of botRoster.public) {
                      if (seen.has(b.id)) continue
                      seen.add(b.id)
                      combinedRoster.push({ ...b, owned: mineIds.has(b.id) })
                    }
                    const rosterIndex = new Map(combinedRoster.map(b => [b.id, b]))
                    const queueFull = arenaPickQueue.length >= MAX_ARENA_PICK
                    return (
                      <div className="space-y-2">
                        {/* Queue */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
                            Queue ({arenaPickQueue.length}/{MAX_ARENA_PICK})
                          </span>
                          {arenaPickQueue.length > 0 && (
                            <button
                              type="button"
                              onClick={arenaQueueClear}
                              className="text-[10px] font-bold text-zinc-400 hover:text-white"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        <div className="min-h-[28px] flex flex-wrap gap-1.5 rounded-md border border-zinc-700/70 bg-zinc-900/50 px-2 py-1.5">
                          {arenaPickQueue.length === 0 && (
                            <span className="text-[10px] font-bold text-zinc-500 self-center">Tap bots below to queue them.</span>
                          )}
                          {arenaPickQueue.map((id, i) => {
                            const b = rosterIndex.get(id)
                            return (
                              <span key={`${id}-${i}`} className="inline-flex items-center gap-1 rounded border border-zinc-600/60 bg-zinc-800 pl-1 pr-0.5 py-0.5">
                                {b && <BotAvatar name={b.name} color={b.color} textColor={b.textColor} size={16} />}
                                <span className="max-w-[80px] truncate text-[10px] font-black text-white">{b?.name || 'bot'}</span>
                                <button
                                  type="button"
                                  onClick={() => arenaQueueRemoveAt(i)}
                                  className="ml-0.5 rounded px-1 text-[10px] font-black text-red-200 hover:bg-red-500/20"
                                  aria-label="Remove from queue"
                                >×</button>
                              </span>
                            )
                          })}
                        </div>

                        {/* Roster — combined list, click to queue */}
                        <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                          {botRoster.loading && (
                            <div className="text-[10px] font-bold text-zinc-500 text-center py-1">Loading roster…</div>
                          )}
                          {!botRoster.loading && combinedRoster.length === 0 && (
                            <div className="text-[10px] font-bold text-zinc-500 text-center py-1">No bots available.</div>
                          )}
                          {combinedRoster.map(b => (
                            <button
                              key={b.id}
                              type="button"
                              disabled={queueFull}
                              onClick={() => arenaQueueAdd(b.id)}
                              className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors disabled:opacity-40 ${
                                b.owned
                                  ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/15'
                                  : 'border-zinc-700/70 bg-zinc-900/60 hover:bg-zinc-800/80'
                              }`}
                            >
                              <BotAvatar name={b.name} color={b.color} textColor={b.textColor} size={20} />
                              <span className="min-w-0 flex-1 truncate text-[11px] font-black text-white">{b.name}</span>
                              <span className={`shrink-0 text-[9px] font-bold ${b.owned ? 'text-emerald-200' : 'text-zinc-400'}`}>
                                {b.owned ? `MINE · ELO ${b.elo}` : `ELO ${b.elo}`}
                              </span>
                              <span className="shrink-0 rounded border border-zinc-500/50 bg-zinc-700 px-1.5 py-0.5 text-[10px] font-black text-white">+</span>
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={arenaQueueFlush}
                          disabled={arenaPickQueue.length === 0}
                          className="w-full rounded-md border border-emerald-400/60 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-2 text-xs font-black text-white"
                        >
                          {arenaPickQueue.length === 0 ? 'Pick bots to add' : `Add ${arenaPickQueue.length} bot${arenaPickQueue.length === 1 ? '' : 's'}`}
                        </button>
                      </div>
                    )
                  })()}
                </div>

                {/* Blinds — compact horizontal chooser. Arena spectators apply instantly. */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Blinds</span>
                    <span className="text-[10px] font-bold text-zinc-400">${currentSmall.toLocaleString()} / ${currentBig.toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {BLIND_LEVELS.map(level => {
                      const isCurrent = level.small === currentSmall && level.big === currentBig
                      return (
                        <button
                          key={level.id}
                          type="button"
                          disabled={isCurrent}
                          onClick={() => proposeBlinds(level)}
                          className={`rounded-md border px-2 py-1.5 text-[11px] font-black transition-colors ${
                            isCurrent
                              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 cursor-default'
                              : 'border-zinc-600/60 bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          ${level.small.toLocaleString()}/${level.big.toLocaleString()}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Contest mode — single-row toggle + level picker only when active. */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Contest mode</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${cm.enabled ? 'text-amber-200' : 'text-zinc-500'}`}>
                      {cm.enabled ? '● ON' : 'OFF'}
                    </span>
                  </div>
                  {cm.enabled ? (
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold text-zinc-300 leading-snug">
                        Bumps every {cm.handsPerLevel ?? 10} hands.
                        {cm.nextLevel
                          ? <> Next: <span className="text-amber-300">${cm.nextLevel.small}/${cm.nextLevel.big}</span> in <span className="text-amber-300">{cm.handsUntilNextLevel ?? '?'}</span> hand{cm.handsUntilNextLevel === 1 ? '' : 's'}.</>
                          : <> Max level reached.</>}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleContestMode(false)}
                        className="w-full rounded-md border border-red-500/60 bg-red-500/15 px-2 py-1.5 text-[11px] font-black text-red-100 hover:bg-red-500/25"
                      >
                        Stop contest mode
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-zinc-400">Pick a starting tier — blinds escalate every {cm.handsPerLevel ?? 10} hands.</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {BLIND_LEVELS.map(level => (
                          <button
                            key={level.id}
                            type="button"
                            onClick={() => toggleContestMode(true, level.id)}
                            className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-[11px] font-black text-white hover:bg-zinc-800"
                          >
                            ${level.small.toLocaleString()}/${level.big.toLocaleString()}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Starting chips for new bots */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Bot starting chips</span>
                    <span className="text-[10px] font-bold text-zinc-400">$100 – $1,000,000</span>
                  </div>
                  <ArenaStartingChipsInput
                    value={arenaStartingChips}
                    onCommit={commitArenaStartingChips}
                  />
                  <div className="mt-1 text-[10px] font-bold text-zinc-400">
                    Applies to bots added next. Existing bots keep their stack.
                  </div>
                </div>
              </div>
            )
          })()}

          {activePokerPanel === 'contest' && (() => {
            const cm = contestMode || {}
            const cur = cm.currentLevel
            const next = cm.nextLevel
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-200 mb-1">
                    {cm.enabled ? '● ACTIVE' : 'OFF'}
                  </div>
                  {cm.enabled ? (
                    <div className="text-xs font-bold text-zinc-100 leading-snug space-y-1">
                      <div>
                        Currently at <span className="text-emerald-300">${cur?.small ?? '—'}/${cur?.big ?? '—'}</span>
                        {next && (
                          <> · next bump to <span className="text-amber-300">${next.small}/${next.big}</span> in <span className="text-amber-300">{cm.handsUntilNextLevel ?? '?'}</span> hand{cm.handsUntilNextLevel === 1 ? '' : 's'}.</>
                        )}
                        {!next && <> · max blind level reached.</>}
                      </div>
                      <div className="text-[10px] font-bold text-zinc-300">
                        Blinds bump every {cm.handsPerLevel ?? 10} hands. Multi-human tables vote on each escalation.
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-zinc-100 leading-snug">
                      Pick a starting blind level. Every {cm.handsPerLevel ?? 10} hands the blinds escalate to the next tier.
                      Tables with multiple humans get the same proposal/vote flow as a manual blind change.
                    </div>
                  )}
                </div>

                {!cm.enabled && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Start at</div>
                    {BLIND_LEVELS.map(level => (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => toggleContestMode(true, level.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-600/60 bg-zinc-900 px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                      >
                        <span className="text-sm font-black text-white">${level.small.toLocaleString()} / ${level.big.toLocaleString()}</span>
                        <span className="rounded-md border border-emerald-500/50 bg-emerald-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                          Start
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {cm.enabled && (
                  <button
                    type="button"
                    onClick={() => toggleContestMode(false)}
                    className="w-full rounded-md border border-red-500/60 bg-red-500/15 px-3 py-2.5 text-sm font-black text-red-100 hover:bg-red-500/25"
                  >
                    Stop contest mode
                  </button>
                )}
              </div>
            )
          })()}

          {activePokerPanel === 'big_yahu' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-200">
                  ☎ Calling Benjamin Netanyahu
                </div>
                <div className="text-xs font-bold text-zinc-100 leading-snug space-y-1.5">
                  <div>The Prime Minister picks up. After 30 seconds of small talk:</div>
                  <ul className="ml-4 list-disc space-y-0.5 text-zinc-200">
                    <li>Every outstanding loan is forgiven — you keep the chips.</li>
                    <li>Your credit score is restored to default.</li>
                    <li>Your P/L is wiped to <span className="text-emerald-300">$0</span> (your stack stays).</li>
                    <li>Bank slot tier resets to 2 — but you can climb again.</li>
                    <li>You permanently unlock <span className="text-amber-200">✡️</span> and <span className="text-amber-200">🇮🇱</span> in your emote palette.</li>
                  </ul>
                </div>
                <div className="mt-2 text-[10px] font-bold text-zinc-300">
                  Blocked while you're contesting a hand — fold or finish first.
                </div>
              </div>
              <button
                type="button"
                onClick={callBigYahu}
                onBlur={() => setBigYahuArmed(false)}
                className={`w-full rounded-md px-3 py-2.5 text-sm font-black transition-all border ${
                  bigYahuArmed
                    ? 'bg-amber-500 hover:bg-amber-400 border-amber-300/70 text-zinc-900 animate-pulse'
                    : 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/50 text-amber-100'
                }`}
              >
                {bigYahuArmed ? 'Click again to dial Big Yahu' : '☎ Call Big Yahu'}
              </button>
            </div>
          )}

          {activePokerPanel === 'profile' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-emerald-200">Username</div>
                <input
                  className="w-full rounded-md border border-zinc-600/60 bg-zinc-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-zinc-300"
                  placeholder="Your handle"
                  maxLength={24}
                  value={profileDraftName}
                  onChange={e => setProfileDraftName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveProfileChanges()}
                />
              </div>
              <ProfileSelector value={profileDraftAvatar || selectedAvatarId} onChange={setProfileDraftAvatar} />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActivePokerPanel(null)}
                  className="rounded-md border border-zinc-500/60 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveProfileChanges}
                  className="rounded-md border border-emerald-400/60 bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {activePokerPanel === 'reset' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3">
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-red-200">Wipe & restart</div>
                <div className="text-xs font-bold text-zinc-100 leading-snug">
                  Resets your chips back to <span className="text-emerald-300">${(1000).toLocaleString()}</span>,
                  clears every line of credit, and zeroes out your P/L for this session.
                  Other players keep their stacks.
                </div>
                <div className="mt-2 text-[10px] font-bold text-zinc-300">
                  Blocked while you're contesting a hand — fold or finish first.
                </div>
              </div>
              <button
                type="button"
                onClick={confirmReset}
                onBlur={() => setResetConfirmArmed(false)}
                className={`w-full rounded-md px-3 py-2.5 text-sm font-black transition-all border ${
                  resetConfirmArmed
                    ? 'bg-red-600 hover:bg-red-500 border-red-300/70 text-white animate-pulse'
                    : 'bg-red-500/15 hover:bg-red-500/25 border-red-500/50 text-red-100'
                }`}
              >
                {resetConfirmArmed ? 'Click again to confirm reset' : 'Reset all money'}
              </button>
            </div>
          )}
        </div>
      )}

      {pendingBlindsProposal && !isSpectator && (
        <div className="fixed left-1/2 top-16 z-[110] w-[calc(100vw-1.5rem)] max-w-[460px] -translate-x-1/2 rounded-xl border border-amber-400/60 bg-zinc-900/98 p-3 text-white shadow-2xl backdrop-blur-md">
          <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-200">
            Blinds change requested
          </div>
          <div className="text-sm font-black text-white mb-1">
            {pendingBlindsProposal.proposerName} wants to set blinds to ${pendingBlindsProposal.small}/${pendingBlindsProposal.big}.
          </div>
          <div className="text-[10px] font-bold text-zinc-300 mb-3">
            Approvals: {pendingBlindsProposal.approvalsCount}/{pendingBlindsProposal.approvalsNeeded} of {pendingBlindsProposal.humanCount} humans.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => voteOnBlindsProposal('approve')}
              className="flex-1 rounded-md border border-emerald-400/60 bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-500"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => voteOnBlindsProposal('reject')}
              className="flex-1 rounded-md border border-red-500/60 bg-red-600/80 px-3 py-2 text-xs font-black text-white hover:bg-red-500"
            >
              Reject
            </button>
          </div>
        </div>
      )}

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
            // Arenas don't enforce a turn timer (bots can't be kicked), so the
            // red "running out of time" pulse never makes sense there — keep
            // the active highlight amber.
            const isTurnWarning = isActive && isActiveTurnWarning && !isArena
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
            const explicitSpectatorVisible = spectatorRevealAll || spectatorVisibleIdSet.has(player.id)
            const spectatorCanRevealCards = isSpectator &&
              !spectatorBlindMode &&
              !isPlayerWaiting &&
              (explicitSpectatorVisible || spectatorHoveredPlayerId === player.id)
            const visibleCards = isSpectator && player.cards?.length
              ? (spectatorCanRevealCards ? player.cards : player.cards.map(() => null))
              : player.cards

            return (
              <div key={player.id} className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center min-w-[120px] sm:min-w-[140px] ${seatIndex === 0 ? 'mt-8 lg:mt-0' : ''}`} style={{ top: pos.top, left: pos.left }}>
                
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

                  {/* Uniform Nameplate styling — explicit min-width so corner
                      seats (left:5%/95%) don't get squished by the parent's
                      overflow-x-hidden context. */}
                  <div className={`
                    px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-center w-[120px] sm:w-[140px] shadow-xl
                    transition-all border z-10 relative bg-zinc-800/95
                    ${player.folded && !isPlayerWaiting ? 'opacity-50' : ''}
                    ${isPlayerWaiting ? 'opacity-60' : ''}
                    ${isActive
                      ? isTurnWarning
                        ? 'ring-4 ring-red-400 border-red-400/80 shadow-[0_0_30px_rgba(239,68,68,0.85)] bg-red-950/70'
                        : 'ring-4 ring-amber-300 border-amber-300/80 shadow-[0_0_28px_rgba(251,191,36,0.85)] bg-amber-900/40'
                      : 'border-zinc-600/50'}
                  `}>
                    <SeatEmotes
                      emotes={playerEmotes}
                      className="absolute -top-3 -left-2 sm:-top-3.5 sm:-left-2.5 z-40"
                    />
                    {isActive && (
                      <div className={`absolute -top-4 sm:-top-5 left-1/2 -translate-x-1/2 text-xs sm:text-sm animate-bounce ${isTurnWarning ? 'text-red-500' : 'text-amber-400'}`}>▼</div>
                    )}
                    <div className="text-[10px] sm:text-sm font-bold truncate text-white flex items-center justify-center gap-1 whitespace-nowrap">
                      {isMe ? 'You' : player.username}
                      {player.isBot && (
                        <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-zinc-400">BOT</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[9px] sm:text-xs text-zinc-200 font-medium whitespace-nowrap">
                      {player.isBot ? (
                        <BotAvatar name={player.username} color={player.botColor || '#3b82f6'} textColor={player.botTextColor || 'auto'} size={24} className="h-5 w-5 sm:h-6 sm:w-6" />
                      ) : (
                        <ProfileAvatar
                          avatarId={player.avatarId}
                          avatarUrl={player.avatarUrl}
                          className="h-5 w-5 sm:h-6 sm:w-6"
                        />
                      )}
                      {isPlayerWaiting ? (
                        <span className="text-zinc-400 font-bold italic">Waiting...</span>
                      ) : phase === 'showdown' && handName && !player.folded ? (
                        <span className="text-amber-300 font-bold">{handName}</span>
                      ) : (
                        `${player.chips} chips`
                      )}
                    </div>
                    {player.isBot && player.addedByPlayerId === playerId && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeBotFromTable(player.id) }}
                        className="mt-1 rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-red-200 hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    )}
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
          revealAll={spectatorRevealAll}
          visiblePlayerIds={spectatorVisiblePlayerIds}
          activePlayerId={gameState?.activePlayerId || null}
          isArena={isArena}
          arenaRunning={arenaRunning}
          onToggleArenaRunning={toggleArenaRunning}
          onToggleBlind={toggleSpectatorBlind}
          onToggleRevealAll={toggleSpectatorRevealAll}
          onTogglePlayer={toggleSpectatorPlayer}
        />
      )}

      <AchievementToast
        achievement={achievement}
        onDismiss={() => setAchievement(null)}
      />

      {/* Natural Flow Bottom UI */}
      <div className={`w-full flex flex-col md:flex-row justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto ${isSpectator ? 'pb-[310px] md:pb-0 md:min-h-[210px]' : 'pb-4 md:pb-0'}`}>
        
        {/* Actions Panel — fixed-size chrome regardless of turn so the rest
            of the layout doesn't shift between waiting and acting. */}
        {!isSpectator && (() => {
          const inHand = phase !== 'waiting' && phase !== 'showdown' && !myPlayer?.folded && !isWaitingNextHand
          const canAct = inHand && isMyTurn
          const hasRaiseRoom = (myPlayer?.chips ?? 0) > minRaise
          const statusText = phase === 'waiting'
            ? ((gameState?.players?.length ?? 0) <= 1 ? 'Waiting for others to join…' : 'Waiting for players…')
            : phase === 'showdown'
              ? 'Showdown'
              : myPlayer?.folded
                ? 'You folded. Hang tight for next hand.'
                : isWaitingNextHand
                  ? 'Sitting out this hand. You will join the next round.'
                  : isMyTurn
                    ? '● YOUR TURN'
                    : `Waiting for ${gameState?.players?.find((p) => p.id === gameState.activePlayerId)?.username || '...'}`
          const statusClass = isMyTurn && inHand
            ? 'text-amber-400 animate-pulse'
            : myPlayer?.folded || isWaitingNextHand
              ? 'text-amber-300'
              : 'text-zinc-300'
          const safeRaise = raiseAmount < minRaise ? minRaise : raiseAmount

          return (
        <div className="w-[92%] max-w-[360px] md:w-[360px] md:max-w-none shrink-0">
          <div className="flex flex-col gap-2 py-3 px-4 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md min-h-[176px]">
            <div className={`text-[9px] sm:text-[10px] font-black tracking-widest text-center ${statusClass}`}>
              {statusText}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => send('poker_fold')}
                disabled={!canAct}
                className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
              >
                Fold
              </button>
              {toCall === 0 ? (
                <button
                  onClick={() => send('poker_check')}
                  disabled={!canAct}
                  className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
                >
                  Check
                </button>
              ) : (
                <button
                  onClick={() => send('poker_call')}
                  disabled={!canAct}
                  className="px-2 py-1.5 rounded-md text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
                >
                  Call {Math.min(toCall, myPlayer?.chips || 0)}
                </button>
              )}
              <button
                onClick={clickAllIn}
                disabled={!canAct}
                onBlur={() => {
                  if (allInArmTimerRef.current) clearTimeout(allInArmTimerRef.current)
                  allInArmTimerRef.current = null
                  setAllInArmed(false)
                }}
                className={`col-span-2 px-2 py-1.5 rounded-md text-xs font-bold transition-all border text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                  allInArmed && canAct
                    ? 'bg-red-600 hover:bg-red-500 border-red-300/70 animate-pulse'
                    : 'bg-amber-600 hover:bg-amber-500 border-amber-400/50 disabled:hover:bg-amber-600'
                }`}
              >
                {allInArmed && canAct ? `Confirm All In · ${myPlayer?.chips || 0}` : 'All In'}
              </button>
            </div>

            {/* Always-rendered raise row — disabled when we can't act or stack
                is too small to legally raise. Stays visible so the panel size
                doesn't pop in/out between turns. */}
            <div className={`flex items-center gap-2 w-full mt-0.5 ${(!canAct || !hasRaiseRoom) ? 'opacity-40' : ''}`}>
              <input
                type="range"
                min={minRaise}
                max={myPlayer?.chips || minRaise}
                step={Math.max(5, Math.floor(tableBigBlind / 2))}
                value={safeRaise}
                onChange={e => setRaiseAmount(parseInt(e.target.value))}
                disabled={!canAct || !hasRaiseRoom}
                className="flex-1 accent-white h-1 bg-zinc-900 rounded-full disabled:cursor-not-allowed"
              />
              <button
                onClick={() => send('poker_raise', { amount: safeRaise })}
                disabled={!canAct || !hasRaiseRoom}
                className="px-2 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
              >
                Raise {safeRaise}
              </button>
            </div>
          </div>
          {canUseEmotes && (
            <>
              <div className={`grid gap-1.5 mt-2 py-2 px-2 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md ${
                (bankState.bigYahuCalls ?? 0) > 0 ? 'grid-cols-8' : 'grid-cols-6'
              }`}>
                {getEmoteOptions({ bigYahuUnlocked: (bankState.bigYahuCalls ?? 0) > 0 }).map((emote) => (
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
                  onChange={e => { setYellInput(e.target.value); if (yellHistoryIndex !== -1) setYellHistoryIndex(-1) }}
                  onKeyDown={onYellKeyDown}
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
        </div>
          )
        })()}

        {/* Stats panel — fixed top-right under Tools/Lobby. Click outside the
            panel auto-minimizes it (handled by a useEffect above) so it never
            shifts other UI around. The Close button exits entirely. */}
        {!isSpectator && statsMode && (
          <div
            ref={statsPanelRef}
            className={`fixed right-4 top-14 z-40 ${
              statsExpansion === 'minimized'
                ? 'w-[180px]'
                : statsExpansion === 'detailed'
                  ? 'w-[calc(100vw-2rem)] max-w-[420px]'
                  : 'w-[calc(100vw-2rem)] max-w-[320px]'
            }`}
          >
            <StatsPanel
              statistics={statistics}
              expansion={statsExpansion}
              onSetExpansion={setStatsExpansion}
              onClose={() => {
                setStatsMode(false)
                setStatsExpansion('minimized')
              }}
            />
          </div>
        )}

        {/* Chat Panel */}
        <div className={`${isSpectator ? 'fixed bottom-3 right-3 z-40 w-[calc(100vw-1.5rem)] max-w-[320px] sm:bottom-4 sm:right-4 md:w-[320px]' : 'w-[92%] max-w-[360px] md:w-[280px] md:max-w-none'} flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
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
