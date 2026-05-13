'use client'

import { useEffect, useRef, useState, useCallback, useMemo, useDeferredValue, startTransition } from 'react'
import PokerChip from '../components/PokerChip'
import CardSprite from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes, SeatYells, getEmoteOptions } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'
import HomeBackLink from '../components/HomeBackLink'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout. The table header keeps the Tools and
// Lobby buttons but no longer renders the account/messages cluster.
import AuthGateModal from '../components/AuthGateModal'
import AchievementToast from '../components/AchievementToast'
import BotAvatar from '../components/BotAvatar'
import PlayerProfilePopover from '../components/PlayerProfilePopover'
import BotProfilePopover from '../components/BotProfilePopover'
import InviteToTablePopover from '../components/InviteToTablePopover'
import FeedWindow from '../components/FeedWindow'
import BotPill from './components/BotPill'
import ConfirmPopoverButton from '../components/ConfirmPopoverButton'
import { bucketByCategory, subgroupsFromBuckets } from './lib/botCategories'
import { useAuth } from '../lib/useAuth'
import { useUpload } from '../lib/useUpload'
import { useZoom, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP } from '../lib/useZoom'
import { api } from '../lib/api'
import { emitNotifEvent } from '../lib/useNotifications'
import { emitDmEvent } from '../lib/useDms'
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
import SideBetsPanel from '../components/SideBetsPanel'
import RunItTwiceVote from '../components/RunItTwiceVote'
import DailyChallengePanel from '../components/DailyChallengePanel'
import SkinSelector from '../components/SkinSelector'
import CryptoMarketPanel from '../components/CryptoMarketPanel'
import FinancesPanel from '../components/FinancesPanel'
import { resolveSkinCss } from '../lib/skinPresets'
import { buildPokerStatistics, buildSpectatorStatistics, evaluateHand, formatCard, formatPercent, getHandName } from '../lib/pokerOdds'
// Seat geometry lives in ./lib/seatLayout — shared by spectator view, the
// table render, and the chip-throw animation. Pure data + helpers, no state.
import { SEATS, getBetPosClasses, getChipThrowOrigin } from './lib/seatLayout'
import LobbyView from './components/LobbyView'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001'
const USERNAME_STORAGE_KEY = 'poker_username'
const AVATAR_STORAGE_KEY = 'poker_avatar_id'
// Chat dock visibility persists per-device. Default true (chat shown) — only
// flipped when the user explicitly turns it off via Tools, so we treat any
// stored value other than '0' as "show chat" and only '0' as "hidden".
const CHAT_VISIBLE_STORAGE_KEY = 'poker_chat_visible'
// Same on/off semantics as chat: missing key = on (default), '0' = off.
// Keeping the tool's last state across reloads matches the user's mental
// model — they shouldn't have to re-enable side bets every session.
const SIDE_BETS_VISIBLE_STORAGE_KEY = 'poker_side_bets_visible'
// Last blind level the user successfully applied to a table. Used as the
// preferred default when they next create / propose at a table.
const BLIND_LEVEL_PREF_STORAGE_KEY = 'poker_blind_level_pref'
// Zoom-related constants come from useZoom — single source of truth.
const POKER_STARTING_CHIPS = 1000

// Mirrors server/src/config/constants.js BLIND_LEVELS — keep both lists
// in lockstep. Adding new tiers? Edit the server-side list first so the
// proposal validator accepts them, then sync this one.
//
// `label` is client-only — purely cosmetic flavor for the blinds picker.
// One unique title per tier (no bucketing) so the highest stakes don't
// keep saying the same "Mythic" tag.
const BLIND_LEVELS = [
  { id: '5_10',         small: 5,     big: 10,    label: 'Penny ante'         },
  { id: '15_25',        small: 15,    big: 25,    label: 'Garage night'       },
  { id: '25_50',        small: 25,    big: 50,    label: 'Coffee-shop reg'    },
  { id: '50_100',       small: 50,    big: 100,   label: 'Weekend grinder'    },
  { id: '100_200',      small: 100,   big: 200,   label: 'Local crusher'      },
  { id: '250_500',      small: 250,   big: 500,   label: 'Backroom pro'       },
  { id: '500_1000',     small: 500,   big: 1000,  label: 'High roller'        },
  { id: '1000_2000',    small: 1000,  big: 2000,  label: 'Whale tank'         },
  { id: '2000_4000',    small: 2000,  big: 4000,  label: 'Hedge fund energy'  },
  { id: '4000_8000',    small: 4000,  big: 8000,  label: 'Family office'      },
  { id: '8000_16000',   small: 8000,  big: 16000, label: 'Oligarch grade'     },
  { id: '16000_32000',  small: 16000, big: 32000, label: 'Mythic'             }
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
  // ?table=ROOM_ID query param — arrived from a DM table invite. Auto-
  // spectate that room once the WS is up; the user can take a seat from
  // there. Stored in state (not derived each render) because the URL is
  // a snapshot we should honor only on initial arrival.
  const [pendingTableId] = useState(() => {
    if (typeof window === 'undefined') return null
    try { return new URL(window.location.href).searchParams.get('table') }
    catch { return null }
  })
  const autoJoinTried = useRef(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [currentRoomId, setCurrentRoomId] = useState(null)
  const [feedWindowOpen, setFeedWindowOpen] = useState(false)
  // Tracks whether the feed window was opened from the Tools menu so
  // the title bar's back arrow knows to reopen Tools instead of just
  // closing. Reset whenever the window closes.
  const [feedOpenedFromTools, setFeedOpenedFromTools] = useState(false)
  const [connected, setConnected] = useState(false)
  const [playerId, setPlayerId] = useState('')
  // Seat-click popover state. We anchor the popover to the nameplate's
  // bounding rect captured at click-time — that decouples placement
  // from re-renders of the seat (animations, chip changes, etc.).
  const [popoverSeat, setPopoverSeat] = useState(null)
  // Anchor by seat id rather than a static rect: the popover queries
  // [data-seat-id] every frame so it tracks scroll, seat reflow, and
  // closes cleanly if the underlying seat element disappears.
  const [popoverSeatId, setPopoverSeatId] = useState(null)
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
  // Array of lines so the notice can show "Main pot: Alice" and "Side pot: Bob"
  // on separate rows. Single-pot messages render as a 1-element array.
  const [splitPotNotice, setSplitPotNotice] = useState([])
  const [selectedAvatarId, setSelectedAvatarId] = useState('op1')
  const [statsMode, setStatsMode] = useState(false)
  const [statsExpansion, setStatsExpansion] = useState('minimized')
  const statsPanelRef = useRef(null)
  // Stable handler so the memoized StatsPanel doesn't re-render every tick
  // from a fresh inline arrow reference.
  const closeStatsPanel = useCallback(() => {
    setStatsMode(false)
    setStatsExpansion('minimized')
  }, [])
  const [tableList, setTableList] = useState([])
  const [spectatorBlindMode, setSpectatorBlindMode] = useState(false)
  const [spectatorVisibleIdSet, setSpectatorVisibleIdSet] = useState(() => new Set())
  const [spectatorRevealAll, setSpectatorRevealAll] = useState(false)
  const [spectatorHoveredPlayerId, setSpectatorHoveredPlayerId] = useState(null)
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  const [activePokerPanel, setActivePokerPanel] = useState(null)
  const [sessionHands, setSessionHands] = useState([])
  const [botRoster, setBotRoster] = useState({ mine: [], public: [], loading: false, error: null })
  // Most-recent uploaded PFPs for the signed-in user. Shown in the lobby's
  // anon mode so they can re-pick a past custom avatar with one tap, no
  // re-upload. Server caps the list at 5 (older entries auto-evicted on
  // every new save), so we never need to slice client-side. Re-fetched
  // after every successful upload via refreshRecentPfps().
  const [recentPfps, setRecentPfps] = useState([])
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
  // Auto-fill is destructive enough to deserve an "are you sure?" — it
  // seats up to 4 top-ELO bots at once. Two-click arm pattern, reset on
  // blur or whenever the Tools menu closes.
  const [autoFillArmed, setAutoFillArmed] = useState(false)
  const [pendingBlindsProposal, setPendingBlindsProposal] = useState(null)
  const [contestMode, setContestMode] = useState({ enabled: false, currentLevelIndex: 0, handsUntilNextLevel: null, currentLevel: null, nextLevel: null, handsPerLevel: 10 })
  const [isArena, setIsArena] = useState(false)
  const [arenaRunning, setArenaRunning] = useState(false)
  // Live ref of arenaRunning so stable useCallbacks can read the latest value
  // without taking a dependency on it (which would invalidate React.memo).
  const arenaRunningRef = useRef(false)
  useEffect(() => { arenaRunningRef.current = arenaRunning }, [arenaRunning])
  const [arenaStartingChips, setArenaStartingChips] = useState(1000)
  // Page zoom is now backed by useZoom (cross-component, cross-tab sync
  // via localStorage + a custom event). The AccountMenu has its own zoom
  // controls that hit the same hook — both surfaces stay in lockstep.
  const { zoom: pageZoom, adjust: adjustZoom, reset: resetZoom } = useZoom()
  const [myBotsExpanded, setMyBotsExpanded] = useState(false)
  // Multi-select state for the Add Bots tool. A Set of botIds the user
  // has checked; committed in one go via the "Add N" button.
  // Cleared whenever the panel closes so reopening starts fresh.
  const [addBotSelection, setAddBotSelection] = useState(() => new Set())
  // Per-category collapse state inside the Add Bots checklist.
  const [addBotCategoryCollapsed, setAddBotCategoryCollapsed] = useState({
    public: false  // public collapsed by default to keep "your bots" visible
  })
  // Chat dock visibility — defaults to true (visible). Persisted to
  // localStorage so the user's choice survives reloads.
  const [chatDockVisible, setChatDockVisible] = useState(true)
  // Side-bets panel visibility — same opt-in pattern as chat. Default on so
  // new players discover the prop markets without having to hunt the menu.
  // Mirror chat-dock persistence: store '0' for hidden, anything else (or
  // absent) means visible. Lazy initial state reads localStorage once so
  // we don't flash the dock open before the saved-off preference applies.
  const [sideBetsDockVisible, setSideBetsDockVisible] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return window.localStorage.getItem(SIDE_BETS_VISIBLE_STORAGE_KEY) !== '0' }
    catch { return true }
  })
  // Inline vertical expansion — the dock grows upward to show every live
  // bet without scrolling. Stays anchored at the same horizontal slot so the
  // table render doesn't shift; just consumes more vertical room.
  const [sideBetsExpanded, setSideBetsExpanded] = useState(false)
  // Live snapshot from the server. Server pushes a fresh sidebet:state on
  // hand-start, every action, every phase advance, every buy/sell, and every
  // resolution — the client is purely a renderer.
  const [sideBetsState, setSideBetsState] = useState(null)
  // Run-it-twice: vote in progress + opponent's submission status + each
  // runout step's "boom" reveal (auto-dismissed after a short hold). The
  // server is authoritative for everything in here — the client just
  // tracks the latest broadcast to drive the modal + step banner.
  const [runoutVote, setRunoutVote] = useState(null)
  const [runoutSubmissions, setRunoutSubmissions] = useState([])
  const [runoutStepBanner, setRunoutStepBanner] = useState(null)
  const runoutStepBannerTimerRef = useRef(null)
  // Peer-loan negotiations open at this table (any pair, any state). The
  // PlayerProfilePopover filters by counterparty; we just mirror what the
  // server broadcasts. Loans themselves live on each player's seat in
  // gameState.players[*].peerLoans — fetched from there at render time.
  const [peerNegotiations, setPeerNegotiations] = useState([])
  // Crypto market snapshot. Full state arrives via 'crypto:state' on
  // buy/sell/mint/rug; cheap 'crypto:tick' deltas patch coin.price +
  // coin.history every couple seconds. Per-recipient — myPositions and
  // myCoinId only contain the local player's data.
  const [cryptoState, setCryptoState] = useState(null)
  // Persistent top-left finance widget. Once opened it stays visible across
  // hands so the player can keep an eye on unrealized P/L as side bets and
  // crypto prices move. Local-only UI state, never broadcast.
  const [financesWidgetOpen, setFinancesWidgetOpen] = useState(false)
  
  // New room feature states
  // 'general' | 'private' | 'spectate'. `private` is a UI tab only — the
  // actual join sends the legacy `create_private` / `join_private` modes.
  const [joinMode, setJoinMode] = useState('general')
  // 'self' (signed-in user plays as themselves — locks username + avatar
  // to their saved profile) | 'anon' (free-text username, ProfileSelector
  // for avatar including upload). Default 'anon' for ALL users — even
  // signed-in users start anonymous on /poker and have to opt in to
  // playing as themselves. Keeps the table private by default and lets
  // signed-in users iterate on avatars without exposing their account.
  const [playMode, setPlayMode] = useState('anon')
  // Avatar cropped via the lobby selector but not yet uploaded. We hold the
  // raw Blob in memory and let the selector use a local `blob:` URL as the
  // preview — the real S3 PUT only fires when the user actually joins a
  // table. Keeps a user who iterates ("nope, different one") from burning
  // an S3 PUT per try.
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState(null)
  const { upload: commitAvatar, busy: avatarCommitBusy } = useUpload()
  const [joinBusy, setJoinBusy] = useState(false)
  const [joinError, setJoinError] = useState(null)
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

    // Cancel any pending dismissal for the same id so the new event gets a
    // fresh 1.5s window instead of expiring against the prior timer.
    const existingTimer = throwTimersRef.current.get(eventId)
    if (existingTimer) clearTimeout(existingTimer)

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

    // Cancel any stale timer for the same id so we don't orphan it when an
    // event id repeats inside the dismissal window.
    const existingTimer = emoteTimersRef.current.get(eventId)
    if (existingTimer) clearTimeout(existingTimer)

    // Drop any prior entry with the same id and keep the bounded window.
    setEmoteEvents(prev => [...prev.filter(e => e.eventId !== eventId).slice(-18), nextEvent])

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
    setSplitPotNotice([])
  }, [])

  // Render the pot-breakdown notice. Three shapes:
  //   • Single pot, single winner   → "Winner: Alice · Aces full"
  //   • Single pot, multiple winners → "Split pot: Alice / Bob"
  //   • Multiple pots               → "Main pot: Alice · Side pot: Bob"
  // Last form is the important fix — main vs side pot was getting collapsed
  // into a misleading "Split pot" label even when distinct players took each.
  const showSplitPotNotice = useCallback((winners, potBreakdown) => {
    if (!winners?.length) return

    const fmtList = (ws) => ws
      .map(w => w.username || w.playerId?.substring(0, 6))
      .filter(Boolean)
      .slice(0, 4)
      .join(' / ')

    let lines = []
    const breakdown = Array.isArray(potBreakdown) ? potBreakdown.filter(p => p.winners?.length > 0) : []

    // If every pot has the exact same winner set, the main/side breakdown
    // is misleading — it implies separate prizes for separate players when
    // really one party scooped everything. Collapse to the single-pot view.
    const allPotsSameWinners = breakdown.length >= 2 && (() => {
      const ids = pot => pot.winners.map(w => w.playerId).sort().join('|')
      const first = ids(breakdown[0])
      return breakdown.every(pot => ids(pot) === first)
    })()

    if (breakdown.length >= 2 && !allPotsSameWinners) {
      // Multi-pot showdown with distinct winners per pot. One line per pot
      // so main vs side are clearly distinguishable rather than mashed onto
      // a single line.
      lines = breakdown.map(pot => {
        const label = pot.potIndex === 0 ? 'Main pot'
                    : breakdown.length > 2 ? `Side pot ${pot.potIndex}`
                    : 'Side pot'
        return `${label}: ${fmtList(pot.winners)}`
      })
    } else if (winners.length >= 2) {
      // Single pot (or unified winners) with multiple players — true chop.
      lines = [`Split pot: ${fmtList(winners)}`]
    } else {
      // Single winner — no notice; the WINNER badge over their seat is enough.
      return
    }

    if (splitNoticeTimerRef.current) clearTimeout(splitNoticeTimerRef.current)
    setSplitPotNotice(lines)
    splitNoticeTimerRef.current = setTimeout(() => {
      setSplitPotNotice([])
      splitNoticeTimerRef.current = null
    }, 4500)
  }, [])

  const addTableYell = useCallback((event) => {
    if (!event?.playerId || !event?.message) return

    const eventId = `${event.playerId}-${event.yellId || Date.now()}`
    const nextEvent = { ...event, eventId }

    // Cancel any stale timer for the same id (mirrors addTableEmote /
    // addChipThrow). Prevents orphaned setTimeouts when an event id repeats.
    const existingTimer = yellTimersRef.current.get(eventId)
    if (existingTimer) clearTimeout(existingTimer)

    setYellEvents(prev => [...prev.filter(e => e.eventId !== eventId).slice(-14), nextEvent])

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
    if (!tableMenuOpen) {
      // Disarm the auto-fill confirm whenever the menu closes so reopening
      // it doesn't land on a pre-armed button.
      setAutoFillArmed(false)
      return
    }

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
      const savedChat = window.localStorage.getItem(CHAT_VISIBLE_STORAGE_KEY)
      if (savedUsername) setUsername(savedUsername)
      // Custom uploads are stored verbatim as their CloudFront URL; presets
      // round-trip through getProfileAvatar so an unknown id falls back to
      // the default cleanly.
      if (savedAvatarId) {
        if (/^https?:\/\//.test(savedAvatarId)) setSelectedAvatarId(savedAvatarId)
        else setSelectedAvatarId(getProfileAvatar(savedAvatarId).id)
      }
      // Zoom is now hydrated + kept in sync by useZoom — no local handling.
      // Only '0' means "user explicitly hid chat" — any other value (including
      // missing) leaves the default `true`. Keeps first-time visitors on the
      // chat-visible path.
      if (savedChat === '0') setChatDockVisible(false)

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
          setCurrentRoomId(msg.data.roomId || null)
          setIsSpectator(msg.data.isSpectator || false)
          applyGameState(msg.data.gameState)
          setIsPrivate(msg.data.isPrivate || false)
          setInviteCode(msg.data.inviteCode || null)
          // Auto-apply saved blind-level preference for "you started this
          // table"-style joins. Conditions:
          //   1. We have a saved preference,
          //   2. Current blinds at the table don't match it,
          //   3. We're seated (spectators can't propose),
          //   4. We're the only human seated (so the server's solo path
          //      auto-applies without a multi-human vote).
          // Multi-human tables intentionally fall back to the existing
          // proposal flow — we don't auto-propose new blinds to other
          // humans without their input.
          if (!msg.data.isSpectator && typeof window !== 'undefined') {
            try {
              const prefId = window.localStorage.getItem(BLIND_LEVEL_PREF_STORAGE_KEY)
              const pref = prefId && BLIND_LEVELS.find(l => l.id === prefId)
              const seats = msg.data.gameState?.players || []
              const me = seats.find(p => p.id === playerIdRef.current)
              const otherHumans = seats.filter(p => !p?.isBot && p?.id !== playerIdRef.current && p?.isConnected !== false)
              const gs = msg.data.gameState
              const isFresh = gs && pref
                && me && !me.isBot
                && (gs.smallBlind !== pref.small || gs.bigBlind !== pref.big)
                && otherHumans.length === 0
              if (isFresh) {
                send('poker_propose_blinds', { small: pref.small, big: pref.big })
              }
            } catch {}
          }
          // Hydrate the side-bets panel with whatever markets are live at
          // join time — fresh joiners see the same prop set as everyone else.
          if (msg.data.sideBets) setSideBetsState(msg.data.sideBets)
          // Same idea for crypto — server bundles a per-recipient snapshot
          // (coins[] with full history + this player's positions/coinId)
          // alongside the room data on JOIN_GAME and getRoomData.
          if (msg.data.crypto) setCryptoState(msg.data.crypto)
          if (msg.data.contestMode) setContestMode(msg.data.contestMode)
          if (typeof msg.data.isArena === 'boolean') setIsArena(msg.data.isArena)
          if (typeof msg.data.arenaRunning === 'boolean') setArenaRunning(msg.data.arenaRunning)
          if (typeof msg.data.arenaStartingChips === 'number') setArenaStartingChips(msg.data.arenaStartingChips)
          {
            // Find self in players[] first, then spectators[]. Spectators
            // get the same Player.toJSON() payload — chips, loans, credit
            // score, everything — so a single fall-back keeps the bank
            // panel & myStack lookups working for both audiences.
            const me = msg.data.players?.find(p => p.id === playerIdRef.current)
              || msg.data.spectators?.find(p => p.id === playerIdRef.current)
            if (me) setBankState(prev => ({
              ...prev,
              // Chips broadcast here is the source of truth for spectators
              // — they're not in gameState.players, so the side-bets panel
              // & bank UI read their stack out of bankState instead.
              chips: me.chips ?? prev.chips,
              // Persistent buy-in and open-stake values feed the spectator
              // bankroll badge's P/L calc. Server is authoritative — the
              // client just renders.
              pokerBuyIn: me.pokerBuyIn ?? prev.pokerBuyIn,
              openSideBetStake: me.openSideBetStake ?? prev.openSideBetStake ?? 0,
              // Daily / cosmetic state — server is authoritative, just
              // mirror what comes off the wire.
              dailyProgress: me.dailyProgress ?? prev.dailyProgress ?? 0,
              dailyCompleted: !!me.dailyCompleted,
              dailiesCompleted: me.dailiesCompleted ?? prev.dailiesCompleted ?? 0,
              achievements: Array.isArray(me.achievements) ? me.achievements : (prev.achievements ?? []),
              skinId: me.skinId ?? prev.skinId ?? 0,
              customSkin: me.customSkin ?? prev.customSkin ?? null,
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
          // Lobby refresh — non-urgent. Wrap in startTransition so it can't
          // preempt a click or input the user is making at the lobby form.
          startTransition(() => setTableList(msg.data.tables || []))
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
            // Find self in players[] first, then spectators[]. Spectators
            // get the same Player.toJSON() payload — chips, loans, credit
            // score, everything — so a single fall-back keeps the bank
            // panel & myStack lookups working for both audiences.
            const me = msg.data.players?.find(p => p.id === playerIdRef.current)
              || msg.data.spectators?.find(p => p.id === playerIdRef.current)
            if (me) setBankState(prev => ({
              ...prev,
              // Chips broadcast here is the source of truth for spectators
              // — they're not in gameState.players, so the side-bets panel
              // & bank UI read their stack out of bankState instead.
              chips: me.chips ?? prev.chips,
              // Persistent buy-in and open-stake values feed the spectator
              // bankroll badge's P/L calc. Server is authoritative — the
              // client just renders.
              pokerBuyIn: me.pokerBuyIn ?? prev.pokerBuyIn,
              openSideBetStake: me.openSideBetStake ?? prev.openSideBetStake ?? 0,
              // Daily / cosmetic state — server is authoritative, just
              // mirror what comes off the wire.
              dailyProgress: me.dailyProgress ?? prev.dailyProgress ?? 0,
              dailyCompleted: !!me.dailyCompleted,
              dailiesCompleted: me.dailiesCompleted ?? prev.dailiesCompleted ?? 0,
              achievements: Array.isArray(me.achievements) ? me.achievements : (prev.achievements ?? []),
              skinId: me.skinId ?? prev.skinId ?? 0,
              customSkin: me.customSkin ?? prev.customSkin ?? null,
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
        case 'notif:new':
        case 'notif:unread':
          // Bridge to the NotificationsBell hook on every page that
          // mounts AccountMenu. Pages without an open WS poll instead;
          // here we push the same payload through a window event so a
          // mounted hook lights up the bell in real time.
          emitNotifEvent(msg)
          break
        case 'dm:new':
        case 'dm:unread':
        case 'dm:read':
          // Same bridge for the DMs popup. Open chat windows + the
          // conversation list both listen to this event.
          emitDmEvent(msg)
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
              showSplitPotNotice(msg.data.winners, msg.data.potBreakdown)
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
        case 'sidebet:state':
          // Full snapshot rebroadcast on every state change. Cheap to drop in
          // wholesale — payload tops out at ~6 props + a handful of positions.
          setSideBetsState(msg.data)
          break
        case 'runout_vote_start':
          // Open the vote modal for everyone (eligible players vote;
          // spectators just watch). Reset submissions to empty for this id.
          setRunoutVote(msg.data || null)
          setRunoutSubmissions([])
          break
        case 'runout_vote_update':
          // Functional update so we read the freshest voteId, not whatever
          // was in the closure when the ws handler was created.
          setRunoutVote(curr => {
            if (curr && msg.data?.voteId && curr.voteId === msg.data.voteId) {
              setRunoutSubmissions(msg.data.submissions || [])
            }
            return curr
          })
          break
        case 'runout_vote_resolved':
          setRunoutVote(null)
          setRunoutSubmissions([])
          if (msg.data?.agreedRuns > 1) {
            addSys(`Running it ${msg.data.agreedRuns} times!`)
          } else if (msg.data?.outcome === 'disagreement') {
            addSys('Disagreement — running once.')
          } else if (msg.data?.outcome === 'timeout') {
            addSys('No vote in time — running once.')
          }
          break
        case 'peer_loan:state':
          // Full negotiation state mirror — only the open ones; active
          // loans flow in via the players[].peerLoans array on the next
          // room_update (broadcast right after on the engine side).
          setPeerNegotiations(Array.isArray(msg.data?.negotiations) ? msg.data.negotiations : [])
          break
        case 'peer_loan:resolved':
          // Optional toast for closed negotiations. Quietly drop replaced
          // / accepted ones — accepted already triggers a system message.
          if (msg.data?.outcome === 'declined') addSys('Peer loan declined.')
          else if (msg.data?.outcome === 'expired') addSys('Peer loan offer expired.')
          break
        case 'crypto:state':
          // Full snapshot — coins[], myPositions, myCoinId. Drop in
          // wholesale. The light 'crypto:tick' below patches prices only.
          setCryptoState(msg.data)
          if (msg.data?.reason === 'rug' && msg.data?.meta?.by) {
            addSys(`💥 Rug pulled: ${msg.data.meta.by} rugged their coin.`)
          }
          break
        case 'crypto:tick':
          // Light delta: just new prices keyed by coin id. Patch into the
          // existing state and append to history rolls so the sparkline
          // moves without a full server round-trip.
          setCryptoState(prev => {
            if (!prev || !Array.isArray(msg.data?.prices)) return prev
            const priceById = new Map(msg.data.prices.map(p => [p.id, p]))
            return {
              ...prev,
              coins: prev.coins.map(c => {
                const next = priceById.get(c.id)
                if (!next) return c
                const newHistory = c.history.length >= 60
                  ? [...c.history.slice(1), next.price]
                  : [...c.history, next.price]
                return { ...c, prevPrice: c.price, price: next.price, history: newHistory }
              })
            }
          })
          break
        case 'runout_step':
          // Each runout's "boom" reveal. Show a short-lived banner naming
          // the runout index, winners, and total. Server is already pushing
          // a game_state with the updated communityCards, so the board
          // animates on its own — this banner just gives the moment a label.
          if (msg.data) {
            if (runoutStepBannerTimerRef.current) clearTimeout(runoutStepBannerTimerRef.current)
            setRunoutStepBanner(msg.data)
            runoutStepBannerTimerRef.current = setTimeout(() => {
              setRunoutStepBanner(null)
              runoutStepBannerTimerRef.current = null
            }, 3200)
          }
          break
        case 'sidebet:resolve':
          // Surface a system-message receipt for any payout that touched the
          // local user so the wins/losses don't only show in the panel.
          if (msg.data && Array.isArray(msg.data.payouts)) {
            const mine = msg.data.payouts.filter(p => p.playerId === playerIdRef.current)
            for (const m of mine) {
              if (m.result === 'win') addSys(`Side bet hit: ${msg.data.question} — +${m.credit} chips.`)
              else if (m.result === 'loss') addSys(`Side bet lost: ${msg.data.question} — −${m.costPaid} chips.`)
              else if (m.result === 'void') addSys(`Side bet void: ${msg.data.question} — ${m.credit} refunded.`)
            }
          }
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
            // Remember whatever blinds the user just applied as their
            // preference. The lobby reads this back at table-create time
            // so a returning player lands at "their" stakes by default.
            // Stored as the BLIND_LEVELS id (e.g. '100_200') for stability.
            const match = BLIND_LEVELS.find(l => l.small === msg.data.small && l.big === msg.data.big)
            if (match) {
              try { window.localStorage.setItem(BLIND_LEVEL_PREF_STORAGE_KEY, match.id) } catch {}
            }
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

  // Auto-spectate into a specific table when the page is opened via a
  // shared link (?table=ROOM_ID) — typically a DM table invite. We wait
  // for: WS up, playerId assigned (server welcome), not already joined,
  // and guard against re-firing on every dependency change.
  useEffect(() => {
    if (!pendingTableId) return
    if (!connected || !playerId || joined) return
    if (autoJoinTried.current) return
    autoJoinTried.current = true
    // Spectate so the invitee can decide whether to take a seat — auto-
    // seating them would be presumptuous, and arenas only allow
    // spectator entry anyway.
    send('join_game', { roomId: pendingTableId, mode: 'spectate' })
  }, [connected, playerId, joined, pendingTableId])

  function persistUsername(nextUsername) {
    setUsername(nextUsername)
    if (typeof window === 'undefined') return

    const trimmed = nextUsername.trim()
    if (trimmed) window.localStorage.setItem(USERNAME_STORAGE_KEY, trimmed)
    else window.localStorage.removeItem(USERNAME_STORAGE_KEY)
  }

  // `value` may be a preset id ('op1'…), a fully-qualified upload URL
  // (https://…cloudfront…), or a deferred-upload preview (`blob:`). All
  // three flow through this one setter so ProfileSelector +
  // ProfileModal don't have to branch on the caller side.
  function selectAvatar(value) {
    // If we're switching away from a pending blob avatar, free the in-memory
    // image and drop the staged blob so we don't accidentally upload it on
    // the next join attempt.
    if (
      typeof selectedAvatarId === 'string' &&
      selectedAvatarId.startsWith('blob:') &&
      selectedAvatarId !== value
    ) {
      URL.revokeObjectURL(selectedAvatarId)
      setPendingAvatarBlob(null)
    }
    setSelectedAvatarId(value)
    // Don't persist a `blob:` URL — those are tab-lifetime only and would
    // dangle as broken images after a reload.
    if (typeof window !== 'undefined' && typeof value === 'string' && !value.startsWith('blob:')) {
      window.localStorage.setItem(AVATAR_STORAGE_KEY, value)
    }
  }

  // ProfileSelector's deferred-upload callback. Receives the cropped blob
  // plus a `blob:` URL the selector is about to display. We stash the blob
  // here; selectAvatar (called by the selector immediately after) sets the
  // URL as the current value so the carousel shows the preview.
  function stagePendingAvatar(blob /* , localUrl */) {
    setPendingAvatarBlob(blob)
  }

  function joinPayload(mode = joinMode, extra = {}, avatarUrlOverride = null) {
    const useSelf = authUser && playMode === 'self'

    // "Play as YOU" — server is the source of truth for username + avatar.
    // We just signal the intent; the server reads from its cached profile
    // (populated at auth_hello). This makes Google profile pictures, custom
    // CDN uploads, and "no avatar → initials at the table" all work
    // through one code path on both sides, and lets the player drop their
    // current avatar by clearing it in the Profile modal.
    if (useSelf && mode !== 'spectate' && mode !== 'bot_arena') {
      return { playAsSelf: true, mode, ...extra }
    }

    const payload = {
      username: username || undefined,
      mode,
      ...extra,
    }

    if (mode !== 'spectate' && mode !== 'bot_arena') {
      if (avatarUrlOverride) {
        // tryJoin just committed a staged blob — use the fresh public URL
        // directly rather than waiting for the next render to flush
        // selectedAvatarId state.
        payload.avatarUrl = avatarUrlOverride
      } else if (typeof selectedAvatarId === 'string' && /^https?:\/\//.test(selectedAvatarId)) {
        // Distinguish preset id from uploaded URL so the server can pick the
        // right code path. URL → trusted custom upload (its public URL is
        // signed by our presign endpoint); id → look up in the preset table.
        payload.avatarUrl = selectedAvatarId
      } else if (typeof selectedAvatarId === 'string' && selectedAvatarId.startsWith('blob:')) {
        // Defensive: a `blob:` URL shouldn't make it into the payload — the
        // caller should run tryJoin which commits it first.
        payload.avatarId = 'op1'
      } else {
        payload.avatarId = selectedAvatarId
      }
    }

    return payload
  }

  // Commit any staged avatar blob, then dispatch join_game. All lobby
  // join buttons funnel through this so we can centralize:
  //   * "upload the blob first if anonymous mode and not spectating"
  //   * busy/error state for the buttons
  //   * cleanup of the stale `blob:` URL after commit
  // Spectate + bot_arena never carry a player avatar so they short-circuit
  // straight to send().
  async function tryJoin(mode = joinMode, extra = {}) {
    setJoinError(null)
    const useSelf = authUser && playMode === 'self'
    const needsAvatarCommit =
      !useSelf &&
      pendingAvatarBlob &&
      mode !== 'spectate' &&
      mode !== 'bot_arena'

    if (!needsAvatarCommit) {
      send('join_game', joinPayload(mode, extra))
      return
    }

    setJoinBusy(true)
    try {
      const { publicUrl } = await commitAvatar(pendingAvatarBlob, { saveToHistory: !!authUser })
      const oldUrl = selectedAvatarId
      setPendingAvatarBlob(null)
      selectAvatar(publicUrl)
      if (typeof oldUrl === 'string' && oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl)
      // Fire-and-forget refresh so the next time the user lands in the
      // lobby, the new image (and any auto-evicted older ones) are
      // reflected in the recent-uploads strip.
      if (authUser) refreshRecentPfps()
      send('join_game', joinPayload(mode, extra, publicUrl))
    } catch (err) {
      setJoinError(err?.message || 'Avatar upload failed — try again.')
    } finally {
      setJoinBusy(false)
    }
  }
  
  function sendChat() {
    const text = chatInput.trim()
    if (!text) return
    send('chat', { message: text })
    setChatInput('')
  }

  // Side-bet send helpers. Server validates everything (chip balance, prop
  // open/closed state, side string). Errors come back via the standard
  // 'error' channel and surface as a system-message toast.
  function placeSideBet(propId, side, amount) {
    if (!propId || (side !== 'yes' && side !== 'no')) return
    const stake = Math.max(10, Math.floor(Number(amount) || 0))
    if (stake <= 0) return
    send('sidebet:place', { propId, side, amount: stake })
  }

  function sellSideBet(propId, shares) {
    if (!propId) return
    send('sidebet:sell', { propId, shares: shares || 0 })
  }

  // Crypto send helpers. Server is authoritative — every action returns via
  // 'crypto:state' (or 'error' on rejection). No optimistic local mutation.
  const cryptoBuy = useCallback((coinId, amount) => {
    if (!coinId) return
    const chips = Math.floor(Number(amount) || 0)
    if (chips <= 0) return
    send('crypto:buy', { coinId, amount: chips })
  }, [send])
  const cryptoSell = useCallback((coinId, shares) => {
    if (!coinId) return
    const n = Number(shares)
    if (!Number.isFinite(n) || n <= 0) return
    send('crypto:sell', { coinId, shares: n })
  }, [send])
  const cryptoCreate = useCallback((opts) => {
    send('crypto:create', opts || {})
  }, [send])
  const cryptoRug = useCallback((coinId) => {
    // Server reads the owner's coin id from the player record — coinId arg
    // is just a sanity check on the client. No need to send it.
    send('crypto:rug', { coinId: coinId || null })
  }, [send])


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
  // "If everything settles right now" stack — drives the persistent
  // top-left widget and is the same formula FinancesPanel renders.
  // bank loans (owed) leave; parked side-bet stake comes back; peer
  // loans net out; crypto holdings sell at current mid. Recomputed on
  // every crypto tick because price moves continuously.
  const liquidatedSummary = useMemo(() => {
    const chips = bankState.chips ?? 0
    const bankDebt = (bankState.loans || []).reduce((s, l) => s + (l.owed || 0), 0)
    const parked = bankState.openSideBetStake ?? 0
    const peer = gameState?.players?.find(p => p.id === playerId)?.peerLoans
      || gameState?.spectators?.find?.(p => p.id === playerId)?.peerLoans
      || []
    let peerOwedIn = 0
    let peerOwedOut = 0
    for (const l of peer) {
      if (l.borrowerId === playerId) peerOwedOut += l.owed || 0
      else if (l.lenderId === playerId) peerOwedIn += l.owed || 0
    }
    const coinIndex = new Map((cryptoState?.coins || []).map(c => [c.id, c]))
    let cryptoValue = 0
    let cryptoCost = 0
    for (const p of cryptoState?.myPositions || []) {
      const c = coinIndex.get(p.coinId)
      if (!c) continue
      cryptoValue += (p.shares || 0) * (c.price || 0)
      cryptoCost += p.costBasis || 0
    }
    const liquidated = chips + parked + peerOwedIn + cryptoValue - bankDebt - peerOwedOut
    return {
      chips,
      liquidated: Math.round(liquidated),
      delta: Math.round(liquidated - chips),
      bankDebt,
      parked,
      peerOwedIn,
      peerOwedOut,
      cryptoValue: Math.round(cryptoValue),
      cryptoCost: Math.round(cryptoCost),
      cryptoPnl: Math.round(cryptoValue - cryptoCost)
    }
  }, [bankState.chips, bankState.loans, bankState.openSideBetStake, gameState, playerId, cryptoState])
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
  // Only flag a turn timeout when there's another human waiting on the
  // actor. Solo-vs-bots games have no social cost to stalling; the red
  // urgency ring just makes the table feel hostile when the only thing
  // waiting is a bot. The server also skips scheduling the auto-kick in
  // this mode (see _scheduleTurnTimeout + the hasTimedActiveTurn gate in
  // _buildStateEnvelope) — this client check is the visual mirror.
  const seatedHumanCount = (gameState?.players || []).filter(
    p => p && !p.isBot && p.isConnected !== false
  ).length
  const isActiveTurnWarning = activeTurnTimeRemaining !== null &&
    activeTurnTimeRemaining <= (gameState?.activeTurnWarningMs || 10000) &&
    phase !== 'waiting' &&
    phase !== 'showdown' &&
    seatedHumanCount >= 2
  // useDeferredValue lets the heavy stats recompute run AT lower priority
  // than urgent updates (input, action button clicks). The table UI still
  // sees the latest gameState immediately; stats catches up a tick later,
  // which is imperceptible to the user but keeps input responsive even
  // mid-recompute. Big win on slower devices.
  const deferredGameState = useDeferredValue(gameState)
  const statistics = useMemo(
    () => statsMode ? buildPokerStatistics(deferredGameState, playerId, { includeDetails: statsExpansion === 'detailed' }) : null,
    [statsMode, statsExpansion, deferredGameState, playerId]
  )
  const allInOddsByPlayer = useMemo(() => {
    if (!statistics?.allIn?.players) return new Map()
    return new Map(statistics.allIn.players.map((player) => [player.id, player]))
  }, [statistics])
  const spectatorStatistics = useMemo(
    () => isSpectator ? buildSpectatorStatistics(deferredGameState, { blindMode: spectatorBlindMode }) : null,
    [isSpectator, deferredGameState, spectatorBlindMode]
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

  // Zoom is actually applied by ZoomLayer in layout.jsx; useZoom (above)
  // owns the storage + event protocol so any consumer (AccountMenu, this
  // tools panel) reads + writes the same source of truth.

  // Flip chat dock visibility and persist the choice. We store '0' for hidden
  // and clear the key for visible, so the on-state has no footprint and is
  // the natural default for new visitors / cleared storage.
  function toggleChatDock() {
    setChatDockVisible(prev => {
      const next = !prev
      try {
        if (next) window.localStorage.removeItem(CHAT_VISIBLE_STORAGE_KEY)
        else window.localStorage.setItem(CHAT_VISIBLE_STORAGE_KEY, '0')
      } catch {}
      // Arena spectator: only one of chat/sidebets at a time, both anchored
      // to the same bottom-right slot. Turning chat on closes sidebets.
      if (next && isArena) {
        setSideBetsDockVisible(false)
        try { window.localStorage.setItem(SIDE_BETS_VISIBLE_STORAGE_KEY, '0') } catch {}
      }
      return next
    })
  }

  // Side-bets panel toggle. Mirrors the chat-dock pattern — not persisted to
  // localStorage yet; the dock state resets to "on" on every reload to
  // promote the feature.
  function toggleSideBetsDock() {
    setSideBetsDockVisible(prev => {
      const next = !prev
      // Same persistence shape as chat — absent key = on, '0' = off. The
      // close button on the dock itself runs through this same path so
      // either entry point keeps the preference consistent.
      try {
        if (next) window.localStorage.removeItem(SIDE_BETS_VISIBLE_STORAGE_KEY)
        else window.localStorage.setItem(SIDE_BETS_VISIBLE_STORAGE_KEY, '0')
      } catch {}
      // Arena: mutually exclude with chat. Both docks share the bottom-right
      // slot, so turning sidebets on closes the chat dock.
      if (next && isArena) {
        setChatDockVisible(false)
        try { window.localStorage.setItem(CHAT_VISIBLE_STORAGE_KEY, '0') } catch {}
      }
      return next
    })
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

  // Lightweight fetch of the user's recent PFPs — used to populate the
  // lobby's anon-mode roster strip. Failures are non-fatal (the strip just
  // renders empty) so we don't surface an error UI; logging is enough.
  const refreshRecentPfps = useCallback(async () => {
    if (!authUser) { setRecentPfps([]); return }
    try {
      const { pfps } = await api.listPfps()
      setRecentPfps(pfps || [])
    } catch (err) {
      console.warn('[lobby] recent pfp fetch failed:', err.message)
    }
  }, [authUser])

  // Refresh whenever auth state flips. Signed-out → clear; signed-in → fetch.
  useEffect(() => { refreshRecentPfps() }, [refreshRecentPfps])

  function addBotToTable(botId) {
    // Keep the panel open so the user can add multiple bots in a row.
    // The roster doesn't change after a successful add (each bot row stays
    // available), so this just removes a click between adds.
    send('add_bot', { botId })
  }

  // ── Add Bots multi-select helpers ─────────────────────────────────
  function addBotToggle(botId) {
    setAddBotSelection(prev => {
      const next = new Set(prev)
      if (next.has(botId)) next.delete(botId)
      else next.add(botId)
      return next
    })
  }
  function addBotToggleMany(ids, mode /* 'select' | 'deselect' */) {
    setAddBotSelection(prev => {
      const next = new Set(prev)
      for (const id of ids) {
        if (mode === 'select') next.add(id)
        else next.delete(id)
      }
      return next
    })
  }
  function addBotClearSelection() {
    setAddBotSelection(new Set())
  }
  function addBotCommitSelection() {
    for (const id of addBotSelection) send('add_bot', { botId: id })
    setAddBotSelection(new Set())
  }
  function toggleAddBotCategory(key) {
    setAddBotCategoryCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  }
  // Reset selection when the Add Bots panel closes so reopening starts
  // clean (otherwise stale picks would survive across panel toggles).
  useEffect(() => {
    if (activePokerPanel !== 'bots' && addBotSelection.size > 0) {
      setAddBotSelection(new Set())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePokerPanel])

  // Maximum bots the arena pick queue holds before "Add" is required. The
  // table itself caps at 5 seated, so 5 is the natural ceiling.
  // Multi-select for the Bot Arena lineup picker. Same pattern as the
  // Add Bots tool: a Set of botIds the user has highlighted, committed
  // in one batch via "Add N selected". The pill picker toggles entries
  // in/out — duplicates aren't supported (the engine would seat a
  // BotPlayer per send, but seeing the same name twice is rare enough
  // to skip).
  function arenaQueueToggle(botId) {
    setArenaPickQueue(prev =>
      prev.includes(botId)
        ? prev.filter(x => x !== botId)
        : [...prev, botId]
    )
  }
  function arenaQueueToggleMany(ids, mode) {
    setArenaPickQueue(prev => {
      const set = new Set(prev)
      for (const id of ids) {
        if (mode === 'select') set.add(id)
        else set.delete(id)
      }
      return Array.from(set)
    })
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
        playMode={playMode}
        setPlayMode={setPlayMode}
        send={send}
        joinPayload={joinPayload}
        tryJoin={tryJoin}
        joinBusy={joinBusy || avatarCommitBusy}
        joinError={joinError}
        onPendingAvatar={stagePendingAvatar}
        recentPfps={recentPfps}
      />
    )
  }

  // Chat box body — used both inline under the action stack (when seated)
  // and inside the fixed-position spectator dock. Header has its own close
  // button so the user can toggle the dock off without hunting the Tools
  // menu. messagesEndRef is attached on every render; the parent already
  // owns the scroll-to-bottom effect.
  const chatBoxInner = (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Chat</span>
        <button
          type="button"
          onClick={toggleChatDock}
          aria-label="Close chat"
          title="Close chat"
          className="-mr-1 rounded-md px-1.5 text-base leading-none text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
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
        <input
          className="flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-zinc-400 outline-none min-w-0"
          placeholder="Message..."
          value={chatInput}
          onChange={e => setChatInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendChat()}
          maxLength={200}
        />
        <button onClick={sendChat} className="shrink-0 px-3 text-xs font-bold text-white hover:bg-zinc-700 transition-colors">
          Send
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">

      {/* Top Header Row.
          `flex-wrap` lets the right cluster drop below the left cluster
          on narrow widths instead of colliding with the spectator chips
          / P/L badge that used to float at top-center. `gap-y-2` keeps a
          consistent vertical rhythm when wrapping occurs. */}
      <div className="relative flex flex-wrap items-center justify-between gap-y-2 mb-3 sm:mb-4 z-50 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
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
          {/* Spectator bankroll inline. Previously this badge floated at
              `fixed left-1/2 top-3` so it could sit above the felt
              regardless of header width — but on narrow viewports the
              centered float collided with the right-side Tools/Lobby
              buttons. Inline placement lets the natural flex layout
              (with wrap) handle the spacing instead. */}
          {isSpectator && (() => {
            const chips = bankState.chips ?? 0
            const openStake = bankState.openSideBetStake || 0
            const buyIn = bankState.pokerBuyIn ?? 10000
            const pl = chips + openStake - buyIn
            const sign = pl >= 0 ? '+' : '−'
            const plClass = pl >= 0 ? 'text-emerald-300' : 'text-red-300'
            return (
              <div className="rounded-lg border border-zinc-600/60 bg-zinc-900/95 px-2 py-1 sm:px-3 sm:py-1.5 shadow-sm backdrop-blur-md">
                <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs font-bold text-zinc-100 whitespace-nowrap">
                  <span><span className="text-[9px] uppercase tracking-wider text-zinc-500 mr-1">Chips</span>${chips.toLocaleString()}</span>
                  <span className="text-zinc-700">·</span>
                  <span>
                    <span className="text-[9px] uppercase tracking-wider text-zinc-500 mr-1">P/L</span>
                    <span className={plClass}>{sign}${Math.abs(pl).toLocaleString()}</span>
                  </span>
                  {openStake > 0 && (
                    <>
                      <span className="text-zinc-700">·</span>
                      <span className="text-amber-200">
                        <span className="text-[9px] uppercase tracking-wider text-zinc-500 mr-1">Open</span>
                        ${openStake.toLocaleString()}
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })()}
          {isPrivate && inviteCode && (
             <button onClick={copyInviteLink} title="Click to copy invite link" className="text-xs sm:text-sm font-bold text-white bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors px-2 sm:px-3 py-1.5 rounded-lg border border-zinc-500/50 shadow-sm flex items-center gap-1.5 sm:gap-2 active:scale-95">
               <span className="text-zinc-400">CODE:</span>
               <span className="text-amber-400 tracking-widest">{inviteCode}</span>
             </button>
          )}
        </div>
        {/* `mr-12 sm:mr-14` keeps the Tools + Leave cluster clear of the
            AccountDock anchored to the very top-right corner. Without
            the reservation, the buttons would slide underneath the
            fixed profile avatar on every viewport width. */}
        <div className="flex items-center gap-2 mr-12 sm:mr-14">
          {/* The profile / notifications / DMs cluster used to live here
              but is now globally docked top-right (see AccountDock).
              Only the table-scoped controls (Tools, Leave) remain in
              this header row. */}
          <div ref={tableMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTableMenuOpen(prev => {
                const nextOpen = !prev
                if (nextOpen) setActivePokerPanel(null)
                return nextOpen
              })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
            >
              Tools
            </button>
            {tableMenuOpen && (
              // Explicit 2-column grid (not CSS multi-column). Each
              // column is its own flex stack, so section headers and
              // items in BOTH columns anchor to the same top edge —
              // "DISPLAY" and "TABLE" sit at exactly the same y, and
              // the columns share consistent internal rhythm in both
              // regular tables and bot arenas. A vertical divider
              // between the two columns reinforces the alignment.
              // `[&_button]:py-2 [&_button]:px-3` applied to each
              // column locks every row to the same height/padding so
              // rows visually line up across columns even when the
              // sections themselves contain different items.
              <div className="absolute right-0 top-full mt-2 z-[100] w-56 md:w-[28rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md">
                <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x md:divide-zinc-800">
                  {/* ════════ LEFT COLUMN: settings & info ════════ */}
                  <div className="flex flex-col">
                    {/* ── DISPLAY ─────────────────────────────────── */}
                    <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Display</div>
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

                    {/* ── INFO ────────────────────────────────────── */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Info</div>
                    <button type="button" onClick={() => openPokerPanel('help')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      How to Play
                    </button>
                    <button type="button" onClick={() => openPokerPanel('hand')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Current Hand
                    </button>
                    <button type="button" onClick={() => openPokerPanel('session')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Session History
                    </button>
                    <button type="button" onClick={() => openPokerPanel('daily')} className="block w-full px-3 py-2 text-left text-xs font-bold text-amber-200 hover:bg-zinc-800">
                      Daily Challenge
                    </button>
                    <button type="button" onClick={() => openPokerPanel('finances')} className="block w-full px-3 py-2 text-left text-xs font-bold text-emerald-200 hover:bg-zinc-800">
                      Finances
                    </button>
                    <button type="button" onClick={() => openPokerPanel('crypto')} className="block w-full px-3 py-2 text-left text-xs font-bold text-fuchsia-200 hover:bg-zinc-800">
                      ★ Crypto Market
                    </button>
                    {authUser && (
                      <button
                        type="button"
                        onClick={() => {
                          setFeedWindowOpen(true)
                          setFeedOpenedFromTools(true)
                          setTableMenuOpen(false)
                        }}
                        className="block w-full px-3 py-2 text-left text-xs font-bold text-violet-200 hover:bg-zinc-800"
                      >
                        ★ Social Media
                      </button>
                    )}

                    {/* ── WIDGETS ─────────────────────────────────── */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Widgets</div>
                    {!isSpectator && (
                      <button type="button" onClick={toggleStatsMode} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${statsMode ? 'text-sky-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${statsMode ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]' : 'bg-zinc-600'}`} />
                        Hand Equity {statsMode ? 'On' : 'Off'}
                      </button>
                    )}
                    <button type="button" onClick={toggleChatDock} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${chatDockVisible ? 'text-cyan-200' : 'text-zinc-400'}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${chatDockVisible ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]' : 'bg-zinc-600'}`} />
                      Chat {chatDockVisible ? 'On' : 'Off'}
                    </button>
                    <button type="button" onClick={toggleSideBetsDock} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${sideBetsDockVisible ? 'text-amber-200' : 'text-zinc-400'}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${sideBetsDockVisible ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]' : 'bg-zinc-600'}`} />
                      Side Bets {sideBetsDockVisible ? 'On' : 'Off'}
                      {sideBetsState?.props?.length ? (
                        <span className="ml-auto rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                          {sideBetsState.props.filter(p => p.status === 'open').length} live
                        </span>
                      ) : null}
                    </button>
                    <button type="button" onClick={() => setFinancesWidgetOpen(prev => !prev)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${financesWidgetOpen ? 'text-emerald-200' : 'text-zinc-400'}`}>
                      <span className={`inline-block h-2 w-2 rounded-full ${financesWidgetOpen ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' : 'bg-zinc-600'}`} />
                      Finances Widget {financesWidgetOpen ? 'On' : 'Off'}
                    </button>
                  </div>

                  {/* ════════ RIGHT COLUMN: actions & profile ════════ */}
                  {/* `border-t md:border-t-0` adds a horizontal rule on
                      mobile (single-column) so the two former columns
                      don't visually run together. On md+ the divide-x
                      handles separation. */}
                  <div className="flex flex-col border-t border-zinc-800 md:border-t-0">
                    {/* ── TABLE ───────────────────────────────────── */}
                    <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Table</div>
                    {/* Bank is open to spectators too — they can take loans and
                        place side bets on the runout even without a seat at the
                        table. Soft teal accent + ★ so it reads as a featured
                        destination, matching the auto-fill style below. */}
                    <button type="button" onClick={() => openPokerPanel('bank')} className="block w-full px-3 py-2 text-left text-xs font-bold text-teal-200 hover:bg-zinc-800">
                      ★ Bank Account
                    </button>
                    {/* All five seat-claim tools (Invite Friend + four
                        ★ auto-fills) share the same three-state pattern:
                          1. Open seats available → seat normally.
                          2. Full + bots present → popup offers to KICK
                             every bot first, then perform the action.
                          3. Full + only humans seated → button stays
                             disabled with a "real players, wait for a
                             seat" label.
                        The branching lives in fullActionState so each
                        tool's button is a one-liner config. */}
                    {(!isSpectator || isArena || true) && (() => {
                      // Compute once per render — every button below
                      // reads from this. seatedBots / hasBots are used
                      // to decide between "kick-and-seat" (bots present)
                      // and "table of humans, disabled" (no bots).
                      const seatedCount = gameState?.players?.length ?? 0
                      const openSlots = Math.max(0, 5 - seatedCount)
                      const isFull = openSlots === 0
                      const seatedBots = (gameState?.players || []).filter(p => p && p.isBot)
                      const hasBots = seatedBots.length > 0
                      const fullWithBots = isFull && hasBots
                      const fullNoKick = isFull && !hasBots
                      const kickCount = seatedBots.length

                      // Builds the ConfirmPopoverButton props for one
                      // seat-claim tool. Three states:
                      //   1. Open seats → normal description + action
                      //   2. Full + bots → just-kick popup. The
                      //      confirm only kicks the bots (no chained
                      //      auto-fill) and KEEPS the Tools menu open
                      //      so the user can pick whichever ★ they
                      //      want next now that seats are empty.
                      //   3. Full + all humans → button disabled, no
                      //      popup.
                      function toolProps({
                        label, fullLabel, color, action, description, confirmLabel
                      }) {
                        const triggerLabel = !isFull
                          ? label
                          : fullWithBots
                            ? fullLabel
                            : `${fullLabel} · all real players`
                        const desc = !isFull
                          ? description
                          : fullWithBots
                            ? `Table is full. Kick the ${kickCount} bot${kickCount === 1 ? '' : 's'} to free up seats?`
                            : ''
                        const confirm = !isFull
                          ? confirmLabel
                          : fullWithBots
                            ? `Kick ${kickCount} bot${kickCount === 1 ? '' : 's'}`
                            : ''
                        return {
                          triggerLabel,
                          triggerClassName: `block w-full text-left text-xs font-bold ${color} hover:bg-zinc-800 px-0 py-1 disabled:opacity-40 disabled:cursor-not-allowed`,
                          description: desc,
                          confirmLabel: confirm,
                          align: 'left',
                          disabled: fullNoKick,
                          onConfirm: () => {
                            if (fullNoKick) return
                            if (fullWithBots) {
                              // Two-step flow: this confirm only kicks
                              // the bots. The Tools menu stays open so
                              // the user can immediately click the
                              // same (or a different) ★ tool now that
                              // there are empty seats.
                              send('poker_kick_all_bots')
                              return
                            }
                            action()
                            setTableMenuOpen(false)
                          }
                        }
                      }

                      return (
                        <>
                          {/* ── Invite friend ── */}
                          {authUser && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Invite friend (${openSlots} seat${openSlots === 1 ? '' : 's'} open)`,
                                  fullLabel: '★ Invite friend · Table full',
                                  color: 'text-violet-200',
                                  description: 'Search a registered user by name and DM them a one-click "join this table" invite. They sit down with the same chip stack as you.',
                                  confirmLabel: 'Open invite picker',
                                  kickAndAction: 'open the invite picker',
                                  action: () => setInviteOpen(true)
                                })}
                              />
                            </div>
                          )}
                          {/* ── ★ Auto-fill (public top bots) ── */}
                          {(!isSpectator || isArena) && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Auto-Fill ${openSlots} Empty Seat${openSlots === 1 ? '' : 's'}`,
                                  fullLabel: '★ Auto-Fill · Full',
                                  color: 'text-amber-200',
                                  description: `Seats ${openSlots} top-rated public bot${openSlots === 1 ? '' : 's'} from the leaderboard into your open seat${openSlots === 1 ? '' : 's'}. They'll each start with the same chip stack as you (1000 minimum). Different ELOs to give you a mixed lobby.`,
                                  confirmLabel: `Seat ${openSlots} bot${openSlots === 1 ? '' : 's'}`,
                                  kickAndAction: 'seat top-rated public bots',
                                  action: () => send('poker_auto_fill_bots')
                                })}
                              />
                            </div>
                          )}
                          {/* ── ★ NN Squad (tiers 1-5) ── */}
                          {(!isSpectator || isArena) && authUser && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Seat my NN Squad (${Math.min(openSlots, 5)})`,
                                  fullLabel: '★ NN Squad · Full',
                                  color: 'text-cyan-200',
                                  description: "Seats your 5 baseline neural bots (Neuron α–ε, tiers 1–5: REINFORCE, REINFORCE+baseline, MLP 1×8, Q-learning) into the open seats. They'll learn from every hand if you've enabled training persistence.",
                                  confirmLabel: 'Seat NN squad',
                                  kickAndAction: 'seat your NN squad',
                                  action: () => send('poker_auto_fill_neural')
                                })}
                              />
                            </div>
                          )}
                          {/* ── ★ MLP Squad (tiers 6-10) ── */}
                          {(!isSpectator || isArena) && authUser && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Seat my MLP Squad (${Math.min(openSlots, 5)})`,
                                  fullLabel: '★ MLP Squad · Full',
                                  color: 'text-purple-200',
                                  description: 'Seats your 5 deep-MLP variants (Neuron ζ–κ, tiers 6–10: MLP 1×16, 2×16, 1×32, 3×16, 2×32) into the open seats. These step up from the 1×8 baseline with wider and deeper networks.',
                                  confirmLabel: 'Seat MLP squad',
                                  kickAndAction: 'seat your MLP squad',
                                  action: () => send('poker_auto_fill_mlp')
                                })}
                              />
                            </div>
                          )}
                          {/* ── ★ Custom bots ── */}
                          {(!isSpectator || isArena) && authUser && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Seat my custom bots (${Math.min(openSlots, 5)})`,
                                  fullLabel: '★ Custom · Full',
                                  color: 'text-violet-200',
                                  description: 'Seats your own user-coded (rule-based) bots into the open seats, sorted by ELO. Skips clones and neural bots — only the JS bots you wrote yourself.',
                                  confirmLabel: 'Seat custom bots',
                                  kickAndAction: 'seat your custom bots',
                                  action: () => send('poker_auto_fill_custom')
                                })}
                              />
                            </div>
                          )}
                        </>
                      )
                    })()}
                    {(!isSpectator || isArena) && (
                      <button type="button" onClick={() => openPokerPanel('bots')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                        Add Bots
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

                    {/* ── PROFILE ─────────────────────────────────── */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Profile</div>
                    <button type="button" onClick={() => openPokerPanel('skin')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Player Skin
                    </button>
                    <button type="button" onClick={() => openPokerPanel('profile')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Edit Profile
                    </button>

                    {/* ── RESET / BIG YAHU ─────────────────────────── */}
                    {/* Headerless pinned-bottom group. Kept separated by
                        a border-t so it doesn't blur into the Profile
                        section above; matches the prior placement. */}
                    {!isSpectator && (
                      <button type="button" onClick={() => openPokerPanel('reset')} className="block w-full border-t border-zinc-800 px-3 py-2 text-left text-xs font-bold text-red-200 hover:bg-zinc-800">
                        Reset Money
                      </button>
                    )}
                    {!isSpectator && (
                      // Big Yahu in Israel blue — the unlock awards Israel-themed
                      // emotes (✡️ / 🇮🇱), so the call action wears the colors.
                      <button type="button" onClick={() => openPokerPanel('big_yahu')} className="block w-full px-3 py-2 text-left text-xs font-bold text-sky-300 hover:bg-zinc-800">
                        Call Big Yahu
                      </button>
                    )}
                  </div>
                </div>
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

      {/* Persistent finance widget. Wrapped in a centered max-w-7xl band so
          on wide screens the widget aligns to the SAME left edge as the
          Arena / Spectating badges and PhaseLabel in the header row, instead
          of sticking to the viewport edge. pointer-events-none on the wrap
          lets table clicks pass through; the widget itself re-enables them. */}
      {financesWidgetOpen && joined && (
        <div className="pointer-events-none fixed inset-x-0 top-12 z-[70] sm:top-14">
          <div className="relative mx-auto max-w-7xl">
            <div className="pointer-events-auto absolute left-3 top-0 w-[180px] max-w-[60vw] rounded-xl border border-zinc-600/50 bg-zinc-800/95 px-2.5 py-1.5 text-white shadow-2xl backdrop-blur-md sm:w-[200px] md:left-4">
              <div className="flex items-center justify-between gap-1.5">
                <div className="text-[9px] font-black uppercase tracking-wider text-zinc-500">Net now</div>
                <button
                  type="button"
                  onClick={() => setFinancesWidgetOpen(false)}
                  aria-label="Close finance widget"
                  className="-mr-1 rounded px-1 text-base leading-none text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  ×
                </button>
              </div>
              <button
                type="button"
                onClick={() => openPokerPanel('finances')}
                className="block w-full text-left"
                title="Open full finances breakdown"
              >
                <div className="text-base font-black tabular-nums leading-tight text-white">
                  ${liquidatedSummary.liquidated.toLocaleString()}
                </div>
                {/* Only the mark-to-market crypto delta is shown as the
                    "unrealized" signal. Bank loans and peer loans don't
                    count — they're known liabilities, not P/L swings — so
                    taking a loan no longer turns the widget red. */}
                {(liquidatedSummary.cryptoValue > 0 || liquidatedSummary.cryptoCost > 0) ? (
                  <div className={`text-[10px] font-bold tabular-nums leading-tight ${liquidatedSummary.cryptoPnl > 0 ? 'text-emerald-300' : liquidatedSummary.cryptoPnl < 0 ? 'text-red-300' : 'text-zinc-400'}`}>
                    {liquidatedSummary.cryptoPnl >= 0 ? '+' : ''}${liquidatedSummary.cryptoPnl.toLocaleString()} unrealized
                  </div>
                ) : (
                  <div className="text-[10px] font-bold tabular-nums leading-tight text-zinc-500">
                    liquidated stack
                  </div>
                )}
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] font-bold text-zinc-500">
                  {liquidatedSummary.bankDebt > 0 && <span>Bank −${liquidatedSummary.bankDebt.toLocaleString()}</span>}
                  {liquidatedSummary.parked > 0 && <span className="text-amber-300/80">Bets ${liquidatedSummary.parked.toLocaleString()}</span>}
                  {(liquidatedSummary.peerOwedIn || liquidatedSummary.peerOwedOut) > 0 && (
                    <span>Peer {liquidatedSummary.peerOwedIn - liquidatedSummary.peerOwedOut >= 0 ? '+' : '-'}${Math.abs(liquidatedSummary.peerOwedIn - liquidatedSummary.peerOwedOut).toLocaleString()}</span>
                  )}
                  {(liquidatedSummary.cryptoValue > 0 || liquidatedSummary.cryptoCost > 0) && (
                    <span className={liquidatedSummary.cryptoPnl >= 0 ? 'text-emerald-300/80' : 'text-red-300/80'}>
                      Crypto {liquidatedSummary.cryptoPnl >= 0 ? '+' : ''}${liquidatedSummary.cryptoPnl.toLocaleString()}
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {activePokerPanel && (
        // The Add Bots and Bot Arena panels are picker-heavy and look
        // cramped in the standard 460px max. They get a wider max
        // (640px) so the pill picker can breathe without forcing
        // every other tool to widen.
        <div
          ref={pokerPanelRef}
          className={`fixed right-3 top-16 z-[90] max-h-[calc(100dvh-5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-zinc-600/60 bg-zinc-900/95 p-3 text-white shadow-2xl backdrop-blur-md sm:right-4 sm:top-20 ${
            activePokerPanel === 'bots' || activePokerPanel === 'arena'
              ? 'max-w-[640px]'
              : 'max-w-[460px]'
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-black truncate">
              {activePokerPanel === 'help' ? 'How to Play'
                : activePokerPanel === 'hand' ? 'Current Hand'
                : activePokerPanel === 'bots' ? 'Add Bots'
                : activePokerPanel === 'bank' ? 'Bank Account'
                : activePokerPanel === 'profile' ? 'Edit Profile'
                : activePokerPanel === 'blinds' ? 'Change Blinds'
                : activePokerPanel === 'reset' ? 'Reset Money'
                : activePokerPanel === 'big_yahu' ? 'Call Big Yahu'
                : activePokerPanel === 'contest' ? 'Contest Mode'
                : activePokerPanel === 'arena' ? 'Bot Arena'
                : activePokerPanel === 'daily' ? 'Daily Challenge'
                : activePokerPanel === 'skin' ? 'Player Skin'
                : activePokerPanel === 'crypto' ? 'Crypto Market'
                : activePokerPanel === 'finances' ? 'Finances'
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

          {activePokerPanel === 'bots' && (() => {
            // Dedupe roster: your own public bots only show under
            // "Your bots", never both there and in the public strip.
            const mineIds = new Set(botRoster.mine.map(b => b.id))
            const publicOnly = botRoster.public.filter(b => !mineIds.has(b.id))
            const mineGroups = subgroupsFromBuckets(bucketByCategory(botRoster.mine))
            const publicGroups = subgroupsFromBuckets(bucketByCategory(publicOnly))
            const selectedCount = addBotSelection.size
            // Seated bots — live snapshot from the game state. Lets users
            // see (and kick) bots currently at the table without
            // bouncing to the arena panel. Same pattern as the arena
            // lineup display.
            const seatedBots = (gameState?.players || []).filter(p => p && p.isBot)

            // One labeled strip of pills. Header has a select-all
            // toggle that flips its label based on current state.
            function PillStrip({ label, accent, bots, ownerLabelFn }) {
              if (bots.length === 0) return null
              const ids = bots.map(b => b.id)
              const allSelected = ids.every(id => addBotSelection.has(id))
              const anySelected = ids.some(id => addBotSelection.has(id))
              return (
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-[9px] font-black uppercase tracking-widest ${accent}`}>{label}</span>
                      <span className="text-[9px] font-bold text-zinc-500">({bots.length})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => addBotToggleMany(ids, allSelected ? 'deselect' : 'select')}
                      className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-200 hover:bg-zinc-700"
                    >
                      {allSelected ? 'Unselect all' : anySelected ? 'Select rest' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {bots.map(b => (
                      <BotPill
                        key={b.id}
                        bot={b}
                        useBotAvatar
                        selected={addBotSelection.has(b.id)}
                        onToggle={() => addBotToggle(b.id)}
                        ownerLabel={ownerLabelFn ? ownerLabelFn(b) : undefined}
                      />
                    ))}
                  </div>
                </div>
              )
            }

            return (
              <div className="space-y-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  Tap the bots to seat. They each sit with the same chip stack as you (1000 minimum). Pick as many as you want — they'll all be added when you hit Add.
                </div>

                {/* ── Bots currently at the table ── */}
                {/* Mirrors the Bot Arena panel's seated-bots strip so
                    users can see (and kick) the table's current lineup
                    without bouncing between panels. Updates live from
                    gameState.players via the WS feed. */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-2.5">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
                      Bots at the table ({seatedBots.length}/5)
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* Bulk kick — only shows once 2+ bots are
                          seated; for a single bot the × on its chip
                          is faster. ConfirmPopoverButton so a misclick
                          doesn't wipe the whole table. */}
                      {seatedBots.length >= 2 && (
                        <ConfirmPopoverButton
                          triggerLabel={`Kick all (${seatedBots.length})`}
                          triggerClassName="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-200 hover:bg-red-500/20"
                          description={`Remove all ${seatedBots.length} bots from the table in one shot. The empty seats stay open — use a ★ tool below to seat fresh bots, or invite a friend.`}
                          confirmLabel="Kick all bots"
                          align="right"
                          onConfirm={() => send('poker_kick_all_bots')}
                        />
                      )}
                      <Link href="/poker/bots" className="text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">
                        Manage →
                      </Link>
                    </div>
                  </div>
                  {seatedBots.length === 0 ? (
                    <div className="text-[10px] font-bold text-zinc-500 text-center py-1">No bots at the table yet.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {seatedBots.map(b => (
                        <span key={b.id} className="inline-flex items-center gap-1 rounded-md border border-zinc-700/70 bg-zinc-900/60 pl-1 pr-0.5 py-0.5">
                          <BotAvatar name={b.username} color={b.botColor} textColor={b.botTextColor} size={18} />
                          <span className="max-w-[90px] truncate text-[10px] font-black text-white">{b.username}</span>
                          <button
                            type="button"
                            onClick={() => removeBotFromTable(b.id)}
                            className="ml-0.5 rounded px-1 text-[10px] font-black text-red-200 hover:bg-red-500/20"
                            title="Remove bot from table"
                            aria-label={`Remove ${b.username}`}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Sticky action bar — count + Add + Clear. */}
                <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 border-b border-zinc-700/70 bg-zinc-900/95 px-3 py-2 backdrop-blur">
                  <div className="text-[11px] font-black text-zinc-200">
                    {selectedCount === 0
                      ? 'Nothing selected'
                      : `${selectedCount} bot${selectedCount === 1 ? '' : 's'} selected`}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedCount > 0 && (
                      <button
                        type="button"
                        onClick={addBotClearSelection}
                        className="rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                      >
                        Clear
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={addBotCommitSelection}
                      disabled={selectedCount === 0}
                      className="rounded-md border border-emerald-500/50 bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      Add {selectedCount > 0 ? selectedCount : ''}
                    </button>
                  </div>
                </div>

                {botRoster.loading && (
                  <div className="text-xs font-bold text-zinc-500 text-center py-2">Loading roster…</div>
                )}
                {botRoster.error && (
                  <div className="text-xs font-bold text-red-300 text-center py-2">{botRoster.error}</div>
                )}

                {/* ── Your bots ── */}
                {authUser && botRoster.mine.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-emerald-200">Your bots</div>
                      <Link href="/poker/bots" className="text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">
                        Manage →
                      </Link>
                    </div>
                    {mineGroups.map(g => (
                      <PillStrip key={g.key} label={g.label} accent={g.accent} bots={g.bots} />
                    ))}
                  </div>
                )}
                {authUser && !botRoster.loading && botRoster.mine.length === 0 && (
                  <a
                    href="/poker/bots"
                    className="block rounded-md border border-zinc-700/70 bg-zinc-950/40 px-2 py-3 text-center text-xs font-bold text-amber-200 hover:border-amber-400/40 hover:bg-zinc-900"
                  >
                    No bots yet — <span className="underline">build your first one →</span>
                  </a>
                )}

                {/* ── Public roster ── */}
                <div className="space-y-2 rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Public roster</div>
                    <button
                      type="button"
                      onClick={refreshBotRoster}
                      className="rounded-md border border-zinc-500/50 bg-zinc-700 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-zinc-600"
                    >
                      Refresh
                    </button>
                  </div>
                  {!botRoster.loading && publicOnly.length === 0 && (
                    <div className="text-xs font-bold text-zinc-500 text-center py-2">No public bots yet.</div>
                  )}
                  {publicGroups.map(g => (
                    <PillStrip
                      key={g.key}
                      label={g.label}
                      accent={g.accent}
                      bots={g.bots}
                      ownerLabelFn={(b) => b.ownerDisplayName ? `by ${b.ownerDisplayName}` : null}
                    />
                  ))}
                </div>
              </div>
            )
          })()}

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
                {/* Scroll wrap — the list now goes up to 16k/32k so cap
                    height and let users scroll instead of pushing other
                    tools panel content offscreen. overscroll-contain so
                    flicks don't bubble into the page scroll. */}
                <div className="max-h-[60dvh] overflow-y-auto overscroll-contain space-y-1.5 pr-1">
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
                          <div className="text-[10px] font-bold text-zinc-300">{level.label}</div>
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

                  {/* Pill-style multi-select picker — matches the Add
                      Bots tool and the training simulator. Pick as many
                      as you want, "Add N" commits all at once.
                      The ★ auto-fill shortcuts (top bots / NN squad /
                      custom / MLP squad) live in the Tools menu so
                      they aren't duplicated here. */}
                  {(() => {
                    const mineIds = new Set(botRoster.mine.map(b => b.id))
                    const publicOnly = botRoster.public.filter(b => !mineIds.has(b.id))
                    const mineGroups = subgroupsFromBuckets(bucketByCategory(botRoster.mine))
                    const publicGroups = subgroupsFromBuckets(bucketByCategory(publicOnly))
                    const selectedCount = arenaPickQueue.length

                    function PillStrip({ label, accent, bots, ownerLabelFn }) {
                      if (bots.length === 0) return null
                      const ids = bots.map(b => b.id)
                      const allSelected = ids.every(id => arenaPickQueue.includes(id))
                      const anySelected = ids.some(id => arenaPickQueue.includes(id))
                      return (
                        <div>
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="flex items-baseline gap-1.5">
                              <span className={`text-[9px] font-black uppercase tracking-widest ${accent}`}>{label}</span>
                              <span className="text-[9px] font-bold text-zinc-500">({bots.length})</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => arenaQueueToggleMany(ids, allSelected ? 'deselect' : 'select')}
                              className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-200 hover:bg-zinc-700"
                            >
                              {allSelected ? 'Unselect all' : anySelected ? 'Select rest' : 'Select all'}
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {bots.map(b => (
                              <BotPill
                                key={b.id}
                                bot={b}
                                useBotAvatar
                                selected={arenaPickQueue.includes(b.id)}
                                onToggle={() => arenaQueueToggle(b.id)}
                                ownerLabel={ownerLabelFn ? ownerLabelFn(b) : undefined}
                              />
                            ))}
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div className="space-y-3">
                        {/* Sticky action bar — count + Add + Clear */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[11px] font-black text-zinc-200">
                            {selectedCount === 0
                              ? 'Nothing selected'
                              : `${selectedCount} bot${selectedCount === 1 ? '' : 's'} selected`}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {selectedCount > 0 && (
                              <button
                                type="button"
                                onClick={arenaQueueClear}
                                className="rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700"
                              >
                                Clear
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={arenaQueueFlush}
                              disabled={selectedCount === 0}
                              className="rounded-md border border-emerald-500/50 bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                            >
                              Add {selectedCount > 0 ? selectedCount : ''}
                            </button>
                          </div>
                        </div>

                        {botRoster.loading && (
                          <div className="text-[10px] font-bold text-zinc-500 text-center py-1">Loading roster…</div>
                        )}

                        {authUser && botRoster.mine.length > 0 && (
                          <div className="space-y-2 rounded-md border border-zinc-700/70 bg-zinc-950/30 p-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-200">Your bots</div>
                            {mineGroups.map(g => (
                              <PillStrip key={g.key} label={g.label} accent={g.accent} bots={g.bots} />
                            ))}
                          </div>
                        )}

                        <div className="space-y-2 rounded-md border border-zinc-700/70 bg-zinc-950/30 p-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Public roster</div>
                          {!botRoster.loading && publicOnly.length === 0 && (
                            <div className="text-[10px] font-bold text-zinc-500 text-center py-1">No public bots yet.</div>
                          )}
                          {publicGroups.map(g => (
                            <PillStrip
                              key={g.key}
                              label={g.label}
                              accent={g.accent}
                              bots={g.bots}
                              ownerLabelFn={(b) => b.ownerDisplayName ? `by ${b.ownerDisplayName}` : null}
                            />
                          ))}
                        </div>
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
                  {/* 12 tiers won't fit two-up without overflow; wrap in
                      a height-capped scroll so the rest of the arena tools
                      panel stays visible. */}
                  <div className="max-h-44 overflow-y-auto overscroll-contain grid grid-cols-2 gap-1.5 pr-1">
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
                      <div className="max-h-44 overflow-y-auto overscroll-contain grid grid-cols-2 gap-1.5 pr-1">
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
                    {/* 12-row picker fits the tools-panel max-height
                        budget on most viewports; cap + scroll keeps the
                        big-stakes tiers reachable without pushing other
                        controls offscreen. */}
                    <div className="max-h-[55dvh] overflow-y-auto overscroll-contain space-y-1.5 pr-1">
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
              {/* Israel-blue palette throughout — matches the Tools menu
                  entry and the flag colors the unlock awards. */}
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3">
                <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-sky-200">
                  ☎ Calling Benjamin Netanyahu
                </div>
                <div className="text-xs font-bold text-zinc-100 leading-snug space-y-1.5">
                  <div>The Prime Minister picks up. After 30 seconds of small talk:</div>
                  <ul className="ml-4 list-disc space-y-0.5 text-zinc-200">
                    <li>Every outstanding loan is forgiven — you keep the chips.</li>
                    <li>Your credit score is restored to default.</li>
                    <li>Your P/L is wiped to <span className="text-emerald-300">$0</span> (your stack stays).</li>
                    <li>Bank slot tier resets to 2 — but you can climb again.</li>
                    <li>You permanently unlock <span className="text-sky-200">✡️</span> and <span className="text-sky-200">🇮🇱</span> in your emote palette.</li>
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
                    ? 'bg-sky-500 hover:bg-sky-400 border-sky-300/70 text-white animate-pulse'
                    : 'bg-sky-500/15 hover:bg-sky-500/25 border-sky-500/50 text-sky-100'
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

          {activePokerPanel === 'daily' && (
            <DailyChallengePanel
              selfProgress={bankState.dailyProgress ?? 0}
              selfCompleted={!!bankState.dailyCompleted}
              dailiesCompleted={bankState.dailiesCompleted ?? 0}
            />
          )}

          {activePokerPanel === 'skin' && (
            <SkinSelector
              currentSkinId={bankState.skinId ?? 0}
              currentCustomSkin={bankState.customSkin ?? null}
              dailiesCompleted={bankState.dailiesCompleted ?? 0}
              signedIn={!!authUser}
              onApplied={(skinId, customSkin) => {
                // Optimistically reflect the new skin so the nameplate
                // updates immediately — server already wrote it; the next
                // room_update will confirm.
                setBankState(prev => ({ ...prev, skinId, customSkin }))
              }}
            />
          )}

          {activePokerPanel === 'crypto' && (
            <CryptoMarketPanel
              crypto={cryptoState}
              myChips={bankState.chips ?? 0}
              canTrade={joined}
              onBuy={cryptoBuy}
              onSell={cryptoSell}
              onCreate={cryptoCreate}
              onRug={cryptoRug}
            />
          )}

          {activePokerPanel === 'finances' && (
            <FinancesPanel
              myPlayerId={playerId}
              myChips={bankState.chips ?? 0}
              loans={bankState.loans || []}
              openSideBetStake={bankState.openSideBetStake ?? 0}
              peerLoans={(gameState?.players?.find(p => p.id === playerId)?.peerLoans)
                || (gameState?.spectators?.find?.(p => p.id === playerId)?.peerLoans)
                || []}
              crypto={cryptoState}
            />
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
          <div className="absolute top-[12%] sm:top-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-0 max-w-[40vw] sm:max-w-none">
            <PotChips amount={gameState?.pot || 0} />
            <div className="text-[10px] sm:text-xs text-white/60 font-bold tracking-widest bg-black/30 px-2 py-0.5 rounded-md mt-1">POT</div>
            <div className="font-black text-xl sm:text-3xl text-white drop-shadow-md tabular-nums">{gameState?.pot || 0}</div>
          </div>

          {splitPotNotice.length > 0 && (
            <div className="absolute top-[34%] left-1/2 z-50 -translate-x-1/2 max-w-[min(90vw,420px)] rounded-md border border-amber-300/70 bg-zinc-950/90 px-3 py-1.5 text-center text-[10px] sm:text-xs font-black uppercase tracking-wide text-amber-100 shadow-xl space-y-0.5 break-words">
              {splitPotNotice.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}

          {/* Community Cards */}
          <div className="absolute top-[50%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-1 sm:gap-2 z-0">
            {(gameState?.communityCards || []).map((card, i) => (
              <CardSprite key={i} card={card} highlight={isWinningCard(card)} className="w-[14vw] sm:w-[60px] md:w-[80px]" />
            ))}
            {Array.from({ length: Math.max(0, 5 - (gameState?.communityCards?.length || 0)) }).map((_, i) => (
              <div key={`e-${i}`} className="rounded-md w-[14vw] sm:w-[60px] md:w-[80px] aspect-[80/110]" style={{ border: '1px dashed rgba(255,255,255,0.05)' }} />
            ))}
          </div>

          {/* Players */}
          {orderedPlayers.map((player, seatIndex) => {
            const pos = SEATS[seatIndex]
            if (!pos) return null
            const isMe = player.id === playerId
            // Active-player highlight is only meaningful during live action.
            // Once the phase flips to showdown, `activePlayerId` still points
            // at the last actor (the engine doesn't clear it) — and we'd
            // otherwise leave them lit up next to the actual winner. Gate on
            // phase so showdown only highlights the winners.
            const isActive = gameState?.activePlayerId === player.id && phase !== 'showdown'
            // Arenas don't enforce a turn timer (bots can't be kicked), so the
            // red "running out of time" pulse never makes sense there — keep
            // the active highlight amber.
            const isTurnWarning = isActive && isActiveTurnWarning && !isArena
            const isDealer = getOriginalIndex(player) === gameState?.dealerIndex
            const isPlayerWaiting = player.waitingNextHand

            const isWinner = phase === 'showdown' && showdownData?.winners?.some(w => w.playerId === player.id)
            // Drives the yellow ring + bouncing arrow. During the hand it
            // follows the active player; on showdown it jumps to the
            // winner(s) so the table can see who scooped the pot.
            const isHighlighted = isActive || isWinner
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
                      overflow-x-hidden context. Human seats are clickable
                      to open the profile popover; bots and "you" aren't
                      (your own profile lives behind the account menu). */}
                  <div
                    data-seat-id={player.id}
                    role={isMe ? undefined : 'button'}
                    tabIndex={isMe ? undefined : 0}
                    onClick={isMe ? undefined : (e) => {
                      e.stopPropagation()
                      setPopoverSeatId(player.id)
                      setPopoverSeat(player)
                    }}
                    onKeyDown={isMe ? undefined : (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setPopoverSeatId(player.id)
                        setPopoverSeat(player)
                      }
                    }}
                    style={isMe && (bankState.skinId ?? 0) !== 0
                      ? { background: resolveSkinCss(bankState.skinId, bankState.customSkin) }
                      : undefined}
                    className={`
                    px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-center w-[120px] sm:w-[140px] shadow-xl
                    transition-all border z-10 relative ${(isMe && (bankState.skinId ?? 0) !== 0) ? '' : 'bg-zinc-800/95'}
                    ${!isMe ? 'cursor-pointer hover:border-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-300' : ''}
                    ${player.folded && !isPlayerWaiting ? 'opacity-50' : ''}
                    ${isPlayerWaiting ? 'opacity-60' : ''}
                    ${isHighlighted
                      ? isTurnWarning
                        ? 'ring-4 ring-red-400 border-red-400/80 shadow-[0_0_30px_rgba(239,68,68,0.85)] bg-red-950/70'
                        : 'ring-4 ring-amber-300 border-amber-300/80 shadow-[0_0_28px_rgba(251,191,36,0.85)] bg-amber-900/40'
                      : 'border-zinc-600/50'}
                  `}>
                    <SeatEmotes
                      emotes={playerEmotes}
                      className="absolute -top-3 -left-2 sm:-top-3.5 sm:-left-2.5 z-40"
                    />
                    {isHighlighted && (
                      <div className={`absolute -top-4 sm:-top-5 left-1/2 -translate-x-1/2 text-xs sm:text-sm animate-bounce ${isTurnWarning ? 'text-red-500' : 'text-amber-400'}`}>▼</div>
                    )}
                    <div className="text-[10px] sm:text-sm font-bold text-white flex items-center justify-center gap-1 whitespace-nowrap min-w-0">
                      <span className="truncate min-w-0">{isMe ? 'You' : player.username}</span>
                      {player.isBot && (
                        <span className="shrink-0 text-[8px] sm:text-[9px] font-black uppercase tracking-widest text-zinc-400">BOT</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[9px] sm:text-xs text-zinc-200 font-medium whitespace-nowrap">
                      {/* Hide the avatar at showdown so the hand name
                          ("Two Pair, Jacks & 6s" etc.) has the full
                          nameplate width to render without clipping.
                          The avatar still shows in every other phase. */}
                      {phase === 'showdown' && handName && !player.folded ? null : player.isBot ? (
                        <BotAvatar name={player.username} color={player.botColor || '#3b82f6'} textColor={player.botTextColor || 'auto'} avatarUrl={player.botAvatarUrl} size={24} className="h-5 w-5 sm:h-6 sm:w-6" />
                      ) : (
                        <ProfileAvatar
                          avatarId={player.avatarId}
                          avatarUrl={player.avatarUrl}
                          name={player.username}
                          nameKey={player.id}
                          className="h-5 w-5 sm:h-6 sm:w-6"
                        />
                      )}
                      {isPlayerWaiting ? (
                        <span className="text-zinc-400 font-bold italic">Waiting...</span>
                      ) : phase === 'showdown' && handName && !player.folded ? (
                        <span className="block max-w-full truncate text-amber-300 font-bold">{handName}</span>
                      ) : (
                        `${player.chips} chips`
                      )}
                    </div>
                    {/* Bot Remove button removed from the table nameplate — bots
                        can only be removed via the Add Bot panel (regular tables)
                        or the Arena tools panel (arenas). Keeps the table chrome
                        clean and the remove flow centralized. */}
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

      {/* The spectator bankroll badge now lives inline in the top header
          row (next to the Arena/Spectating/Phase pills). See the Top
          Header Row above — that placement prevents the centered float
          from overlapping the Tools/Lobby cluster on narrow widths. */}

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
          chatVisible={chatDockVisible}
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

      {/* Two popovers driven by the same `popoverSeat` state — one for
          humans (lifetime profile + peer-loans), one for bots (lifetime
          stats + kind badge + jump-to-edit). Only one renders at a time
          because exactly one of `isBot` is true per seat. */}
      <PlayerProfilePopover
        open={!!popoverSeat && !popoverSeat.isBot}
        seat={popoverSeat}
        anchorSeatId={popoverSeatId}
        onClose={() => { setPopoverSeat(null); setPopoverSeatId(null) }}
        // Peer-loan wiring — viewer's id + chips, every open negotiation,
        // and viewer's own peerLoans (pulled off their seat). The popover
        // hands these to PeerLoanPanel which filters by counterparty.
        myId={playerId}
        myChips={myPlayer?.chips ?? bankState.chips ?? 0}
        myPeerLoans={(myPlayer?.peerLoans) || []}
        negotiations={peerNegotiations}
        onPeerLoanSend={(type, data) => send(type, data)}
        viewerIsSpectator={isSpectator}
      />

      <BotProfilePopover
        open={!!popoverSeat && popoverSeat.isBot}
        seat={popoverSeat}
        anchorSeatId={popoverSeatId}
        onClose={() => { setPopoverSeat(null); setPopoverSeatId(null) }}
        viewerUserId={authUser?.id ?? null}
      />

      {/* "Invite to table" popover — search users by username, send a
          DM with kind=table_invite. Rendered at the page level so the
          z-index stack stays predictable above the table chrome. */}
      <InviteToTablePopover
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roomId={currentRoomId}
        fromDisplayName={authUser?.displayName || username}
      />

      {/* Floating feed window — opened from the Tools menu. Movable,
          resizable, persisted position/size. Reuses PostCard + PostComposer
          so the in-table view matches /feed exactly. */}
      <FeedWindow
        open={feedWindowOpen}
        onClose={() => { setFeedWindowOpen(false); setFeedOpenedFromTools(false) }}
        // Show the back arrow only when the window was opened via the
        // ★ Social Media entry in the Tools menu. Other entry points
        // (e.g., notifications) don't have a Tools menu to return to.
        onBack={feedOpenedFromTools ? () => {
          setFeedWindowOpen(false)
          setFeedOpenedFromTools(false)
          setTableMenuOpen(true)
        } : null}
      />

      {/* Run-it-twice flow: vote modal (server starts when both humans are
          all-in pre-river with pot ≥ threshold) + ephemeral step banner
          announcing each runout's winner during the reveal sequence. */}
      <RunItTwiceVote
        vote={runoutVote}
        myPlayerId={playerId}
        submissions={runoutSubmissions}
        onSubmit={(choice) => {
          if (!runoutVote?.voteId) return
          send('runout_vote_submit', { voteId: runoutVote.voteId, choice })
        }}
      />
      {runoutStepBanner && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-[140] -translate-x-1/2 animate-sidebet-enter">
          <div className="rounded-xl border border-amber-500/60 bg-zinc-900/95 px-4 py-2 text-center shadow-2xl backdrop-blur-md">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Run {runoutStepBanner.runIndex + 1} of {runoutStepBanner.totalRuns}
            </div>
            <div className="mt-0.5 text-sm font-black text-white">
              {(runoutStepBanner.winners || []).length === 0
                ? 'Split board'
                : (runoutStepBanner.winners || [])
                    .map(w => `${w.username} +${w.chips}`)
                    .join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Natural Flow Bottom UI — `md:relative` makes this the positioning
          anchor for the right column when seated (sidebets + chat are
          absolutely positioned inside it at md+ so they share the action
          panel's baseline AND don't inflate the row's height when sidebets
          expands). */}
      <div className={`w-full flex flex-col md:flex-row md:relative justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto ${isSpectator ? 'pb-[310px] md:pb-0 md:min-h-[210px]' : 'pb-4 md:pb-0'}`}>
        
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
        // order-2 on mobile so sidebets (order-1) renders above this column,
        // keeping the side-bet dock parallel with the fold/check menu top
        // and preventing chat-opening from pushing it further down. md+ is
        // flex-row + sidebets is md:absolute, so order is a no-op there.
        <div className="order-2 w-[92%] max-w-[360px] md:order-1 md:w-[320px] md:max-w-none shrink-0">
          <div className="flex flex-col gap-1.5 py-2 px-3 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md">
            <div className={`text-[11px] font-semibold text-center leading-tight ${statusClass}`}>
              {statusText}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => send('poker_fold')}
                disabled={!canAct}
                className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
              >
                Fold
              </button>
              {toCall === 0 ? (
                <button
                  onClick={() => send('poker_check')}
                  disabled={!canAct}
                  className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
                >
                  Check
                </button>
              ) : (
                <button
                  onClick={() => send('poker_call')}
                  disabled={!canAct}
                  className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600"
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
                className={`col-span-2 px-2 py-1 rounded-md text-xs font-bold transition-all border text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
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
            <div className={`flex items-center gap-2 w-full ${(!canAct || !hasRaiseRoom) ? 'opacity-40' : ''}`}>
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
                className="px-2 py-1 rounded-md text-xs font-bold transition-all whitespace-nowrap bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:hover:bg-zinc-700"
              >
                Raise {safeRaise}
              </button>
            </div>
          </div>
          {canUseEmotes && (
            <>
              <div className={`grid gap-1 mt-1.5 py-1.5 px-1.5 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md ${
                (bankState.bigYahuCalls ?? 0) > 0 ? 'grid-cols-8' : 'grid-cols-6'
              }`}>
                {getEmoteOptions({ bigYahuUnlocked: (bankState.bigYahuCalls ?? 0) > 0 }).map((emote) => (
                  <button
                    key={emote.id}
                    type="button"
                    title={emote.label}
                    aria-label={emote.label}
                    onClick={() => sendEmote(emote.id)}
                    className="h-8 rounded-md border flex items-center justify-center transition-all active:scale-95 bg-zinc-700 hover:bg-zinc-600 border-zinc-500/50 text-zinc-200"
                  >
                    <EmoteIcon emote={emote.id} />
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex overflow-hidden rounded-xl border border-zinc-600/50 bg-zinc-800/95 shadow-2xl backdrop-blur-md">
                <input
                  className="min-w-0 flex-1 bg-transparent px-3 py-1.5 text-sm text-white placeholder-zinc-400 outline-none"
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
                  className="shrink-0 px-3 text-xs font-black text-amber-100 transition-colors hover:bg-zinc-700 disabled:text-zinc-500"
                >
                  Yell
                </button>
              </div>
            </>
          )}
          {/* Chat dock — under the yell input on the left stack ONLY when
              sidebets is also visible (its normal spot). When sidebets is
              hidden, chat moves over to occupy sidebets' slot instead — see
              the sidebets IIFE below for that rendering. */}
          {chatDockVisible && sideBetsDockVisible && (
            <div className="mt-1.5 flex flex-col h-40 lg:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden">
              {chatBoxInner}
            </div>
          )}
        </div>
          )
        })()}

        {/* Stats panel — top-right, anchored to the SAME container edge as
            the Tools/Lobby buttons. Wrapped in a centered max-w-7xl band so
            on wide screens it doesn't drift to the viewport edge while the
            buttons stay inside the centered content. Click outside the
            panel auto-minimizes it (handled by a useEffect above) so it
            never shifts other UI around. The Close button exits entirely. */}
        {!isSpectator && statsMode && (
          <div className="pointer-events-none fixed inset-x-0 top-12 z-40 sm:top-14">
            <div className="relative mx-auto max-w-7xl">
              <div
                ref={statsPanelRef}
                // The equity widget's right edge has to clear the
                // global AccountDock (profile + DMs + bell stacked
                // top-right). The dock occupies ~48-56px of the right
                // margin, so we pin the panel's right edge at the
                // same column as the Tools/Lobby cluster header
                // (which uses `mr-12 sm:mr-14`). On wider expansion
                // sizes the panel still respects this offset, so the
                // dock icons stay visible no matter how the panel
                // grows.
                className={`pointer-events-auto absolute right-14 top-0 sm:right-16 ${
                  statsExpansion === 'minimized'
                    ? 'w-[180px]'
                    : statsExpansion === 'detailed'
                      ? 'w-[calc(100vw-5.5rem)] max-w-[420px]'
                      : 'w-[calc(100vw-5.5rem)] max-w-[320px]'
                }`}
              >
                <StatsPanel
                  statistics={statistics}
                  expansion={statsExpansion}
                  onSetExpansion={setStatsExpansion}
                  onClose={closeStatsPanel}
                />
              </div>
            </div>
          </div>
        )}

        {/* Side bets dock (sidebets only — chat lives under the yell input
            on the left now). Spectators get their own fixed-position chat +
            sidebets pair; seated players have the dock anchored to the
            bottom-right of the row, sharing the action panel's baseline and
            growing upward when expanded without pushing the action UI. */}
        {(() => {
          // Sidebets dock height. Two states the panel ever needs to be in:
          //   collapsed (the standard, glanceable size) — h-56 lg:h-72.
          //   expanded WITH live content — h-fit max-h-[80dvh], sized to fit
          //   the props naturally.
          // Empty state (no live props yet) keeps the collapsed height even
          // if the user has expand on; otherwise h-fit shrinks the dock to
          // the empty placeholder and the panel jitters in/out of size
          // between hands. Standardization: only show variable height when
          // there's actual content driving it.
          const hasLiveContent = (sideBetsState?.props?.length || 0) > 0
          const sidebetsHeight = (sideBetsExpanded && hasLiveContent)
            ? 'h-fit max-h-[80dvh]'
            : 'h-56 lg:h-72'

          if (isSpectator) {
            // Bot arena: only one dock at a time, both anchored to the same
            // bottom-right slot. The toggle handlers enforce mutual exclusion
            // when isArena, but a defensive guard here means even if both
            // visibility flags somehow stay true we still only render one
            // (sidebets wins the tiebreak — it's more arena-relevant).
            if (isArena) {
              if (sideBetsDockVisible) {
                return (
                  <div className={`fixed safe-bottom-offset right-3 z-40 sm:right-4 w-[calc(100vw-1.5rem)] sm:max-w-[320px] md:w-[320px] flex flex-col ${sidebetsHeight} bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
                    <SideBetsPanel
                      sideBets={sideBetsState}
                      myPlayerId={playerId}
                      myStack={myPlayer?.chips ?? bankState.chips ?? 0}
                      onPlace={placeSideBet}
                      onSell={sellSideBet}
                      expanded={sideBetsExpanded}
                      onToggleExpanded={() => setSideBetsExpanded(prev => !prev)}
                      onClose={toggleSideBetsDock}
                    />
                  </div>
                )
              }
              if (chatDockVisible) {
                return (
                  <div className="fixed safe-bottom-offset right-3 z-40 sm:right-4 w-[calc(100vw-1.5rem)] sm:max-w-[320px] md:w-[320px] flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
                    {chatBoxInner}
                  </div>
                )
              }
              return null
            }
            // Regular table spectator: both can show. Sidebets uses
            // spectator-stack-bottom (above chat on mobile, same row sm+);
            // chat is full-width on mobile and anchors left on sm+ so it
            // doesn't collide with sidebets on the right.
            return (
              <>
                {sideBetsDockVisible && (
                  <div className={`fixed spectator-stack-bottom right-3 z-40 sm:right-4 w-[calc(100vw-1.5rem)] sm:max-w-[320px] md:w-[320px] flex flex-col ${sidebetsHeight} bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
                    <SideBetsPanel
                      sideBets={sideBetsState}
                      myPlayerId={playerId}
                      myStack={myPlayer?.chips ?? bankState.chips ?? 0}
                      onPlace={placeSideBet}
                      onSell={sellSideBet}
                      expanded={sideBetsExpanded}
                      onToggleExpanded={() => setSideBetsExpanded(prev => !prev)}
                      onClose={toggleSideBetsDock}
                    />
                  </div>
                )}
                {chatDockVisible && (
                  <div className="fixed safe-bottom-offset left-3 right-3 z-40 sm:right-auto sm:left-4 sm:w-[calc(100vw-1.5rem)] sm:max-w-[320px] md:w-[320px] flex flex-col h-40 md:h-48 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
                    {chatBoxInner}
                  </div>
                )}
              </>
            )
          }

          // Non-spectator: sidebets-shaped slot on the right at md+, top of
          // the bottom row on mobile (order-1). If sidebets is hidden but
          // chat is on, the chat dock takes over the same slot — gives users
          // their full right-hand column back for chat. If both are hidden,
          // nothing renders here at all.
          const showSidebetsRight = sideBetsDockVisible
          const showChatRight = !sideBetsDockVisible && chatDockVisible
          if (!showSidebetsRight && !showChatRight) return null
          return (
            <div className="order-1 w-[92%] max-w-[360px] mx-auto md:order-2 md:absolute md:bottom-0 md:right-0 md:mx-0 md:w-auto md:max-w-none md:z-30 flex flex-col items-end gap-3 shrink-0">
              {showSidebetsRight && (
                <div className={`w-full md:w-[320px] flex flex-col ${sidebetsHeight} bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
                  <SideBetsPanel
                    sideBets={sideBetsState}
                    myPlayerId={playerId}
                    myStack={myPlayer?.chips ?? bankState.chips ?? 0}
                    onPlace={placeSideBet}
                    onSell={sellSideBet}
                    expanded={sideBetsExpanded}
                    onToggleExpanded={() => setSideBetsExpanded(prev => !prev)}
                    onClose={toggleSideBetsDock}
                  />
                </div>
              )}
              {showChatRight && (
                // Taller than the inline-left chat — when chat owns the
                // sidebets slot it has the full right column to itself, so
                // give it the same vertical footprint sidebets would have
                // had instead of the squat h-40 the inline version uses.
                <div className="w-full md:w-[320px] flex flex-col h-56 lg:h-72 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
                  {chatBoxInner}
                </div>
              )}
            </div>
          )
        })()}

      </div>
    </div>
  )
}
