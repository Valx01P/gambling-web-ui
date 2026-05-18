'use client'

import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo, useDeferredValue, startTransition } from 'react'
import { createPortal } from 'react-dom'
import PokerChip from '../components/PokerChip'
import CardSprite from '../components/CardSprite'
import { BetChips, PotChips } from '../components/ChipStack'
import { EMOTE_OPTIONS, EmoteIcon, SeatEmotes, SeatYells, getEmoteOptions } from '../components/PokerEmotes'
import ProfileSelector, { getProfileAvatar, ProfileAvatar } from '../components/ProfileSelector'
import HomeBackLink from '../components/HomeBackLink'
import RouteNavCluster from '../components/RouteNavCluster'
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
import ItemsPanel from './components/ItemsPanel'
import { setDockBotSpeed } from '../components/AccountDock'
import PeekRevealModal from './components/PeekRevealModal'
import ScamPopupModal from './components/ScamPopupModal'
import PinHackModal from './components/PinHackModal'
import PokerWindow from './components/PokerWindow'
import FloatingWindow, {
  cycleNextFloatingWindow,
  toggleHideAllFloatingWindows,
  showAllFloatingWindows,
  clearAllFloatingWindowLayouts,
  closeCurrentFloatingWindow,
  focusLastFloatingWindow,
  prevFloatingWindow,
  nextFloatingWindow,
  bumpRaisedZ,
} from '../components/FloatingWindow'
import AssetsPanel from './components/AssetsPanel'
import JobsPanel from './components/JobsPanel'
import StocksPanel from './components/StocksPanel'
import WorldPanel from './components/WorldPanel'
import InvestmentHUD from './components/InvestmentHUD'
import { resolveSkinCss } from '../lib/skinPresets'
import { buildPokerStatistics, buildSpectatorStatistics, evaluateHand, formatCard, formatPercent, getHandName } from '../lib/pokerOdds'
// Seat geometry lives in ./lib/seatLayout — shared by spectator view, the
// table render, and the chip-throw animation. Pure data + helpers, no state.
import { SEATS, getBetPosClasses, getChipThrowOrigin } from './lib/seatLayout'
import LobbyView from './components/LobbyView'
import {
  TOGGLEABLE_TOOL_IDS,
  loadPrivateRoomDisabledTools,
  savePrivateRoomDisabledTools,
} from '../lib/privateRoomTools'
import {
  TABLE_COLOR_PALETTES,
  TABLE_CUSTOM_SLOTS,
  TABLE_CUSTOM_PREFIX,
  DEFAULT_TABLE_COLOR_ID,
  useFeltColor,
  setTableColorId as setSharedTableColorId,
  setCustomColors as setSharedCustomColors,
} from '../lib/feltColor'

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
// Inverted defaults: these widgets start OFF for new users, so we store
// '1' = explicitly enabled. Anything else (including missing) = off.
// Same persistence model as chat / side-bets, just flipped polarity.
const FINANCES_WIDGET_STORAGE_KEY = 'poker_finances_widget_open'
const STATS_MODE_STORAGE_KEY = 'poker_stats_mode_on'
// HUD defaults ON — it shipped always-rendered, so existing users keep it.
// '0' = explicitly disabled. Anything else (including missing) = on.
const HUD_ENABLED_STORAGE_KEY = 'poker_investment_hud_enabled'
// Last blind level the user successfully applied to a table. Used as the
// preferred default when they next create / propose at a table.
// Legacy key that used to remember the last blinds level a user
// applied and silently re-propose it on every join. That auto-propose
// turned out to be the "everyone goes all-in for no reason" bug —
// a stale high-stakes pref would re-apply on a 1k-chip table and force
// everyone all-in just to post blinds. The key is preserved as a
// constant only to clear leftover values on load.
const BLIND_LEVEL_PREF_STORAGE_KEY = 'poker_blind_level_pref'
if (typeof window !== 'undefined') {
  try { window.localStorage.removeItem(BLIND_LEVEL_PREF_STORAGE_KEY) } catch {}
}

// Felt color: palette + state live in client/app/lib/feltColor.js so
// every page tints with the user's choice. Keep TABLE_COLOR_PALETTES
// + helpers imported above; the local felt-color state used to live
// here and was bound to /poker's lifecycle.
// Zoom-related constants come from useZoom — single source of truth.
const POKER_STARTING_CHIPS = 1000

// Mirrors server/src/config/constants.js BLIND_LEVELS — keep both lists
// in lockstep. Adding new tiers? Edit the server-side list first so the
// proposal validator accepts them, then sync this one.
//
// `label` is client-only — purely cosmetic flavor for the blinds picker.
// One unique title per tier (no bucketing) so the highest stakes don't
// keep saying the same "Mythic" tag.
// 2026-05: ladder collapsed — the poker stack is capped at 1000 chips,
// so anything beyond 50/100 forces all-ins on the post. All off-table
// money lives in the bank wallet now; blinds only need to span the
// "cheap home game → max-aggression at 1k stack" range.
const BLIND_LEVELS = [
  { id: '1_2',    small: 1,   big: 2,   label: 'Microstakes'    },
  { id: '2_3',    small: 2,   big: 3,   label: 'Loose home game'},
  { id: '5_10',   small: 5,   big: 10,  label: 'Penny ante'     },
  { id: '10_15',  small: 10,  big: 15,  label: 'Garage night'   },
  { id: '20_25',  small: 20,  big: 25,  label: 'Coffee-shop reg'},
  { id: '25_50',  small: 25,  big: 50,  label: 'Backroom pro'   },
  { id: '50_100', small: 50,  big: 100, label: 'Max aggression' },
]

// Tools-menu LRU (Recents) tracking — persisted to localStorage so the
// quick-access bar survives reloads. We store the last N opened panel
// ids in mru-first order. Destructive panels (reset / big_yahu) are
// blocked from the recents to avoid a one-click footgun.
const TOOLS_LRU_KEY = 'gwu_tools_recents'
const TOOLS_LRU_MAX = 5
const TOOLS_LRU_BLOCKLIST = new Set(['reset', 'big_yahu'])
// Set of panel ids the user has hidden from the Tools menu. Persisted
// to localStorage. The HIDDEN panel is still REACHABLE via the Recents
// bar or direct keyboard shortcuts — this just hides the button in
// the normal menu listing.
const TOOLS_HIDDEN_KEY = 'gwu_tools_hidden'
// Display metadata for the LRU pills. Keeps labels + accents in one
// place — the menu's own buttons each style themselves but the bar
// at the top is a tighter pill row that needs centralized info.
// Hover-tooltip copy for every tool-menu entry. Title attrs show on
// desktop hover; mobile users see the label + emoji. Keep these short
// — they live in the title attr, no markup support.
const TOOLS_TOOLTIPS = {
  help:     'Quick rules + how everything works',
  hand:     'Current hand details — board, odds, action history',
  session:  'Hands you\'ve played this session + P/L',
  daily:    'Daily challenge progress + reward',
  crypto:   'Trade base/meme coins, mint your own, rug it',
  items:    'Peek, swap, scam, hack — 5-hand cooldowns',
  assets:   'Buy fictional real estate; passive yield + appreciation',
  jobs:     'Claim a gig each hand — works even if you\'re broke',
  stocks:   'Trade stocks, sabotage competitors, ride earnings events',
  world:    'Claim territories, paint the map your color, release pandemics',
  influence:'Pay-to-manipulate-markets meta layer (fake news, scandals, crises)',
  bank:     'Loans + credit score + payoff',
  bots:     'Seat AI bots at the table',
  blinds:   'Propose a different blind level',
  contest:  'Auto-escalating blinds for a tournament feel',
  arena:    'Bot Arena spectator controls',
  skin:     'Customize your nameplate color',
  profile:  'Edit your username / avatar',
  reset:    'Wipe your bankroll back to starting chips',
  big_yahu: 'Forgive all loans, reset P/L (one-use unlock)',
}

// Market / power panels that open as floating widgets instead of as
// embedded panels under the Tools dropdown. `accent` maps to a
// FloatingWindow accent; `title` shows in the title bar; the rest of
// the entries (bank/blinds/contest/arena/profile/skin/reset/big_yahu/
// help/hand/session/daily) keep the existing embedded-panel rendering
// because they're admin/info surfaces, not "stay open while you play"
// widgets.
const MARKET_WIDGET_IDS = new Set([
  'crypto', 'items', 'assets', 'jobs', 'stocks', 'world',
])

// Panels in these Tools-menu categories layer ABOVE the docked Tools
// menu (z-[800] via the portal). Without the bump they sit at the
// default panel z (z-[600]) and the still-open Tools dropdown ends
// up painted over them.
const ELEVATED_PANEL_IDS = new Set([
  // Actions
  'bots', 'blinds', 'contest', 'arena', 'reset', 'big_yahu',
  // Profile
  'skin', 'profile',
  // Basic Info
  'hand', 'session',
  // Guide
  'help', 'shortcuts',
  // Bank — same treatment, user-confirmed it was being covered.
  'bank',
  // Daily Challenge
  'daily',
])
const MARKET_WIDGET_META = {
  crypto:    { title: 'Crypto Market', icon: '★', accent: 'fuchsia', defaultWidth: 420, defaultHeight: 560 },
  items:     { title: 'Items & Powers', icon: '★', accent: 'cyan',    defaultWidth: 380, defaultHeight: 520 },
  assets:    { title: 'Real Estate',    icon: '★', accent: 'emerald', defaultWidth: 400, defaultHeight: 560 },
  jobs:      { title: 'Jobs Board',     icon: '★', accent: 'orange',  defaultWidth: 380, defaultHeight: 520 },
  stocks:    { title: 'Stock Market',   icon: '★', accent: 'sky',     defaultWidth: 440, defaultHeight: 600 },
  world:     { title: 'World Map',      icon: '★', accent: 'purple',  defaultWidth: 460, defaultHeight: 600 },
}

const TOOLS_LRU_META = {
  help:     { label: 'Help',          accent: 'text-white' },
  hand:     { label: 'Hand',          accent: 'text-white' },
  session:  { label: 'Session',       accent: 'text-white' },
  daily:    { label: 'Daily',         accent: 'text-amber-200' },
  crypto:   { label: 'Crypto',        accent: 'text-fuchsia-200' },
  items:    { label: 'Items',         accent: 'text-lime-200' },
  assets:   { label: 'Real Estate',   accent: 'text-emerald-200' },
  jobs:     { label: 'Jobs',          accent: 'text-orange-200' },
  stocks:   { label: 'Stocks',        accent: 'text-sky-200' },
  world:    { label: 'World',         accent: 'text-purple-200' },
  influence:{ label: 'Influence',     accent: 'text-violet-200' },
  bank:     { label: 'Bank',          accent: 'text-teal-200' },
  bots:     { label: 'Bots',          accent: 'text-white' },
  blinds:   { label: 'Blinds',        accent: 'text-white' },
  contest:  { label: 'Contest',       accent: 'text-white' },
  arena:    { label: 'Arena',         accent: 'text-amber-200' },
  skin:     { label: 'Skin',          accent: 'text-white' },
  profile:  { label: 'Profile',       accent: 'text-white' },
}

// Parse user-typed chip amounts. Accepts: bare numbers ("12500"), commas
// ("12,500"), K/M/B/T shorthand ("5K", "1.5M", "2.4B", "0.5T"), and
// optional leading `$`. Returns null on garbage so the caller can fall
// back to the previous value. Critical for the trillion-scale economy
// where players don't want to type "1,500,000,000,000" into the bet
// input — "1.5T" should just work.
function parseChipShorthand(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/^\$/, '').replace(/,/g, '').toUpperCase()
  if (s.length === 0) return null
  // Match `<number><optional suffix>`. Number can be decimal.
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMBT]?)$/)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const suffixMul = { '': 1, K: 1_000, M: 1_000_000, B: 1_000_000_000, T: 1_000_000_000_000 }
  const mul = suffixMul[m[2]] ?? 1
  return Math.floor(n * mul)
}

// Compact dollar formatting for tight chrome (2-col blind pickers, where a
// 25-char `$500,000,000/$1,000,000,000` would overflow a 140px cell at
// text-[11px]). Switches to K / M / B suffixes once the number exceeds 5
// digits. The full toLocaleString form is kept everywhere there's room
// (the main blind list, header pills, etc.) so users still see exact
// totals where it matters.
function formatChipsCompact(amount) {
  const n = Number(amount) || 0
  const abs = Math.abs(n)
  // Scales: K (10K+) / M (1M+) / B (1B+) / T (1T+). The game economy
  // intentionally tops out in the quadrillions; T coverage is what
  // matters for the absurd-blind tournament feel. Anything above 999T
  // falls back to scientific via toLocaleString.
  if (abs >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(n % 1_000_000_000_000 === 0 ? 0 : 1)}T`
  if (abs >= 1_000_000_000)     return `${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B`
  if (abs >= 1_000_000)         return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (abs >= 10_000)            return `${Math.round(n / 1000)}K`
  return n.toLocaleString()
}

// Format a chip amount as a multiple of big blinds. At absurd-blind levels
// the chip totals get unreadable (5,000,000 chips means nothing), but
// "50BB" is the unit poker players actually think in. Returns a short
// label like "5BB", "12.5BB", "0.5BB" — caller wraps in parens / dim text.
function formatBB(amount, bb) {
  const num = Number(amount) || 0
  const big = Number(bb) || 0
  if (big <= 0) return ''
  const bbs = num / big
  // Whole + half steps only — anything finer is visual noise next to
  // chip totals that are already shown precisely.
  let rounded
  if (bbs >= 100) rounded = Math.round(bbs)
  else if (bbs >= 10) rounded = Math.round(bbs * 2) / 2
  else rounded = Math.round(bbs * 4) / 4
  return `${rounded}BB`
}

// Render a chat message string, highlighting any @username tokens. The
// regex matches @ at a word boundary followed by 1-32 word/dash chars
// (same shape the server uses to detect mentions). Yields a flat array
// of React nodes — no wrapper div — so it slots into the existing
// `<span>{...}</span>` line in the chat list.
function renderChatWithMentions(text) {
  if (!text || typeof text !== 'string') return text
  const parts = []
  const re = /(^|\s)@([A-Za-z0-9_-]{1,32})/g
  let last = 0
  let m
  let key = 0
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length
    if (start > last) parts.push(text.slice(last, start))
    parts.push(<span key={`@${key++}`} className="rounded bg-amber-400/20 px-1 text-amber-200 font-bold">@{m[2]}</span>)
    last = re.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length > 0 ? parts : text
}

function formatProfit(value) {
  const amount = Number(value) || 0
  if (amount === 0) return '+$0'
  // Absurd-blind tiers push P/L into the trillions; bare numbers there
  // ("+1000000000000") are unreadable. formatChipsCompact handles K→T;
  // we strip its leading `-` and reattach the sign + `$` ourselves so
  // ordering is always `[+|-]$[body]`.
  const abs = Math.abs(amount)
  const body = abs >= 1_000_000 ? formatChipsCompact(amount).replace('-', '') : abs.toLocaleString()
  return amount > 0 ? `+$${body}` : `-$${body}`
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
    // Compact at huge stakes — these badges float over seat avatars and
    // would otherwise overflow the [120/140px] nameplate width.
    text += ` ${action.amount >= 1_000_000 ? formatChipsCompact(action.amount) : action.amount.toLocaleString()}`
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
  // Refs the Tools-menu outside-click handler treats as INSIDE the
  // menu, so clicking on the chat dock, side-bets dock, the floating
  // poker window, etc. doesn't auto-close the menu. The user can
  // bounce between Tools and these companion surfaces freely. The
  // PokerWindow itself renders via portal so we tag its outer node
  // with `data-pokerwin="1"` and detect it that way (no ref needed).
  const chatDockRef = useRef(null)
  const sideBetsDockRef = useRef(null)
  const hudDockRef = useRef(null)
  // Width of the Tools + Lobby pair (measured live via ResizeObserver
  // below). Used to size the equity widget so it spans the same
  // horizontal band as that pair. State, not ref, because the widget
  // needs to re-render when the value changes.
  const navPairRef = useRef(null)
  const [navPairWidth, setNavPairWidth] = useState(0)
  useEffect(() => {
    const el = navPairRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const sync = () => setNavPairWidth(el.offsetWidth || 0)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
  // True while a reconnect attempt is in flight (WS closed unexpectedly,
  // we're inside the server's grace window). Drives the "(reconnecting…)"
  // banner so the user sees we haven't given up on their seat.
  const [reconnecting, setReconnecting] = useState(false)
  // Player IDs whose seats are currently disconnected-but-in-grace.
  // Seats use this to render a "(reconnecting…)" tag without removing
  // the player. Cleared via `player_reconnected` broadcasts.
  const [disconnectedPlayerIds, setDisconnectedPlayerIds] = useState(() => new Set())
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
  const [statsMode, setStatsMode] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem(STATS_MODE_STORAGE_KEY) === '1' }
    catch { return false }
  })
  // Felt color is SITE-WIDE — promoted out of /poker so the user's
  // pick tints every page (home, feed, /poker/bots, etc.) and persists
  // server-side for signed-in users. The Tools-menu felt picker reads
  // and writes through the same hook, which in turn drives
  // FuzzyBackground at the root layout.
  const { tableColorId, customColors, palette: tablePalette } = useFeltColor()
  // Stable callable handles for the felt picker's onClick/onChange
  // wiring below. Renames keep the existing JSX (`setTableColorId`,
  // `setCustomColors`) working with no further changes.
  const setTableColorId = setSharedTableColorId
  const setCustomColors = setSharedCustomColors

  // (Removed: "Check in the dark" client-side action queue. Any auto-
  // fire pre-action path is gone; the user must click their own action
  // button on every street.)

  // Session-scoped notification toasts. Each entry: {id, kind, fromName,
  // body, createdAt}. Auto-dismissed via per-entry timeouts so they
  // don't pile up on screen. Ephemeral — never written to localStorage,
  // never sent to the server; only lives for the current table session.
  const [sessionNotifs, setSessionNotifs] = useState([])
  const sessionNotifTimersRef = useRef(new Map())
  const SESSION_NOTIF_TTL_MS = 6_000
  const pushSessionNotif = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return
    const id = `sn-${payload.createdAt || Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // Friendly default body per kind. Callers can pass their own `body`
    // for kinds like @-mentions or loan offers which need a more
    // detailed line; nudge keeps it terse.
    const kind = String(payload.kind || 'info')
    const fromName = String(payload.fromName || 'Someone')
    const body = typeof payload.body === 'string' && payload.body.length > 0
      ? payload.body
      : kind === 'nudge'
        ? `${fromName} is nudging you — it's your turn`
        : `${fromName} sent you a ${kind}`
    // Keep the originating player's id + the negotiation id so clickable
    // notifs (currently loan offers / counters) can deep-link into the
    // right popover without re-querying.
    const fromId = typeof payload.fromId === 'string' ? payload.fromId : null
    const negotiationId = typeof payload.negotiationId === 'string' ? payload.negotiationId : null
    setSessionNotifs(prev => [...prev.slice(-4), { id, kind, fromName, body, fromId, negotiationId, createdAt: payload.createdAt || Date.now() }])
    const t = setTimeout(() => {
      setSessionNotifs(prev => prev.filter(n => n.id !== id))
      sessionNotifTimersRef.current.delete(id)
    }, SESSION_NOTIF_TTL_MS)
    sessionNotifTimersRef.current.set(id, t)
  }, [])
  useEffect(() => {
    // Clear any pending timers on unmount so stale dispatches don't
    // crash the listener after the page tears down.
    return () => {
      for (const t of sessionNotifTimersRef.current.values()) clearTimeout(t)
      sessionNotifTimersRef.current.clear()
    }
  }, [])
  const statsPanelRef = useRef(null)
  // Stable handler so the memoized StatsPanel doesn't re-render every tick
  // from a fresh inline arrow reference. (StatsPanel collapsed to a single
  // compact view in 2026-05 — no more expansion states, just close.)
  const closeStatsPanel = useCallback(() => {
    setStatsMode(false)
    try { window.localStorage.removeItem(STATS_MODE_STORAGE_KEY) } catch {}
  }, [])
  const [tableList, setTableList] = useState([])
  const [spectatorBlindMode, setSpectatorBlindMode] = useState(false)
  const [spectatorVisibleIdSet, setSpectatorVisibleIdSet] = useState(() => new Set())
  const [spectatorRevealAll, setSpectatorRevealAll] = useState(false)
  const [spectatorHoveredPlayerId, setSpectatorHoveredPlayerId] = useState(null)
  const [tableMenuOpen, setTableMenuOpen] = useState(false)
  // Anchored Tools menu is rendered via a portal to document.body so
  // its z-index applies at the document root, not inside the nav
  // cluster's stacking context. (Without the portal, the menu's z is
  // capped by the cluster, and elements like the equity widget end
  // up painted on top of it.) We track the Tools button's screen rect
  // so the portaled menu can pin itself just below the button.
  const [toolsMenuAnchorRect, setToolsMenuAnchorRect] = useState(null)
  // Dynamic z for the anchored Tools menu. Opening the menu IS the
  // active gesture, so it claims the top of the click-raise band
  // immediately (above every floating window). Closes back to the
  // static 800 floor on hide so the next open starts fresh. The
  // layout-effect below re-bumps it whenever a tool transitions open
  // — see the comment there for the ordering rationale.
  const [toolsMenuZ, setToolsMenuZ] = useState(800)
  // Dock column (InvestmentHUD / Side-Bets / Chat) z-tracking. Same
  // click-to-front contract as the Tools menu and floating windows:
  // pointerdown inside any docked surface bumps it via bumpRaisedZ()
  // so it rises above any window or the Tools menu the user last
  // interacted with. Base = 30 (matches the static md:z-30 the column
  // used to carry) so until the user activates it, the column sits in
  // its natural slot below windows.
  const [dockColumnZ, setDockColumnZ] = useState(30)
  const activateDockColumn = useCallback(() => {
    setDockColumnZ(bumpRaisedZ())
  }, [])
  // Floating PiP poker window — opens from the Tools menu's
  // ★ Mini Table entry. Mirrors the main view's state (same React
  // tree), so actions inside the window move the real game and
  // updates from the server immediately reflect both surfaces.
  const [pokerWindowOpen, setPokerWindowOpen] = useState(false)
  // Market panels promoted to floating widgets. Each id in the set
  // renders as its own draggable FloatingWindow at body level instead
  // of (or in addition to) the embedded panel slot under the Tools
  // dropdown. Clicking the tool entry adds; clicking the widget's ×
  // removes. Persisted in localStorage so a panel left open survives
  // a refresh.
  const [widgetPanels, setWidgetPanels] = useState(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.localStorage.getItem('pokerxyz:widgets:open')
      const parsed = raw ? JSON.parse(raw) : []
      return new Set(Array.isArray(parsed) ? parsed : [])
    } catch { return new Set() }
  })
  const setWidgetPanelsPersist = useCallback((updater) => {
    setWidgetPanels(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      try { window.localStorage.setItem('pokerxyz:widgets:open', JSON.stringify([...next])) } catch {}
      return next
    })
  }, [])
  // Tools menu freeform mode. Default false → menu drops down anchored
  // to the Tools button (current behavior). When true → menu lives as
  // a FloatingWindow you can drag anywhere; position persists.
  const [toolsFreeform, setToolsFreeform] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem('pokerxyz:tools:freeform') === '1' } catch { return false }
  })
  const setToolsFreeformPersist = useCallback((next) => {
    setToolsFreeform(next)
    try { window.localStorage.setItem('pokerxyz:tools:freeform', next ? '1' : '0') } catch {}
  }, [])
  // Per-widget freeform flags. Default off — widget renders in its
  // historical anchored position. On → widget wraps in FloatingWindow
  // (drag/resize/persist). The map covers the widgets the user can
  // explicitly toggle: chat dock, side-bets dock, finances widget,
  // investment HUD, hand-equity HUD. The mini-table + market widgets
  // are ALWAYS freeform (they're widget-only) so they don't appear here.
  const [widgetFreeform, setWidgetFreeform] = useState(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem('pokerxyz:widgets:freeform')
      return raw ? JSON.parse(raw) : {}
    } catch { return {} }
  })
  const toggleWidgetFreeform = useCallback((widgetId) => {
    setWidgetFreeform(prev => {
      const next = { ...prev, [widgetId]: !prev[widgetId] }
      try { window.localStorage.setItem('pokerxyz:widgets:freeform', JSON.stringify(next)) } catch {}
      return next
    })
  }, [])
  // Two-step confirm for the custom-felt × buttons. First click sets
  // this to the slot index (turning that × red); a second click on the
  // SAME × actually clears the slot. Any other × click reassigns the
  // armed slot (so you can't accidentally delete the previously-armed
  // one). Auto-disarms after a few seconds via the timer ref below so a
  // forgotten click doesn't sit live in the menu.
  const [clearArmedSlot, setClearArmedSlot] = useState(null)
  const clearArmTimerRef = useRef(null)
  // Reset arming when the Tools menu closes — the × is only reachable
  // inside the dropdown, and an opened-then-closed menu shouldn't have
  // a stale red × waiting on next open.
  useEffect(() => {
    if (!tableMenuOpen && clearArmedSlot !== null) {
      setClearArmedSlot(null)
      if (clearArmTimerRef.current) {
        clearTimeout(clearArmTimerRef.current)
        clearArmTimerRef.current = null
      }
    }
  }, [tableMenuOpen, clearArmedSlot])
  useEffect(() => () => {
    if (clearArmTimerRef.current) clearTimeout(clearArmTimerRef.current)
  }, [])
  const [activePokerPanel, setActivePokerPanel] = useState(null)
  // Sub-editor state for the items panel (swap / river_card / next_card
  // / rig_hand). Lifted out of ItemsPanel so the tools-panel chrome's
  // own "← Back" button can pop the editor first (back to items list)
  // before closing the whole panel to the tools menu — otherwise that
  // chrome Back skipped right past the items list to the tools
  // chip-dropdown, which felt like two screens of context gone in one
  // tap.
  const [itemsActiveEditor, setItemsActiveEditor] = useState(null)
  // Whenever the items panel itself closes, the editor state goes
  // with it — opening Items fresh should always land on the grid,
  // never inside a stale editor.
  useEffect(() => {
    if (activePokerPanel !== 'items') setItemsActiveEditor(null)
  }, [activePokerPanel])
  // Anchored Tools menu z-bumper. Runs on:
  //   • menu open/close — open claims the top of the raise band; close
  //     resets to the 800 floor so the next open starts fresh.
  //   • a tool transitioning open — FloatingWindow seeds new mounts
  //     via nextRaisedZ(), so the freshly-opened tool naturally lands
  //     above every previously-opened window. useLayoutEffect runs
  //     after that mount but before paint, lifting the menu just one
  //     tick higher so the menu stays above the new tool. Net stack
  //     from bottom up: old windows < new tool < docked menu.
  // Freeform Tools menu is excluded — it's itself a FloatingWindow and
  // rides the standard click-to-front rules, no special handling.
  useLayoutEffect(() => {
    if (!tableMenuOpen) { setToolsMenuZ(800); return }
    if (toolsFreeform) return
    setToolsMenuZ(bumpRaisedZ())
  }, [tableMenuOpen, toolsFreeform, activePokerPanel, pokerWindowOpen, feedWindowOpen, widgetPanels])
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
  // Spectator-controlled bot think delay (ms). Mirrors the server's clamp
  // band [200, 4000]. Default (1200) lines up with PokerRoom's default.
  const [arenaThinkDelayMs, setArenaThinkDelayMs] = useState(1200)
  // Debounce handle for the slider's WS send. The local state updates on
  // every drag pixel for instant visual feedback, but the server message
  // is coalesced — otherwise dragging across the band fires 30+ broadcasts
  // to every viewer in the arena.
  const arenaSpeedSendTimerRef = useRef(null)
  // Cancel any pending debounced slider send on unmount; otherwise the
  // setTimeout closure would still try to call `send()` after the WS is gone.
  useEffect(() => () => {
    if (arenaSpeedSendTimerRef.current) {
      clearTimeout(arenaSpeedSendTimerRef.current)
      arenaSpeedSendTimerRef.current = null
    }
  }, [])
  // Stable slider handler so AccountDock's BotSpeedDock subscription
  // doesn't churn on every parent render. Mirrors the inline body the
  // old in-page wrapper used: local state updates instantly, the WS
  // send is debounced to 200ms so dragging doesn't flood the arena.
  const handleArenaSpeedChange = useCallback((v) => {
    setArenaThinkDelayMs(v)
    if (arenaSpeedSendTimerRef.current) clearTimeout(arenaSpeedSendTimerRef.current)
    arenaSpeedSendTimerRef.current = setTimeout(() => {
      arenaSpeedSendTimerRef.current = null
      send('poker_arena_set_speed', { delayMs: v })
    }, 200)
  }, [send])
  // Bridge the bot-speed config into AccountDock so its dock column
  // owns the BotSpeedDock as a real flex sibling. This is what fixes
  // the bell→bot spacing — being in the SAME flex container makes
  // `gap-2` literal, with no separate calc/spacer math drifting from
  // the other items in the column.
  useEffect(() => {
    const hasBots = (gameState?.players || []).some(p => p && p.isBot)
    setDockBotSpeed(hasBots
      ? { value: arenaThinkDelayMs, onChange: handleArenaSpeedChange }
      : null)
  }, [gameState?.players, arenaThinkDelayMs, handleArenaSpeedChange])
  // Clear on unmount so the bot icon doesn't bleed into other routes
  // when the user navigates away from the poker page.
  useEffect(() => () => setDockBotSpeed(null), [])
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
  // Items engine state — per-player cooldown snapshot pushed by the server
  // on hand-end + join. Shape: { items: [{ id, ready, cooldownHandsRemaining }], refreshHands }
  const [itemsState, setItemsState] = useState({ items: [], refreshHands: 5 })
  // Appreciating-assets engine state — per-player snapshot of the
  // catalog with current prices + the player's own positions. Server
  // pushes `assets:state` on join, hand-end, and after every trade.
  const [assetsState, setAssetsState] = useState({ catalog: [], myPositions: [], marketMultiplier: 1 })
  const [jobsState, setJobsState] = useState({ jobs: [] })
  const [stocksState, setStocksState] = useState({ stocks: [], myPositions: [], upcomingEarnings: [] })
  const [optionsState, setOptionsState] = useState({ chain: [], myPositions: [], expiryHands: 3, contractMultiplier: 100 })
  const [worldState, setWorldState] = useState({ territories: [], pandemicActive: false, yieldMultiplier: 1 })
  const [influenceState, setInfluenceState] = useState({ ops: [] })
  // Kick-vote state from server. `threshold` = votes needed to kick (null
  // when below 3 humans). `polls` is keyed by targetId → { votes, expiresAt }.
  const [kickState, setKickState] = useState({ threshold: null, humanCount: 0, polls: {} })
  // Tools-menu Recents bar. Lazy-initialized from localStorage so the
  // last-used panels persist across reloads. The bumpToolsLRU helper
  // moves the just-opened panel to the head of the list.
  const [toolsLRU, setToolsLRU] = useState(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = window.localStorage.getItem(TOOLS_LRU_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string').slice(0, TOOLS_LRU_MAX) : []
    } catch { return [] }
  })
  const bumpToolsLRU = (panel) => {
    setToolsLRU(prev => {
      const next = [panel, ...prev.filter(p => p !== panel)].slice(0, TOOLS_LRU_MAX)
      try { window.localStorage.setItem(TOOLS_LRU_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  // Customize-mode + hidden-set for the Tools menu. When customize
  // mode is on, every tool button shows a checkmark badge — toggle it
  // to hide / unhide. Hidden tools stay reachable via the Recents bar.
  const [toolsCustomizing, setToolsCustomizing] = useState(false)
  const [toolsHidden, setToolsHidden] = useState(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.localStorage.getItem(TOOLS_HIDDEN_KEY)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw)
      return new Set(Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : [])
    } catch { return new Set() }
  })
  const toggleToolHidden = (panel) => {
    setToolsHidden(prev => {
      const next = new Set(prev)
      if (next.has(panel)) next.delete(panel)
      else next.add(panel)
      try { window.localStorage.setItem(TOOLS_HIDDEN_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }
  // When peek returns, server replies with the target's hole cards. We stash
  // the result here to render the reveal modal. Cleared when the user
  // dismisses the modal.
  const [itemPeekResult, setItemPeekResult] = useState(null)
  // Active scam popups pushed at us by other players. Multiple can be
  // open at once (the server's per-sender cooldown went down to 1 hand,
  // so quick attackers can chain); each gets its own screen corner so
  // they don't stack opaque overlays. Resolved by clicking Accept or
  // Block (or letting the server's 30s expiry fire on each). Entry shape:
  //   { scamId, senderUsername, amount }
  const [scamPopups, setScamPopups] = useState([])
  // Active pin_hack popup landed on us — only one at a time (the
  // server enforces an 8-hand cooldown per sender so concurrent hits
  // from the same hacker are impossible; if two different hackers
  // chain attempts, the second pushes the first off-screen, which is
  // fine since the first's 12s clock is still ticking server-side).
  // Shape: { pinHackId, senderUsername, pin, amount }.
  const [pinHackPopup, setPinHackPopup] = useState(null)
  // Persistent top-left finance widget. Once opened it stays visible across
  // hands so the player can keep an eye on unrealized P/L as side bets and
  // crypto prices move. Local-only UI state, never broadcast — but the
  // on/off choice is persisted to localStorage so the user doesn't have to
  // re-enable it every session.
  const [financesWidgetOpen, setFinancesWidgetOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    try { return window.localStorage.getItem(FINANCES_WIDGET_STORAGE_KEY) === '1' }
    catch { return false }
  })

  // Investment HUD on/off — toggled from Tools → Widgets. Defaults ON
  // (only '0' explicitly disables) so existing users keep their HUD.
  const [hudEnabled, setHudEnabled] = useState(() => {
    if (typeof window === 'undefined') return true
    try { return window.localStorage.getItem(HUD_ENABLED_STORAGE_KEY) !== '0' }
    catch { return true }
  })

  // Cross-tab sync for the two persisted UI toggles. Without this, opening
  // the table in two tabs and toggling the finance widget / stats mode in
  // one leaves the other tab stale. The `storage` event only fires on OTHER
  // tabs, so this is safe to wire to the same setters.
  useEffect(() => {
    if (typeof window === 'undefined') return
    function onStorage(e) {
      if (e.key === FINANCES_WIDGET_STORAGE_KEY) {
        setFinancesWidgetOpen(e.newValue === '1')
      } else if (e.key === STATS_MODE_STORAGE_KEY) {
        const on = e.newValue === '1'
        setStatsMode(on)
      } else if (e.key === HUD_ENABLED_STORAGE_KEY) {
        setHudEnabled(e.newValue !== '0')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])


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

  // Host-side draft: tools the player wants disabled in the NEXT private
  // room they create. Persisted to localStorage so a user who always
  // wants "no items" doesn't have to re-toggle each session. Only read
  // when sending the create_private join payload.
  const [privateRoomDisabledTools, setPrivateRoomDisabledTools] = useState(() => loadPrivateRoomDisabledTools())
  const togglePrivateRoomDisabledTool = useCallback((toolId) => {
    if (!TOGGLEABLE_TOOL_IDS.has(toolId)) return
    setPrivateRoomDisabledTools(prev => {
      const next = new Set(prev)
      if (next.has(toolId)) next.delete(toolId)
      else next.add(toolId)
      savePrivateRoomDisabledTools(next)
      return next
    })
  }, [])
  // Bulk setter used by the lobby's "Disable all" master toggle. Lets
  // the host go from "wild west" to "nothing but poker" in one click,
  // or vice versa. Persisted same as the per-tool toggle so the choice
  // survives reloads.
  const setAllPrivateRoomDisabledTools = useCallback((disableAll) => {
    setPrivateRoomDisabledTools(() => {
      const next = disableAll ? new Set(TOGGLEABLE_TOOL_IDS) : new Set()
      savePrivateRoomDisabledTools(next)
      return next
    })
  }, [])

  // Authoritative list for the CURRENT room — populated from server
  // payloads (join_game / reconnect_ok / room_update). General rooms
  // always come back with an empty set; private rooms reflect what the
  // host picked at creation time. Used to hide Tools menu entries.
  const [roomDisabledTools, setRoomDisabledTools] = useState(() => new Set())

  // Pending purchase confirmation. `requestPurchase({ title, body, cost, onConfirm })`
  // sets this; the modal at the bottom of the page reads it. If the player
  // can't afford the cost we skip the modal and push a system toast instead.
  const [pendingPurchase, setPendingPurchase] = useState(null)

  const addSys = useCallback((msg) => {
    setSysMessages(prev => [...prev.slice(-30), msg])
  }, [])

  // Gate every buy action through this. Cheap-to-afford → confirm modal.
  // Too poor → toast in the chat sys log. Saves wiring an affordability
  // check + "are you sure?" flow into every panel manually.
  const fmtCostDollars = (n) => {
    const v = Number(n) || 0
    return v.toLocaleString()
  }
  const requestPurchase = useCallback(({ title, body, cost, onConfirm }) => {
    const chips = bankState?.chips ?? 0
    if (chips < cost) {
      addSys(`💸 Not enough chips for ${title} — costs $${fmtCostDollars(cost)}, you have $${fmtCostDollars(chips)}.`)
      return
    }
    setPendingPurchase({ title, body, cost, onConfirm })
  }, [bankState?.chips, addSys])

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

  // Track the Tools button's screen position so the portaled anchored
  // menu can pin itself just below it. Recomputes on resize + scroll
  // (capture phase, to catch scrolls inside ancestors like ZoomLayer).
  useEffect(() => {
    if (!tableMenuOpen) {
      setToolsMenuAnchorRect(null)
      return
    }
    function compute() {
      const el = tableMenuRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setToolsMenuAnchorRect({ bottom: r.bottom, right: window.innerWidth - r.right })
    }
    compute()
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [tableMenuOpen])

  useEffect(() => {
    if (!tableMenuOpen) {
      // Disarm the auto-fill confirm whenever the menu closes so reopening
      // it doesn't land on a pre-armed button.
      setAutoFillArmed(false)
      return
    }

    function handlePointerDown(event) {
      const t = event.target
      if (tableMenuRef.current?.contains(t)) return
      // The anchored menu is portaled to <body> now — it isn't inside
      // tableMenuRef. data-tools-menu tags its outer node so a click
      // on the menu still counts as "inside Tools".
      if (t?.closest?.('[data-tools-menu="1"]')) return
      // Companion surfaces — clicking inside any of these stays
      // "logically inside the Tools menu" so the user can toggle
      // chat, place a side bet, or work the mini table without the
      // dropdown collapsing on them. The PokerWindow renders via a
      // portal at body level, so we detect it by data-attribute on
      // its outer node + walk up via .closest().
      if (chatDockRef.current?.contains(t)) return
      if (sideBetsDockRef.current?.contains(t)) return
      if (hudDockRef.current?.contains(t)) return
      if (t?.closest?.('[data-pokerwin="1"]')) return
      // Active tool panel (Bank / Bots / Blinds / etc.) is logically a
      // child of the Tools menu — clicking it keeps Tools open so the
      // user can hit Back-to-Tools and pick another tool. Without this
      // the panel's first interaction would collapse Tools out from
      // under it.
      if (pokerPanelRef.current?.contains(t)) return
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

  // Floating-window keyboard shortcuts. Ctrl-based — Cmd was off the
  // table because macOS reserves Cmd+H system-wide to hide the whole
  // app (browser couldn't even see the keystroke). Ctrl variants work
  // on every platform. They no-op while the user is typing (form
  // inputs / contenteditable) so they don't fight chat or the raise
  // box, and only swallow the browser's default when a popup is
  // actually available to act on.
  //
  //   Tab            cycle through popups (raise the bottom-most)
  //   Ctrl+X         close the currently focused popup
  //   Ctrl+A         jump back to the previously focused popup
  //   Ctrl+←         previous popup in registration order
  //   Ctrl+→         next popup in registration order
  //   Ctrl+H         hide every popup off-screen / restore them
  useEffect(() => {
    function isTypingTarget(el) {
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (el.isContentEditable) return true
      return false
    }
    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return
      // Only ctrlKey — explicitly NOT metaKey. Letting Cmd through on
      // macOS would either get intercepted by the OS (Cmd+H) or
      // clobber familiar text-editing chords the user expects.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase()
        if (k === 'x') {
          if (closeCurrentFloatingWindow()) e.preventDefault()
          return
        }
        if (k === 'a') {
          if (focusLastFloatingWindow()) e.preventDefault()
          return
        }
        if (k === 'h') {
          e.preventDefault()
          toggleHideAllFloatingWindows()
          return
        }
        if (e.key === 'ArrowLeft') {
          if (prevFloatingWindow()) e.preventDefault()
          return
        }
        if (e.key === 'ArrowRight') {
          if (nextFloatingWindow()) e.preventDefault()
          return
        }
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        // Only intercept Tab when we actually have a window to raise —
        // otherwise let the browser do its normal focus traversal.
        if (cycleNextFloatingWindow()) e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

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
        // 2026-05: force the profile picker open for invite-link entry.
        // Previously a signed-in user clicking an invite would auto-use
        // their saved profile and have no obvious way to set a per-table
        // username/photo before joining. Switching to 'anon' surfaces
        // the ProfileSelector + username input; they can still flip to
        // 'self' in the lobby if they actually want to play as themselves.
        setPlayMode('anon')
      }
    }
  }, [])

  useEffect(() => {
    if (connected && !joined && joinMode === 'spectate') {
      send('list_tables')
    }
  }, [connected, joined, joinMode])

  useEffect(() => {
    // 2026-05: WS now auto-reconnects with exponential backoff. The seat is
    // held server-side for ~45s (RECONNECT_GRACE_MS) after WS close, so a
    // reload or short network drop won't lose your stack, hole cards, or
    // position. The flow:
    //   1. First connect → server issues a `sessionToken` in the CONNECT
    //      message; we save it to localStorage (gwu_ws_session).
    //   2. WS closes (reload / kick / Wi-Fi flicker) → onclose schedules
    //      reconnect; we keep `joined`/game state visible with a banner.
    //   3. New WS opens → if we have a saved sessionToken, send
    //      RECONNECT first. Server replies RECONNECT_OK + full snapshot
    //      and rotates the token, or RECONNECT_FAIL if grace expired.
    //   4. On RECONNECT_FAIL we clear the saved token and the user is
    //      left at the lobby (their old game state stays rendered until
    //      they JOIN_GAME again).
    let cancelled = false
    let retryTimer = null
    let retryCount = 0
    const WS_SESSION_KEY = 'gwu_ws_session'  // distinct from gwu_session_token (JWT)
    const readWsToken = () => {
      if (typeof window === 'undefined') return null
      try { return window.localStorage.getItem(WS_SESSION_KEY) } catch { return null }
    }
    const writeWsToken = (token) => {
      if (typeof window === 'undefined') return
      try {
        if (token) window.localStorage.setItem(WS_SESSION_KEY, token)
        else window.localStorage.removeItem(WS_SESSION_KEY)
      } catch {}
    }
    const scheduleReconnect = () => {
      if (cancelled) return
      // Exponential backoff capped at 8s — long enough that a misbehaving
      // server doesn't get hammered, short enough that a brief Wi-Fi
      // drop reconnects within a typical hand.
      const delay = Math.min(8000, 500 * Math.pow(2, Math.min(retryCount, 4)))
      retryCount += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (!cancelled) connect()
      }, delay)
    }

    function connect() {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen = () => {
      setConnected(true)
      setReconnecting(false)
      retryCount = 0
      // Re-attach to the held seat if we have a token from before. This
      // must be sent before auth_hello so the server can swap our socket
      // onto the right Player before any other handler runs.
      try {
        const wsToken = readWsToken()
        if (wsToken) ws.send(JSON.stringify({ type: 'reconnect', data: { sessionToken: wsToken } }))
      } catch {}
      // Tell the server who we are if we have a session token. The server
      // uses this to gate features that require an account (Bot Arena, etc).
      try {
        const token = typeof window !== 'undefined'
          ? window.localStorage.getItem('gwu_session_token')
          : null
        if (token) ws.send(JSON.stringify({ type: 'auth_hello', data: { token } }))
      } catch {}
    }
    ws.onclose = () => {
      setConnected(false)
      // KEY DIFFERENCE from the old onclose: we no longer clear `joined`
      // / `isSpectator` / game state. The seat is being held server-side
      // for the grace window; keeping the UI mounted means the table
      // pops back to life on RECONNECT_OK without a re-mount round-trip.
      setReconnecting(true)
      scheduleReconnect()
    }
    ws.onerror = () => setConnected(false)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      switch (msg.type) {
        case 'connect':
          setPlayerId(msg.data.playerId)
          setUsername(prev => prev || msg.data.username)
          if (msg.data.sessionToken) writeWsToken(msg.data.sessionToken)
          break
        case 'reconnect_ok': {
          // Server re-attached us to the held seat. Save the rotated
          // token and hydrate from the snapshot so the table renders
          // mid-hand state — chips, hole cards, pot, action-on-who —
          // without waiting for a fresh game_state broadcast.
          if (msg.data?.sessionToken) writeWsToken(msg.data.sessionToken)
          if (msg.data?.playerId) setPlayerId(msg.data.playerId)
          const room = msg.data?.room
          if (room) {
            setJoined(true)
            setCurrentRoomId(room.roomId || null)
            setIsSpectator(!!(msg.data.isSpectator ?? room.isSpectator))
            if (room.gameState) applyGameState(room.gameState)
            setIsPrivate(room.isPrivate || false)
            setInviteCode(room.inviteCode || null)
            setRoomDisabledTools(new Set(
              Array.isArray(room.disabledTools)
                ? room.disabledTools.filter(id => TOGGLEABLE_TOOL_IDS.has(id))
                : []
            ))
            if (room.sideBets) setSideBetsState(room.sideBets)
            if (room.crypto) setCryptoState(room.crypto)
            if (room.contestMode) setContestMode(room.contestMode)
            if (typeof room.isArena === 'boolean') setIsArena(room.isArena)
            if (typeof room.arenaRunning === 'boolean') setArenaRunning(room.arenaRunning)
            if (typeof room.arenaStartingChips === 'number') setArenaStartingChips(room.arenaStartingChips)
            if (typeof room.arenaThinkDelayMs === 'number') setArenaThinkDelayMs(room.arenaThinkDelayMs)
            // Seed disconnected-set from the snapshot so the returning
            // player sees "·rejoining" tags on any OTHER seats that are
            // currently mid-grace. The local player just reconnected, so
            // their own id wouldn't be in this list.
            setDisconnectedPlayerIds(new Set(
              (room.players || []).filter(p => p && p.isConnected === false && !p.isBot).map(p => p.id)
            ))
          }
          setReconnecting(false)
          break
        }
        case 'reconnect_fail':
          // Token unknown, grace expired, or seat already gone. Clear
          // the dead token so the next session starts clean. We leave
          // joined / game-state alone — the user sees the lobby UI
          // because no JOIN_GAME has succeeded since reconnect.
          writeWsToken(null)
          setJoined(false)
          setReconnecting(false)
          break
        case 'assets:state':
          setAssetsState({
            catalog: Array.isArray(msg.data?.catalog) ? msg.data.catalog : [],
            myPositions: Array.isArray(msg.data?.myPositions) ? msg.data.myPositions : [],
            marketMultiplier: msg.data?.marketMultiplier ?? 1
          })
          break
        case 'jobs:state':
          setJobsState({
            jobs: Array.isArray(msg.data?.jobs) ? msg.data.jobs : []
          })
          break
        case 'stocks:state':
          setStocksState({
            stocks: Array.isArray(msg.data?.stocks) ? msg.data.stocks : [],
            myPositions: Array.isArray(msg.data?.myPositions) ? msg.data.myPositions : [],
            // Carry the earnings queue all the way through to the
            // Earnings tab. Older shapes sent a single object; the
            // current server always sends an array (2-6 events per
            // batch). Default to [] so the tab's empty-state copy
            // renders cleanly until the first snapshot lands.
            upcomingEarnings: Array.isArray(msg.data?.upcomingEarnings)
              ? msg.data.upcomingEarnings
              : (msg.data?.upcomingEarnings && typeof msg.data.upcomingEarnings === 'object')
                ? [msg.data.upcomingEarnings]
                : [],
          })
          break
        case 'world:state':
          setWorldState({
            territories: Array.isArray(msg.data?.territories) ? msg.data.territories : [],
            pandemicActive: !!msg.data?.pandemicActive,
            pandemicEndsInHands: msg.data?.pandemicEndsInHands ?? 0,
            yieldMultiplier: msg.data?.yieldMultiplier ?? 1,
            myColor: msg.data?.myColor || null
          })
          break
        case 'influence:state':
          setInfluenceState({
            ops: Array.isArray(msg.data?.ops) ? msg.data.ops : []
          })
          break
        case 'kick:state':
          setKickState({
            threshold: msg.data?.threshold ?? null,
            humanCount: msg.data?.humanCount ?? 0,
            polls: msg.data?.polls && typeof msg.data.polls === 'object' ? msg.data.polls : {},
          })
          break
        case 'kicked_from_table':
          addSys(`🚪 You were voted off the table.`)
          // Drop our local seat state — server has already removed us.
          setActivePokerPanel(null)
          setPopoverSeat(null)
          setPopoverSeatId(null)
          break
        case 'options:state':
          setOptionsState({
            chain: Array.isArray(msg.data?.chain) ? msg.data.chain : [],
            myPositions: Array.isArray(msg.data?.myPositions) ? msg.data.myPositions : [],
            expiryHands: msg.data?.expiryHands ?? 3,
            contractMultiplier: msg.data?.contractMultiplier ?? 100
          })
          break
        case 'stocks:tick':
          // Price-only update between full snapshots. Mutate the
          // existing state by overlaying the new prices AND appending
          // each new price to that stock's history array so the
          // sparkline keeps growing tick-over-tick. Without the
          // history append the chart looks like a frozen flat line —
          // it only ever shows whatever snapshot the server sent at
          // join time. Cap at the same HISTORY_LEN (60) the server
          // uses so the buffer doesn't grow without bound.
          setStocksState(prev => {
            const prices = msg.data?.prices || {}
            const HISTORY_CAP = 60
            return {
              ...prev,
              stocks: prev.stocks.map(s => {
                const next = prices[s.symbol]
                if (next == null || next === s.price) return s
                const prevHistory = Array.isArray(s.history) ? s.history : []
                // Server pushes either bare numbers or {t,p} pairs;
                // we always store as {t,p} so the sparkline picks
                // either shape via its existing helper.
                const newPoint = { t: msg.data?.ts || Date.now(), p: next }
                const history = (prevHistory.length >= HISTORY_CAP
                  ? prevHistory.slice(1)
                  : prevHistory).concat(newPoint)
                return { ...s, price: next, history }
              })
            }
          })
          break
        case 'items:state':
          // Per-player cooldown snapshot. The server pushes one on
          // hand-end, on join, and right after every item use.
          setItemsState({
            items: Array.isArray(msg.data?.items) ? msg.data.items : [],
            refreshHands: msg.data?.refreshHands ?? 5
          })
          break
        case 'item:result':
          // Generic ack for the item we just used. Peek returns cards
          // we need to show in a modal; other items just need a toast
          // and the cooldown tick (handled by items:state right after).
          if (msg.data?.itemId === 'peek' && Array.isArray(msg.data?.cards)) {
            setItemPeekResult({
              targetUsername: msg.data.targetUsername,
              cards: msg.data.cards
            })
          } else if (msg.data?.itemId === 'swap' && Array.isArray(msg.data?.newCards)) {
            addSys(`Swapped your hole cards.`)
          } else if (msg.data?.itemId === 'hack' && msg.data?.amount != null) {
            addSys(`Hacked ${msg.data.targetUsername} for $${(msg.data.amount || 0).toLocaleString()}.`)
          } else if (msg.data?.itemId === 'scam') {
            addSys(`Scam sent — waiting for them to click…`)
          }
          break
        case 'item:pin_hack_popup':
          // pin_hack landed on us. Pop the two-phase modal; the
          // server's 12s timeout (2s show + 10s input) handles the
          // failure path if we don't respond in time. A late server
          // response after the user tabbed away will land here but the
          // modal won't be open — that's fine, the server already
          // drained the slice and pushed a system message.
          if (msg.data?.pinHackId && msg.data?.pin) {
            setPinHackPopup({
              pinHackId: msg.data.pinHackId,
              senderUsername: msg.data.senderUsername || 'someone',
              pin: String(msg.data.pin),
              amount: msg.data.amount || 0,
            })
          }
          break
        case 'item:scam_popup':
          // Someone is trying to scam us. Multiple in flight at once
          // is supported now — the receiver sees a corner-anchored
          // popup for each attempt. Server-side 30s expiry clears each
          // independently; we just dedupe on scamId in case a redeliver
          // arrives.
          if (msg.data?.scamId) {
            setScamPopups(prev => {
              if (prev.some(p => p.scamId === msg.data.scamId)) return prev
              return [...prev, {
                scamId: msg.data.scamId,
                senderUsername: msg.data.senderUsername || 'someone',
                amount: msg.data.amount || 0
              }]
            })
          }
          break
        case 'player_disconnected':
          if (msg.data?.playerId) {
            setDisconnectedPlayerIds(prev => {
              if (prev.has(msg.data.playerId)) return prev
              const next = new Set(prev); next.add(msg.data.playerId); return next
            })
          }
          break
        case 'player_reconnected':
          if (msg.data?.playerId) {
            setDisconnectedPlayerIds(prev => {
              if (!prev.has(msg.data.playerId)) return prev
              const next = new Set(prev); next.delete(msg.data.playerId); return next
            })
          }
          break
        case 'join_game':
          setJoined(true)
          setSessionHands([])
          setActivePokerPanel(null)
          setTableMenuOpen(false)
          // Fresh game = fresh window slate. Every popup closes and
          // every freeform widget collapses back to its docked
          // position. The user's zoom preferences are the only thing
          // we still carry across (persisted via /me/window-zoom).
          setPokerWindowOpen(false)
          setFeedWindowOpen(false)
          setFeedOpenedFromTools(false)
          setWidgetFreeform({})
          try { window.localStorage.removeItem('pokerxyz:widgets:freeform') } catch {}
          // Market widgets (crypto / stocks / world / assets / jobs /
          // items) each render as a FloatingWindow when in the set —
          // wipe the set + its localStorage backing so they're closed
          // on join, same as the other popups. setWidgetPanelsPersist
          // already mirrors the new state to localStorage.
          setWidgetPanelsPersist(new Set())
          // If the user had pressed H to stash popups before joining,
          // un-stash now — there are no popups to hide anymore, but
          // we don't want the hide-flag lingering so the next popup
          // they open isn't invisibly off-screen.
          showAllFloatingWindows()
          // Clear the session-scoped position/size memory so popups
          // opened at this new table start at their computed defaults
          // — a layout the user dialed in for one game shouldn't bleed
          // into the next one.
          clearAllFloatingWindowLayouts()
          setCurrentRoomId(msg.data.roomId || null)
          setIsSpectator(msg.data.isSpectator || false)
          applyGameState(msg.data.gameState)
          setIsPrivate(msg.data.isPrivate || false)
          setInviteCode(msg.data.inviteCode || null)
          setRoomDisabledTools(new Set(
            Array.isArray(msg.data.disabledTools)
              ? msg.data.disabledTools.filter(id => TOGGLEABLE_TOOL_IDS.has(id))
              : []
          ))
          // Auto-apply saved blind-level preference for "you started this
          // table"-style joins. Conditions:
          //   1. We have a saved preference,
          //   2. Current blinds at the table don't match it,
          //   3. We're seated (spectators can't propose),
          //   4. We're the only human seated (so the server's solo path
          //      auto-applies without a multi-human vote).
          // Multi-human tables intentionally fall back to the existing
          // Auto-propose-blinds-on-join intentionally removed. Tables
          // now always start at the server default (5/10) and only
          // change when the user explicitly proposes a new level via
          // the Tools menu. Previously this block read a stale level
          // out of localStorage and silently re-applied it, which —
          // if the user had ever touched the high-stakes ladder —
          // produced "everyone all-in to post the blind" behavior on
          // every fresh join.
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
          if (typeof msg.data.arenaThinkDelayMs === 'number') setArenaThinkDelayMs(msg.data.arenaThinkDelayMs)
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
              // Separate persistent off-table wallet. All stocks, options,
              // crypto, assets, jobs land here. The poker stack tops up
              // from this when busted.
              bankBalance: me.bankBalance ?? prev.bankBalance ?? 0,
              bankStartBalance: me.bankStartBalance ?? prev.bankStartBalance ?? 0,
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
          }
          // Seed the disconnected-set from the snapshot — a fresh joiner
          // arriving mid-grace for another player needs to see the
          // "·rejoining" tag even though they didn't receive the
          // player_disconnected broadcast that fired before they joined.
          setDisconnectedPlayerIds(new Set(
            (msg.data.players || []).filter(p => p && p.isConnected === false && !p.isBot).map(p => p.id)
          ))
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
          // Clear stale entries — they belonged to seats at the table
          // we just left and don't apply to whatever lobby/table comes
          // next. Without this, stale IDs would briefly tag wrong seats
          // until the next room snapshot overwrites the set.
          setDisconnectedPlayerIds(new Set())
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
          if (typeof msg.data.arenaThinkDelayMs === 'number') setArenaThinkDelayMs(msg.data.arenaThinkDelayMs)
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
              // Separate persistent off-table wallet. All stocks, options,
              // crypto, assets, jobs land here. The poker stack tops up
              // from this when busted.
              bankBalance: me.bankBalance ?? prev.bankBalance ?? 0,
              bankStartBalance: me.bankStartBalance ?? prev.bankStartBalance ?? 0,
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
          if (Array.isArray(msg.data.disabledTools)) {
            setRoomDisabledTools(new Set(
              msg.data.disabledTools.filter(id => TOGGLEABLE_TOOL_IDS.has(id))
            ))
          }
          // Authoritative refresh of the disconnected set: room_update
          // carries the canonical isConnected flag for every seat, so
          // recompute the set from it. This catches any drift between
          // the player_disconnected/reconnected broadcasts and the seat
          // state — e.g., if a broadcast was missed during a network
          // glitch the next room_update repairs the set.
          if (Array.isArray(msg.data.players)) {
            setDisconnectedPlayerIds(new Set(
              msg.data.players.filter(p => p && p.isConnected === false && !p.isBot).map(p => p.id)
            ))
          }
          // BUG FIX 2026-05: room_update carries a fresh gameState (built
          // by the same buildBroadcastViews the game_state push uses),
          // and it's the only refresh that fires between hands for things
          // like job claims / stock buys / bank balance changes. Without
          // this, the seat object the popover snapshots from gameState
          // stays stale (e.g. you earn 26k from a job, click your
          // profile, but it still shows $0 in the bank until the next
          // poker action). Mirror the spectator_update / game_state
          // handlers and apply if present.
          if (msg.data.gameState) applyGameState(msg.data.gameState)
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
        case 'dm:deleted':
          // Same bridge for the DMs popup. Open chat windows + the
          // conversation list both listen to this event. `dm:deleted`
          // fires when a stale table_invite gets evicted (host left the
          // table) so the inbox can drop the row without a refresh.
          emitDmEvent(msg)
          break
        case 'session_notif':
          // Ephemeral, table-scoped — works for anon seats too. Queue
          // the payload into the toast list; the renderer below auto-
          // dismisses each entry after a few seconds.
          pushSessionNotif(msg.data || {})
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
                addSys(`Winner: ${name} (+${(w.chips || 0).toLocaleString()}) — ${w.handName}`)
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
              if (m.result === 'win') addSys(`Side bet hit: ${msg.data.question} — +${(m.credit || 0).toLocaleString()} chips.`)
              else if (m.result === 'loss') addSys(`Side bet lost: ${msg.data.question} — −${(m.costPaid || 0).toLocaleString()} chips.`)
              else if (m.result === 'void') addSys(`Side bet void: ${msg.data.question} — ${(m.credit || 0).toLocaleString()} refunded.`)
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
          // Show the proposal to EVERYONE including the proposer, but
          // the UI flips to a sent-receipt view for the proposer (no
          // Approve/Reject buttons — they already auto-approved). The
          // proposer also needs visibility into who has responded so
          // they're not left wondering whether their request landed.
          setPendingBlindsProposal(msg.data)
          break
        case 'poker_blinds_resolved':
          setPendingBlindsProposal(null)
          if (msg.data?.outcome === 'applied') {
            addSys(`Blinds set to $${msg.data.small}/$${msg.data.big}.`)
            // Intentionally NOT persisted. Auto-restore of the last
            // blinds level was the source of the all-in-on-post bug;
            // every new table now starts at the 5/10 default and only
            // changes on a fresh, explicit proposal.
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
    }  // end inner connect()
    connect()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      clearChipThrows()
      clearEmotes()
      clearYells()
      clearSplitPotNotice()
      try { wsRef.current?.close() } catch {}
    }
  }, [addSys, addChipThrow, addTableEmote, addTableYell, applyGameState, clearChipThrows, clearEmotes, clearYells, clearSplitPotNotice, showSplitPotNotice])

  function send(type, data = {}) {
    // Guard against WebSocket.send on a CLOSING/CLOSED socket, which
    // throws InvalidStateError. With auto-reconnect, the WS can be
    // mid-reconnect when a user clicks something (emote, chat, side
    // bet, crypto, etc.) — silently drop the send rather than throwing
    // into the React handler. The user sees the "Reconnecting…" banner
    // and can retry once it clears.
    const ws = wsRef.current
    if (!ws || ws.readyState !== 1 /* OPEN */) return
    ws.send(JSON.stringify({ type, data }))
  }

  // Auto-join a specific table when the page is opened via a shared link
  // (?table=ROOM_ID) — typically a DM table invite. We wait for: WS up,
  // playerId assigned (server welcome), not already joined, and guard
  // against re-firing on every dependency change.
  useEffect(() => {
    if (!pendingTableId) return
    if (!connected || !playerId || joined) return
    if (autoJoinTried.current) return
    autoJoinTried.current = true
    // `join_table` tries for a seat first and falls back to spectator if
    // the room is full or it's an arena. The previous `spectate` mode
    // dropped the invitee in as a viewer even at empty regular tables —
    // not what an invite means; the host expects you to sit and play.
    send('join_game', { roomId: pendingTableId, mode: 'join_table' })
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
    // Host-only setting — only attached when the player is CREATING a
    // private room. Ignored by the server for every other join mode.
    const privateRoomExtras = mode === 'create_private'
      ? { disabledTools: [...privateRoomDisabledTools].filter(id => TOGGLEABLE_TOOL_IDS.has(id)) }
      : {}

    if (useSelf && mode !== 'spectate' && mode !== 'bot_arena') {
      return { playAsSelf: true, mode, ...privateRoomExtras, ...extra }
    }

    const payload = {
      username: username || undefined,
      mode,
      ...privateRoomExtras,
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

  // External hook for opening the table chat dock. Fired by the
  // messages-popup's "Table chat" pinned entry so the user can reach
  // the table chat from the same icon they reach DMs from. The handler
  // forces the dock on and shoves Side Bets aside (they share the slot).
  useEffect(() => {
    function handler() {
      setChatDockVisible(true)
      try { window.localStorage.removeItem(CHAT_VISIBLE_STORAGE_KEY) } catch {}
      setSideBetsDockVisible(false)
      try { window.localStorage.setItem(SIDE_BETS_VISIBLE_STORAGE_KEY, '0') } catch {}
    }
    window.addEventListener('gwu:open-table-chat', handler)
    return () => window.removeEventListener('gwu:open-table-chat', handler)
  }, [])

  // Open the Bank tools panel from anywhere in the app — the
  // profile-popover's "Take a bank loan →" CTA dispatches this
  // when the player's bank balance has gone negative. Implementing
  // it as a window event lets the popover stay portal-agnostic and
  // means future surfaces (the InvestmentHUD's Money tile, etc) can
  // re-use the same hook with one line.
  useEffect(() => {
    function handler() {
      setActivePokerPanel('bank')
    }
    window.addEventListener('gwu:open-bank-panel', handler)
    return () => window.removeEventListener('gwu:open-bank-panel', handler)
  }, [])

  // "Check in the dark" / pre-action queue intentionally removed —
  // it was firing checks (and chaining into surprise all-ins for some
  // users) without an explicit per-street confirmation. The table is
  // now strictly action-on-your-turn-only: nothing fires until the
  // human clicks Fold/Check/Call/Raise/All-In themselves.
  // Self's peer loans, extracted from whichever side of the table we're
  // on (seated or spectating). Pulled out of liquidatedSummary's deps so
  // unrelated gameState churn (bets/folds by other seats) doesn't invalidate
  // the memo on every action.
  const myPeerLoans = useMemo(() => {
    return gameState?.players?.find(p => p.id === playerId)?.peerLoans
      || gameState?.spectators?.find?.(p => p.id === playerId)?.peerLoans
      || []
  }, [gameState?.players, gameState?.spectators, playerId])
  // "If everything settles right now" stack — drives the persistent
  // top-left widget and is the same formula FinancesPanel renders.
  // bank loans (owed) leave; parked side-bet stake comes back; peer
  // loans net out; crypto holdings sell at current mid. Recomputed on
  // every crypto tick because price moves continuously.
  const liquidatedSummary = useMemo(() => {
    const chips = bankState.chips ?? 0
    // BUG FIX 2026-05: net-worth was reading only the poker stack and
    // ignoring the bank balance, so jobs / stock proceeds / crypto
    // sells landed in the bank but never showed up in the widget.
    // Bank balance is the player's persistent wallet — everything
    // earned outside the table lives here.
    const bank = bankState.bankBalance ?? 0
    const bankDebt = (bankState.loans || []).reduce((s, l) => s + (l.owed || 0), 0)
    const parked = bankState.openSideBetStake ?? 0
    let peerOwedIn = 0
    let peerOwedOut = 0
    for (const l of myPeerLoans) {
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
    const liquidated = chips + bank + parked + peerOwedIn + cryptoValue - bankDebt - peerOwedOut
    return {
      chips,
      bank,
      liquidated: Math.round(liquidated),
      delta: Math.round(liquidated - chips - bank),
      bankDebt,
      parked,
      peerOwedIn,
      peerOwedOut,
      cryptoValue: Math.round(cryptoValue),
      cryptoCost: Math.round(cryptoCost),
      cryptoPnl: Math.round(cryptoValue - cryptoCost)
    }
  }, [bankState.chips, bankState.bankBalance, bankState.loans, bankState.openSideBetStake, myPeerLoans, playerId, cryptoState])
  const myBet = myPlayer?.bet || 0
  const currentBetAmount = gameState?.currentBet || 0
  const toCall = currentBetAmount - myBet
  const phase = gameState?.phase || 'waiting'
  const isWaitingNextHand = myPlayer?.waitingNextHand
  // Emote + yell inputs share the same "chat" toggle on the server —
  // hiding the row when chat is disabled keeps the UI honest with the
  // gate (no buttons that always 403).
  const canUseEmotes = !isSpectator && Boolean(myPlayer) && !roomDisabledTools.has('chat')
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
    // includeDetails was tied to the now-removed "detailed" expansion
    // state; the compact widget never needs the heavy made-hand-range /
    // outs / threats computation, so this stays false.
    () => statsMode ? buildPokerStatistics(deferredGameState, playerId, { includeDetails: false }) : null,
    [statsMode, deferredGameState, playerId]
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
  // Lifted out of the action-panel IIFE so the floating mini-table
  // window (PokerWindow) can read the same derived state and render
  // exactly-aligned action buttons. The action-panel render keeps its
  // own shadowing locals untouched — these top-level versions are
  // strictly additive.
  const inHand = phase !== 'waiting' && phase !== 'showdown' && !myPlayer?.folded && !myPlayer?.waitingNextHand
  const canAct = inHand && isMyTurn && connected
  const hasRaiseRoom = (myPlayer?.chips ?? 0) > minRaise
  const safeRaise = raiseAmount < minRaise ? minRaise : raiseAmount
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
    // Intentionally do NOT clear the input — leaving the text in place
    // lets a player mash Enter to repeat-yell ("spam yell"), which the
    // user explicitly asked us to restore. The Esc key + manual edit
    // are the way to clear.
    setYellHistory(prev => {
      const without = prev.filter(y => y !== message)
      return [message, ...without].slice(0, 20)
    })
    setYellHistoryIndex(-1)
    setYellDraft(message)
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
    // Customize-mode shortcut: clicks toggle hide-state instead of
    // opening the panel. The menu stays open so the user can hide
    // multiple tools in one session. Only the Recents bar bypasses
    // this (Recents pills always open even in customize mode).
    if (toolsCustomizing) {
      toggleToolHidden(panel)
      return
    }
    // Host-disabled tool in this private room — defensive guard. The
    // menu and recents bar already filter these out, but a stale LRU
    // entry or a direct shortcut could still hit this path.
    if (panel && roomDisabledTools.has(panel)) {
      setTableMenuOpen(false)
      return
    }
    // 'finances' is no longer a popup panel — the inline Finances
    // Widget is the only finances surface. Any legacy caller asking
    // for the panel gets the widget toggled on instead.
    if (panel === 'finances') {
      setFinancesWidgetOpenPersist(true)
      setTableMenuOpen(false)
      return
    }
    // Markets open as floating widgets, not as embedded panels —
    // multiple can be open at once, each is draggable/resizable.
    if (MARKET_WIDGET_IDS.has(panel)) {
      setWidgetPanelsPersist(prev => {
        const next = new Set(prev)
        if (next.has(panel)) next.delete(panel)
        else next.add(panel)
        return next
      })
      if (panel && !TOOLS_LRU_BLOCKLIST.has(panel)) bumpToolsLRU(panel)
      return
    }
    setActivePokerPanel(prev => prev === panel ? null : panel)
    // Tools menu stays open while a panel is active — the panel layers
    // on top (z-[600]) and Back-to-Tools returns focus to the still-
    // visible menu so the user can pick another tool without re-
    // opening Tools every time.
    if (panel === 'bots' || panel === 'arena') refreshBotRoster()
    if (panel === 'profile') {
      setProfileDraftName(username)
      setProfileDraftAvatar(selectedAvatarId)
    }
    if (panel === 'reset') setResetConfirmArmed(false)
    if (panel === 'big_yahu') setBigYahuArmed(false)
    // Track in the Tools-menu Recents bar. We don't track everything —
    // some panels (reset/big_yahu) are destructive and shouldn't shortcut.
    if (panel && !TOOLS_LRU_BLOCKLIST.has(panel)) bumpToolsLRU(panel)
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
      // Chat + Side Bets share the same bottom-right dock slot. They
      // can coexist when at least one is in freeform mode — only the
      // both-docked case forces mutual exclusion. So turning chat on
      // only kicks side bets out of the dock if side bets is also
      // docked (i.e. not in freeform).
      if (next && sideBetsDockVisible && !widgetFreeform.sidebets) {
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
      // Mutually exclude only when BOTH would be docked. If chat is in
      // freeform mode, it isn't using the dock slot, so side bets can
      // dock without kicking chat out.
      if (next && chatDockVisible && !widgetFreeform.chat) {
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
    // Immediate sender-side receipt — server only echoes back if the
    // request lands (i.e. not solo-human auto-apply). Without this,
    // a user who proposes blinds gets no confirmation that the
    // message even left the client.
    addSys(`Asked the table to switch blinds to $${level.small}/$${level.big}…`)
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
    // If the items panel has an editor open, a single "Back" tap
    // should close just the editor (returning to the items+powers
    // grid). Only a second tap escapes all the way out to the
    // tools menu. Without this, the chrome Back skipped two
    // levels at once and felt jarring.
    if (activePokerPanel === 'items' && itemsActiveEditor) {
      setItemsActiveEditor(null)
      return
    }
    setActivePokerPanel(null)
    setTableMenuOpen(true)
  }

  function saveProfileChanges() {
    const name = (profileDraftName || '').trim().slice(0, 24)
    if (!name && !profileDraftAvatar) return
    send('update_profile', { username: name || undefined, avatarId: profileDraftAvatar || undefined })
    // Mirror the saved values into local state + localStorage so the
    // change persists across reloads. Without this, hydrating from
    // localStorage on the next page load would clobber the new name
    // with the old saved one. The 'http(s)://' branch on avatar
    // preserves custom uploads' full URL; preset IDs round-trip as
    // their short id.
    if (name) {
      setUsername(name)
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(USERNAME_STORAGE_KEY, name)
        }
      } catch {}
    }
    if (profileDraftAvatar) {
      setSelectedAvatarId(profileDraftAvatar)
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(AVATAR_STORAGE_KEY, profileDraftAvatar)
        }
      } catch {}
    }
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
      try {
        if (next) window.localStorage.setItem(STATS_MODE_STORAGE_KEY, '1')
        else window.localStorage.removeItem(STATS_MODE_STORAGE_KEY)
      } catch {}
      return next
    })
  }

  // Wrapper around setFinancesWidgetOpen that mirrors the new value to
  // localStorage. All toggle sites (Tools menu, the × on the inline pill)
  // route through here so persistence stays in lockstep with state.
  function setFinancesWidgetOpenPersist(next) {
    setFinancesWidgetOpen(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      try {
        if (value) window.localStorage.setItem(FINANCES_WIDGET_STORAGE_KEY, '1')
        else window.localStorage.removeItem(FINANCES_WIDGET_STORAGE_KEY)
      } catch {}
      return value
    })
  }

  // Toggle the Investment HUD on/off. We persist only the "off" state
  // ('0') — absence-of-key keeps the default ON behavior for new users.
  function setHudEnabledPersist(next) {
    setHudEnabled(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      try {
        if (value) window.localStorage.removeItem(HUD_ENABLED_STORAGE_KEY)
        else window.localStorage.setItem(HUD_ENABLED_STORAGE_KEY, '0')
      } catch {}
      return value
    })
  }

  // Outside-click auto-minimize was here back when the equity widget
  // had Normal / Detailed expansion modes. Both expansions were
  // removed in 2026-05 — the widget is now a single compact pill, so
  // there's nothing to collapse and this effect is no longer needed.

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
        privateRoomDisabledTools={privateRoomDisabledTools}
        togglePrivateRoomDisabledTool={togglePrivateRoomDisabledTool}
        setAllPrivateRoomDisabledTools={setAllPrivateRoomDisabledTools}
      />
    )
  }

  // Chat box body — used both inline under the action stack (when seated)
  // and inside the fixed-position spectator dock. Header has its own close
  // button so the user can toggle the dock off without hunting the Tools
  // menu. messagesEndRef is attached on every render; the parent already
  // owns the scroll-to-bottom effect.
  // `showInlineClose` lets the freeform FloatingWindow caller suppress
  // the inner × — the floating chrome already has its own close, and
  // rendering both would double-stack the X icon.
  const renderChatInner = (showInlineClose = true) => (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-zinc-700/60 bg-zinc-900/60 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Chat</span>
        {showInlineClose && (
          <button
            type="button"
            onClick={toggleChatDock}
            aria-label="Close chat"
            title="Close chat"
            className="-mr-2 rounded-md px-1.5 text-base leading-none text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
          >
            ×
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {chatMessages.length === 0 && sysMessages.length === 0 && (
          <div className="text-xs text-zinc-600 italic">No messages...</div>
        )}
        {sysMessages.map((msg, i) => (
          <div key={`s-${i}`} className="text-xs text-zinc-600 italic font-medium">{msg}</div>
        ))}
        {chatMessages.map((msg, i) => {
          // Detect if the local viewer was @-mentioned by this line.
          // The server attached a `mentions` array of playerIds; we
          // light the row up so the user clocks it even mid-scroll.
          const mentionsMe = Array.isArray(msg.mentions) && msg.mentions.includes(playerId)
          return (
            <div
              key={`c-${i}`}
              className={`text-sm rounded ${mentionsMe ? 'bg-zinc-200/10 px-1 py-0.5 -mx-1' : ''}`}
            >
              <span className={`font-bold ${msg.playerId === playerId ? 'text-white' : 'text-zinc-300'}`}>
                {msg.playerId === playerId ? 'You' : msg.username}{msg.isSpectator ? ' (spectator)' : ''}:
              </span>
              <span className="text-zinc-100 ml-1.5">
                {/* Walk the message text and tint @tokens. Simple split
                    on (^|\s)@(word) — no regex highlighting library
                    needed for this scale of chat. */}
                {renderChatWithMentions(msg.message)}
              </span>
            </div>
          )
        })}
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
  const chatBoxInner = renderChatInner(true)

  return (
    <div className="min-h-[100dvh] flex flex-col p-3 md:p-4 max-w-7xl mx-auto overflow-x-hidden">

      {/* Top Header Row.
          Tools + Lobby cluster used to live INSIDE this row with
          `mr-X` to clear the AccountDock. That positioned it relative
          to the parent (max-w-7xl mx-auto, centered), so on wide
          desktops the cluster sat far from the viewport edge while
          the dock was fixed AT the viewport edge — leaving a big gap
          between the two. Now Tools + Lobby live in a fixed-positioned
          RouteNavCluster (below) so they share the dock's coordinate
          system. The row keeps only the left cluster + a right-padding
          reservation to prevent that cluster from sliding under the
          fixed Tools+Lobby chips. */}
      <div className={`relative flex flex-wrap items-center gap-y-2 mb-3 sm:mb-4 z-[500] shrink-0 ${authUser ? 'pr-36 sm:pr-44' : 'pr-48 sm:pr-60'}`}>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          {isArena && (
            <button
              type="button"
              onClick={() => openPokerPanel('arena')} title={TOOLS_TOOLTIPS.arena}
              title="Open arena controls"
              className={`text-xs sm:text-sm font-bold border px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm transition-transform active:scale-95 cursor-pointer ${arenaRunning ? 'bg-emerald-700/80 text-emerald-50 border-emerald-500/50 hover:bg-emerald-700/90' : 'bg-amber-700/70 text-amber-50 border-amber-500/50 hover:bg-amber-700/85'}`}
            >
              Arena {arenaRunning ? '· Live' : '· Paused'}
            </button>
          )}
          {isSpectator && !isArena && (
            <span className="text-xs sm:text-sm font-bold bg-zinc-700/80 text-white border border-zinc-500/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm">Spectating</span>
          )}
          {reconnecting && (
            <span
              title="Your seat is held while we reconnect — auto-checks/folds run for you until we're back."
              className="text-xs sm:text-sm font-bold bg-amber-700/80 text-amber-50 border border-amber-500/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm animate-pulse whitespace-nowrap"
            >
              Reconnecting…
            </span>
          )}
          <PhaseLabel phase={phase} />
          {/* Crypto portfolio quick-access pill. Visible whenever the
              player holds any position; sums shares × current price
              across all owned coins and shows the P/L vs cost basis.
              One tap opens the Crypto Market panel — same destination
              as the Tools menu entry, but always one click away. */}
          {(() => {
            const positions = cryptoState?.myPositions || []
            if (positions.length === 0) return null
            const coinIndex = new Map((cryptoState?.coins || []).map(c => [c.id, c]))
            let value = 0
            let cost = 0
            for (const p of positions) {
              const c = coinIndex.get(p.coinId)
              if (!c) continue
              value += (p.shares || 0) * (c.price || 0)
              cost += p.costBasis || 0
            }
            const pl = Math.round(value - cost)
            const plClass = pl >= 0 ? 'text-emerald-300' : 'text-red-300'
            const sign = pl >= 0 ? '+' : '−'
            return (
              <button
                type="button"
                onClick={() => openPokerPanel('crypto')} title={TOOLS_TOOLTIPS.crypto}
                title={`Open Crypto Market — ${positions.length} position${positions.length === 1 ? '' : 's'}`}
                className="text-xs sm:text-sm font-bold bg-fuchsia-700/70 text-fuchsia-50 border border-fuchsia-500/50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg shadow-sm hover:bg-fuchsia-700/90 active:scale-95 whitespace-nowrap flex items-center gap-1.5"
              >
                <span className="text-[10px] uppercase tracking-wider text-fuchsia-200">Crypto</span>
                <span>${Math.round(value).toLocaleString()}</span>
                <span className={plClass}>{sign}${Math.abs(pl).toLocaleString()}</span>
              </button>
            )
          })()}
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
          {/* Finances widget — inline in the header row so it flex-wraps
              alongside the other pills (Arena / Phase / Chips·PL / Code)
              instead of fixed-positioning at top-left, where it would
              overlap the spectator chips/PL pill. Same rounded-lg /
              border / padding as those siblings for visual parity. Only
              renders when toggled on via the Tools menu. */}
          {financesWidgetOpen && joined && !roomDisabledTools.has('finances') && (
            <div className="rounded-lg border border-zinc-600/60 bg-zinc-900/95 px-2 py-1 sm:px-3 sm:py-1.5 shadow-sm backdrop-blur-md flex items-center gap-2 text-[11px] sm:text-xs font-bold text-zinc-100 whitespace-nowrap">
              {/* Body is a button — clicking the pill opens the
                  Investment HUD widget. The HUD itself has the
                  detailed breakdown; the pill is the always-on glance
                  surface. */}
              <button
                type="button"
                onClick={() => setHudEnabledPersist(true)}
                title="Open Investment HUD"
                className="flex items-center gap-2 -mx-1 px-1 py-0.5 rounded hover:bg-zinc-800"
              >
                <span className="text-[9px] uppercase tracking-wider text-zinc-500">Net</span>
                <span className={`tabular-nums ${liquidatedSummary.liquidated < 0 ? 'text-red-300' : ''}`}>
                  ${liquidatedSummary.liquidated.toLocaleString()}
                </span>
                {(liquidatedSummary.cryptoValue > 0 || liquidatedSummary.cryptoCost > 0) && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className={`tabular-nums ${liquidatedSummary.cryptoPnl > 0 ? 'text-emerald-300' : liquidatedSummary.cryptoPnl < 0 ? 'text-red-300' : 'text-zinc-400'}`}>
                      {liquidatedSummary.cryptoPnl >= 0 ? '+' : ''}${liquidatedSummary.cryptoPnl.toLocaleString()}
                    </span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setFinancesWidgetOpenPersist(false)}
                aria-label="Close finance widget"
                className="-mr-0.5 rounded px-1 text-sm leading-none text-zinc-500 hover:text-zinc-200"
              >
                ×
              </button>
            </div>
          )}
        </div>
        {/* Tools + Lobby cluster. RouteNavCluster uses `position: fixed`
            so it lives in the viewport coordinate system (same as the
            AccountDock) — even though it's authored inside the row in
            the DOM, it's pulled OUT of the row's flex flow at render
            time. That fixes the wide-desktop gap that the old `mr-X`
            approach had: mr was measured from the parent container's
            right edge (max-w-7xl mx-auto), but the dock is anchored to
            the viewport's right edge. With fixed positioning both are
            in the same frame. The parent row reserves right-side
            padding so its left cluster never slides under these chips. */}
        <RouteNavCluster>
          {/* Wrapper ref captures the natural width of the Tools +
              Lobby pair so the equity widget below can size to match
              it exactly. Inner gap-2 matches RouteNavCluster's own
              gap; the cluster's outer gap still spaces this wrapper
              from the signed-out Sign-in chip. */}
          <div ref={navPairRef} className="flex items-center gap-2">
          <div ref={tableMenuRef} className="relative">
            <button
              type="button"
              onClick={() => setTableMenuOpen(prev => {
                const nextOpen = !prev
                if (nextOpen) {
                  setActivePokerPanel(null)
                  // If the user pressed H to stash popups, opening
                  // Tools brings them all back — same effect as a
                  // second H. Avoids a "wait, where did my windows
                  // go?" moment when reaching for Tools.
                  showAllFloatingWindows()
                }
                return nextOpen
              })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
            >
              Tools
            </button>
            {tableMenuOpen && (() => {
              // Tools dropdown body. Either anchors to the Tools button
              // (default) OR floats free as a draggable window when the
              // user has flipped `toolsFreeform` in the header. The
              // body itself is identical — only the outer wrapper
              // changes.
              const menuBody = (
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
              <>
                {/* Customize toggle — when on, every tool button shows
                    a × badge that toggles its hidden state. Persisted
                    in localStorage so hides survive reloads. */}
                <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Tools</span>
                  <div className="flex items-center gap-1.5">
                    {/* Free / anchor toggle — flips the dropdown into a
                        draggable floating window and back. Persists. */}
                    <button
                      type="button"
                      onClick={() => setToolsFreeformPersist(!toolsFreeform)}
                      title={toolsFreeform ? 'Re-anchor to the Tools button' : 'Pop out as a draggable window'}
                      className={`whitespace-nowrap text-[9px] font-black uppercase tracking-widest rounded-md border px-2 py-0.5 ${
                        toolsFreeform
                          ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {toolsFreeform ? '↺ Anchor' : '↗ Pop out'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setToolsCustomizing(v => !v)}
                      className={`whitespace-nowrap text-[9px] font-black uppercase tracking-widest rounded-md border px-2 py-0.5 ${
                        toolsCustomizing
                          ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                    >
                      {toolsCustomizing ? 'Done' : 'Customize'}
                    </button>
                    {/* Close × — only shown in anchored mode; freeform
                        mode gets its × from FloatingWindow's own chrome.
                        Styled to match the FloatingWindow title-bar ×. */}
                    {!toolsFreeform && (
                      <button
                        type="button"
                        onClick={() => setTableMenuOpen(false)}
                        aria-label="Close Tools"
                        className="rounded px-1.5 text-base leading-none text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      >×</button>
                    )}
                  </div>
                </div>
                {/* Recents bar — last 5 panels you opened. Persists in
                    localStorage so it's there next session too. Sits
                    above the 2-column section grid as a single full-
                    width row so a returning player can one-tap their
                    most-used tool without scanning the whole menu. */}
                {toolsLRU.filter(id => !roomDisabledTools.has(id)).length > 0 && (
                  <div className="border-b border-zinc-800 px-3 pt-2 pb-2">
                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">Recents</div>
                    <div className="flex flex-wrap gap-1.5">
                      {toolsLRU.map(panelId => {
                        const meta = TOOLS_LRU_META[panelId]
                        if (!meta) return null
                        if (roomDisabledTools.has(panelId)) return null
                        return (
                          <button
                            key={panelId}
                            type="button"
                            onClick={() => openPokerPanel(panelId)}
                            className={`rounded-md border border-zinc-600/60 bg-zinc-800 px-2 py-1 text-[10px] font-black uppercase tracking-widest hover:bg-zinc-700 ${meta.accent}`}
                          >
                            {meta.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
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


                    {/* ── MARKETS ─────────────────────────────────── */}
                    {/* Basic Info (How to Play, Current Hand, Session,
                        Daily, Finances) lives in the right column under
                        its own header below Big Yahu — keeps this column
                        focused on the games-within-the-game. Header is
                        conditional on at least one market entry still
                        being visible — otherwise the host-disabled list
                        could leave it floating alone above social. */}
                    {(
                      !roomDisabledTools.has('crypto') ||
                      !roomDisabledTools.has('items') ||
                      !roomDisabledTools.has('assets') ||
                      !roomDisabledTools.has('jobs') ||
                      !roomDisabledTools.has('stocks') ||
                      !roomDisabledTools.has('world') ||
                      !roomDisabledTools.has('influence') ||
                      authUser
                    ) && (
                      <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Markets</div>
                    )}
                    {/* Market entries — they open as floating widgets,
                        not embedded panels. To make that visually
                        obvious, each uses the same dot + colored-text
                        "On / Off" treatment the existing widget
                        toggles (Hand Equity, Chat, etc.) use — colored
                        + glowing when the widget is open, grayed when
                        closed. The ★ prefix is gone; the dot does the
                        work of "this is a togglable widget". */}
                    {(() => {
                      const MARKET_ENTRIES = [
                        { id: 'crypto', label: 'Crypto Market',  on: 'text-fuchsia-200', dot: 'bg-fuchsia-400 shadow-[0_0_6px_rgba(232,121,249,0.7)]' },
                        { id: 'items',  label: 'Items & Powers', on: 'text-lime-200',    dot: 'bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.7)]' },
                        { id: 'assets', label: 'Real Estate',    on: 'text-emerald-200', dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' },
                        { id: 'jobs',   label: 'Jobs Board',     on: 'text-orange-200',  dot: 'bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.7)]' },
                        { id: 'stocks', label: 'Stock Market',   on: 'text-sky-200',     dot: 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]' },
                        { id: 'world',  label: 'World Map',      on: 'text-purple-200',  dot: 'bg-purple-400 shadow-[0_0_6px_rgba(192,132,252,0.7)]' },
                      ]
                      return MARKET_ENTRIES.map(({ id, label, on, dot }) => {
                        if (roomDisabledTools.has(id)) return null
                        if (toolsHidden.has(id) && !toolsCustomizing) return null
                        const open = widgetPanels.has(id)
                        const colorCls = open ? on : 'text-zinc-400'
                        const dotCls = open ? dot : 'bg-zinc-600'
                        let badge = null
                        if (toolsCustomizing) {
                          badge = <span className="ml-auto text-[9px] text-zinc-400">{toolsHidden.has(id) ? '+show' : '×hide'}</span>
                        } else if (id === 'items') {
                          const ready = (itemsState?.items || []).filter(i => i.ready).length
                          if (ready > 0) badge = <span className="ml-auto rounded-md bg-lime-500/20 px-1.5 py-0.5 text-[10px] text-lime-300">{ready} ready</span>
                        } else if (id === 'assets') {
                          const n = assetsState?.myPositions?.length || 0
                          if (n > 0) badge = <span className="ml-auto rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">{n}</span>
                        }
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => openPokerPanel(id)}
                            title={TOOLS_TOOLTIPS[id]}
                            className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${colorCls} ${toolsHidden.has(id) ? 'opacity-40' : ''}`}
                          >
                            <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
                            <span className="truncate">{label} {open ? 'On' : 'Off'}</span>
                            {badge}
                          </button>
                        )
                      })
                    })()}
                    {/* ★ Influence Ops entry removed — ops now live as
                        tabs inside Stocks / World Map / Real Estate.
                        roomDisabledTools.has('influence') is still
                        respected via each host panel's conditional
                        rendering of its Influence tab. */}
                    {authUser && (
                      <button
                        type="button"
                        onClick={() => {
                          // Toggle the Feed window like the other widget
                          // toggles — clicking when open closes it,
                          // clicking when closed opens + brings focus.
                          if (feedWindowOpen) {
                            setFeedWindowOpen(false)
                            setFeedOpenedFromTools(false)
                          } else {
                            setFeedWindowOpen(true)
                            setFeedOpenedFromTools(true)
                          }
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${feedWindowOpen ? 'text-violet-200' : 'text-zinc-400'}`}
                      >
                        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${feedWindowOpen ? 'bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.7)]' : 'bg-zinc-600'}`} />
                        <span className="truncate">Social Media {feedWindowOpen ? 'On' : 'Off'}</span>
                      </button>
                    )}

                    {/* ── WIDGETS ─────────────────────────────────── */}
                    {/* Widgets header is conditional — if the host
                        disabled every widget in the section, the header
                        would otherwise stand alone with no children.
                        Mini Table always counts (no host toggle), so
                        the header is always shown when Mini Table is
                        the only resident. */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Widgets</div>
                    {/* Floating mini-table — a draggable PiP-style
                        window with the same actions as the main view.
                        Same shared state, so clicks in either surface
                        move the real game. Stays open across pokerpanel
                        / chat / sidebet interactions. */}
                    <button
                      type="button"
                      onClick={() => setPokerWindowOpen(v => !v)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${pokerWindowOpen ? 'text-emerald-200' : 'text-zinc-400'}`}
                    >
                      <span className={`inline-block h-2 w-2 rounded-full ${pokerWindowOpen ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' : 'bg-zinc-600'}`} />
                      Mini Table {pokerWindowOpen ? 'On' : 'Off'}
                    </button>
                    {!isSpectator && !roomDisabledTools.has('equity') && (
                      <button type="button" onClick={toggleStatsMode} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${statsMode ? 'text-sky-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${statsMode ? 'bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.7)]' : 'bg-zinc-600'}`} />
                        Hand Equity {statsMode ? 'On' : 'Off'}
                      </button>
                    )}
                    {!roomDisabledTools.has('chat') && (
                      <button type="button" onClick={toggleChatDock} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${chatDockVisible ? 'text-cyan-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${chatDockVisible ? 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.7)]' : 'bg-zinc-600'}`} />
                        Chat {chatDockVisible ? 'On' : 'Off'}
                      </button>
                    )}
                    {!roomDisabledTools.has('sidebets') && (
                      <button type="button" onClick={toggleSideBetsDock} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${sideBetsDockVisible ? 'text-amber-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${sideBetsDockVisible ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]' : 'bg-zinc-600'}`} />
                        Side Bets {sideBetsDockVisible ? 'On' : 'Off'}
                        {sideBetsState?.props?.length ? (
                          <span className="ml-auto rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                            {sideBetsState.props.filter(p => p.status === 'open').length} live
                          </span>
                        ) : null}
                      </button>
                    )}
                    {!roomDisabledTools.has('finances') && (
                      <button type="button" onClick={() => setFinancesWidgetOpenPersist(prev => !prev)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${financesWidgetOpen ? 'text-emerald-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${financesWidgetOpen ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' : 'bg-zinc-600'}`} />
                        Finances Widget {financesWidgetOpen ? 'On' : 'Off'}
                      </button>
                    )}
                    {!roomDisabledTools.has('hud') && (
                      <button type="button" onClick={() => setHudEnabledPersist(prev => !prev)} title="Floating widget that summarizes every position across crypto, stocks, real estate, and territories" className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${hudEnabled ? 'text-amber-200' : 'text-zinc-400'}`}>
                        <span className={`inline-block h-2 w-2 rounded-full ${hudEnabled ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.7)]' : 'bg-zinc-600'}`} />
                        Investment HUD {hudEnabled ? 'On' : 'Off'}
                      </button>
                    )}

                    {/* ── DAILY ───────────────────────────────────── */}
                    {/* Own section under Widgets so the rotating daily
                        prompt reads as its own thing — not buried with
                        reference info. Amber accent matches the in-game
                        challenge chip. */}
                    {!roomDisabledTools.has('daily') && (
                      <>
                        <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Daily Challenge</div>
                        <button type="button" onClick={() => openPokerPanel('daily')} title={TOOLS_TOOLTIPS.daily} className="block w-full px-3 py-2 text-left text-xs font-bold text-amber-200 hover:bg-zinc-800">
                          ★ Today's Challenge
                        </button>
                      </>
                    )}

                    {/* ── GUIDE ───────────────────────────────────── */}
                    {/* Hand-holding section — How to Play (moved from
                        Basic Info) plus the reference for keyboard
                        shortcuts that act on the floating popout
                        windows. Sits under Daily so a new user landing
                        here lands on the right onboarding ramp. */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Guide</div>
                    <button type="button" onClick={() => openPokerPanel('help')} title={TOOLS_TOOLTIPS.help} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      How to Play
                    </button>
                    <button type="button" onClick={() => openPokerPanel('shortcuts')} title="Keyboard shortcuts for the floating windows" className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Window Shortcuts
                    </button>
                  </div>

                  {/* ════════ RIGHT COLUMN: actions & profile ════════ */}
                  {/* `border-t md:border-t-0` adds a horizontal rule on
                      mobile (single-column) so the two former columns
                      don't visually run together. On md+ the divide-x
                      handles separation. */}
                  <div className="flex flex-col border-t border-zinc-800 md:border-t-0">
                    {/* ── FELT COLOR ────────────────────────────────
                        5 built-ins + 5 custom slots, per-player and
                        persisted via localStorage so the choice
                        follows the user to every table / arena /
                        private room. The empty custom slots show a
                        "+" that opens the native HTML5 color picker;
                        filled slots apply on click and have a ×
                        overlay to clear. */}
                    <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Felt color</div>
                    <div className="px-3 py-2">
                      <div className="grid grid-cols-5 gap-1.5">
                        {TABLE_COLOR_PALETTES.map(p => {
                          const active = p.id === tableColorId
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setTableColorId(p.id)}
                              title={p.label}
                              aria-label={`Set felt to ${p.label}`}
                              className={`relative h-7 w-7 mx-auto rounded-full border transition-transform ${active ? 'ring-2 ring-zinc-500 scale-110 border-zinc-700' : 'border-zinc-600 hover:scale-110'}`}
                              style={{ background: p.swatch }}
                            />
                          )
                        })}
                      </div>
                      <div className="mt-1 text-center text-[9px] font-black uppercase tracking-widest text-zinc-500">Defaults</div>

                      <div className="mt-2 grid grid-cols-5 gap-1.5">
                        {Array.from({ length: TABLE_CUSTOM_SLOTS }).map((_, i) => {
                          const entry = customColors[i]
                          const slotId = `${TABLE_CUSTOM_PREFIX}${i}`
                          const active = tableColorId === slotId
                          if (!entry) {
                            // Empty slot — clicking opens the native
                            // color picker. We render a hidden
                            // <input type="color"> per slot and route
                            // the click through a label so the picker
                            // launches without our own wrapper button
                            // swallowing the event.
                            return (
                              <label
                                key={i}
                                className="relative h-7 w-7 mx-auto rounded-full border border-dashed border-zinc-600 text-zinc-400 flex items-center justify-center text-xs font-black cursor-pointer hover:text-white hover:border-zinc-400"
                                title={`Save a custom color into slot ${i + 1}`}
                              >
                                +
                                <input
                                  type="color"
                                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                                  // Default the picker to emerald so an
                                  // accidental open + close doesn't slam
                                  // pure black into the slot.
                                  defaultValue="#14472c"
                                  onChange={(e) => {
                                    const hex = e.target.value
                                    if (!/^#[a-f0-9]{6}$/i.test(hex)) return
                                    const next = customColors.slice()
                                    next[i] = { hex, label: `Custom ${i + 1}` }
                                    setCustomColors(next)
                                    setTableColorId(slotId)
                                  }}
                                />
                              </label>
                            )
                          }
                          return (
                            <div key={i} className="relative h-7 w-7 mx-auto">
                              <button
                                type="button"
                                onClick={() => setTableColorId(slotId)}
                                title={`${entry.label || `Custom ${i + 1}`} · ${entry.hex}`}
                                aria-label={`Apply custom color ${i + 1}`}
                                className={`h-7 w-7 rounded-full border transition-transform ${active ? 'ring-2 ring-zinc-500 scale-110 border-zinc-700' : 'border-zinc-600 hover:scale-110'}`}
                                style={{ background: entry.hex }}
                              />
                              {/* Edit affordance — overlapping color
                                  picker input. Lets the user re-pick
                                  without first clearing the slot. */}
                              <label
                                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border border-zinc-900 bg-zinc-800 text-[8px] leading-[10px] text-zinc-200 flex items-center justify-center cursor-pointer hover:bg-zinc-700"
                                title="Edit color"
                              >
                                ✎
                                <input
                                  type="color"
                                  className="absolute inset-0 h-full w-full opacity-0 cursor-pointer"
                                  defaultValue={entry.hex}
                                  onChange={(e) => {
                                    const hex = e.target.value
                                    if (!/^#[a-f0-9]{6}$/i.test(hex)) return
                                    const next = customColors.slice()
                                    next[i] = { hex, label: entry.label || `Custom ${i + 1}` }
                                    setCustomColors(next)
                                    if (active) {
                                      // Force a re-render of the felt
                                      // by reapplying the same id —
                                      // tablePalette already re-derives
                                      // from customColors, so no work.
                                    }
                                  }}
                                />
                              </label>
                              {/* Clear (×) — two-step confirm: first
                                  click arms the × (red); second click
                                  on the SAME × actually deletes. Stops
                                  fat-finger deletes of a hand-picked
                                  custom color the user spent time
                                  dialing in. */}
                              {(() => {
                                const armed = clearArmedSlot === i
                                return (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (!armed) {
                                        setClearArmedSlot(i)
                                        if (clearArmTimerRef.current) clearTimeout(clearArmTimerRef.current)
                                        clearArmTimerRef.current = setTimeout(() => {
                                          setClearArmedSlot(null)
                                          clearArmTimerRef.current = null
                                        }, 3000)
                                        return
                                      }
                                      // Armed — commit the delete.
                                      if (clearArmTimerRef.current) {
                                        clearTimeout(clearArmTimerRef.current)
                                        clearArmTimerRef.current = null
                                      }
                                      setClearArmedSlot(null)
                                      const next = customColors.slice()
                                      next[i] = null
                                      // Compact nulls AFTER the cleared
                                      // index? Don't — keep slot indices
                                      // stable so the user's spatial
                                      // memory survives a clear.
                                      setCustomColors(next)
                                      if (active) setTableColorId(DEFAULT_TABLE_COLOR_ID)
                                    }}
                                    title={armed ? 'Click again to confirm' : 'Clear this slot'}
                                    aria-label={armed
                                      ? `Confirm clearing custom color slot ${i + 1}`
                                      : `Clear custom color slot ${i + 1}`}
                                    aria-pressed={armed}
                                    className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border flex items-center justify-center text-[9px] leading-[10px] transition-colors ${
                                      armed
                                        ? 'border-red-400 bg-red-500/80 text-white animate-pulse'
                                        : 'border-zinc-900 bg-zinc-800 text-zinc-200 hover:bg-red-500/30 hover:text-red-100'
                                    }`}
                                  >
                                    ×
                                  </button>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-1 text-center text-[9px] font-black uppercase tracking-widest text-zinc-500">Custom slots</div>
                    </div>

                    {/* ── ACTIONS ─────────────────────────────────── */}
                    <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Actions</div>
                    {/* Bank is open to spectators too — they can take loans and
                        place side bets on the runout even without a seat at the
                        table. Soft teal accent + ★ so it reads as a featured
                        destination, matching the auto-fill style below. */}
                    {!roomDisabledTools.has('bank') && (
                      <button type="button" onClick={() => openPokerPanel('bank')} title={TOOLS_TOOLTIPS.bank} className="block w-full px-3 py-2 text-left text-xs font-bold text-teal-200 hover:bg-zinc-800">
                        ★ Bank Account
                      </button>
                    )}
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
                          {/* ── ★ Auto-fill (random app bots) ──
                              Pulls from the 5-bot Gambler squad (the
                              shared "🎲 App bots" set) and seats a
                              random subset. Server-side shuffle so
                              every fill produces a different lineup. */}
                          {(!isSpectator || isArena) && !roomDisabledTools.has('bots') && (
                            <div className="px-3 py-1">
                              <ConfirmPopoverButton
                                {...toolProps({
                                  label: `★ Auto-Fill ${openSlots} Empty Seat${openSlots === 1 ? '' : 's'}`,
                                  fullLabel: '★ Auto-Fill · Full',
                                  color: 'text-amber-200',
                                  description: `Seats ${openSlots} random bot${openSlots === 1 ? '' : 's'} from the 🎲 App bots squad (Splashy, Chaser, Maniac, Sticky, Hunter — loose, gamble-happy, draw-chasing). They'll each start with the same chip stack as you (1000 minimum). Different shuffle every time you click.`,
                                  confirmLabel: `Seat ${openSlots} bot${openSlots === 1 ? '' : 's'}`,
                                  kickAndAction: 'seat random app bots',
                                  action: () => send('poker_auto_fill_bots')
                                })}
                              />
                            </div>
                          )}
                          {/* ── ★ NN Squad (tiers 1-5) ── */}
                          {(!isSpectator || isArena) && authUser && !roomDisabledTools.has('bots') && (
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
                          {(!isSpectator || isArena) && authUser && !roomDisabledTools.has('bots') && (
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
                          {(!isSpectator || isArena) && authUser && !roomDisabledTools.has('bots') && (
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
                          {/* ── ★ Oracle (single per-user omniscient bot) ──
                              One-click seat for the user's Oracle bot.
                              Reads it out of botRoster.mine and dispatches
                              the same `add_bot` message the picker uses.
                              Hidden when the user doesn't have one yet
                              (they need to load /poker/bots once to
                              provision it server-side) or when it's
                              already at the table. */}
                          {(!isSpectator || isArena) && authUser && !roomDisabledTools.has('bots') && (() => {
                            const oracle = botRoster.mine.find(b => b.isOracle)
                            if (!oracle) return null
                            const alreadyAtTable = (gameState?.players || []).some(p => p?.botId === oracle.id)
                            if (alreadyAtTable) return null
                            return (
                              <div className="px-3 py-1">
                                <ConfirmPopoverButton
                                  {...toolProps({
                                    label: `★ Seat my Oracle`,
                                    fullLabel: '★ Oracle · Full',
                                    color: 'text-fuchsia-200',
                                    description: 'Seats your Oracle bot — the omniscient slot that sees every opponent\'s hole cards and plays exact equity. One click. The Oracle plays smart sizing (not auto-shove) and has the full trash-talk library.',
                                    confirmLabel: 'Seat the Oracle',
                                    kickAndAction: 'seat the Oracle',
                                    action: () => send('add_bot', { botId: oracle.id })
                                  })}
                                />
                              </div>
                            )
                          })()}
                        </>
                      )
                    })()}
                    {(!isSpectator || isArena) && !roomDisabledTools.has('bots') && (
                      <button type="button" onClick={() => openPokerPanel('bots')} title={TOOLS_TOOLTIPS.bots} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                        Add Bots
                      </button>
                    )}
                    {(!isSpectator || isArena) && (
                      <button type="button" onClick={() => openPokerPanel('blinds')} title={TOOLS_TOOLTIPS.blinds} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                        Change Blinds
                      </button>
                    )}
                    {(!isSpectator || isArena) && (
                      <button type="button" onClick={() => openPokerPanel('contest')} title={TOOLS_TOOLTIPS.contest} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                        Contest Mode {contestMode?.enabled ? '· On' : ''}
                      </button>
                    )}
                    {isArena && (
                      <button type="button" onClick={() => openPokerPanel('arena')} title={TOOLS_TOOLTIPS.arena} className={`block w-full px-3 py-2 text-left text-xs font-bold hover:bg-zinc-800 ${arenaRunning ? 'text-emerald-200' : 'text-amber-200'}`}>
                        Arena · {arenaRunning ? 'Running' : 'Paused'}
                      </button>
                    )}

                    {/* ── PROFILE ─────────────────────────────────── */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Profile</div>
                    <button type="button" onClick={() => openPokerPanel('skin')} title={TOOLS_TOOLTIPS.skin} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Player Skin
                    </button>
                    <button type="button" onClick={() => openPokerPanel('profile')} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Edit Profile
                    </button>

                    {/* ── RESET / BIG YAHU ─────────────────────────── */}
                    {/* Headerless pinned-bottom group. Kept separated by
                        a border-t so it doesn't blur into the Profile
                        section above; matches the prior placement.
                        Both buttons can be disabled per-room by the
                        host — if both are off, the leading border-t
                        also disappears so nothing visible stays from
                        the group. */}
                    {!isSpectator && !roomDisabledTools.has('reset') && (
                      <button type="button" onClick={() => openPokerPanel('reset')} className="block w-full border-t border-zinc-800 px-3 py-2 text-left text-xs font-bold text-red-200 hover:bg-zinc-800">
                        Reset Money
                      </button>
                    )}
                    {!isSpectator && !roomDisabledTools.has('big_yahu') && (
                      // Big Yahu in Israel blue — the unlock awards Israel-themed
                      // emotes (✡️ / 🇮🇱), so the call action wears the colors.
                      // The leading border-t lives on the Reset button above;
                      // if Reset is disabled and Big Yahu isn't, we render
                      // the border on this button instead so the group still
                      // visually separates from Profile.
                      <button type="button" onClick={() => openPokerPanel('big_yahu')} className={`block w-full px-3 py-2 text-left text-xs font-bold text-sky-300 hover:bg-zinc-800 ${roomDisabledTools.has('reset') ? 'border-t border-zinc-800' : ''}`}>
                        Call Big Yahu
                      </button>
                    )}

                    {/* ── BASIC INFO ──────────────────────────────── */}
                    {/* Pinned to the very bottom of the right column, after
                        Big Yahu. Reference panels — kept neutral white
                        because they're always-available info, not actions
                        or markets. "How to Play" lives under Guide now
                        (under Daily Challenge) so the onboarding ramp
                        reads top-down. */}
                    <div className="mt-1 border-t border-zinc-800 px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Basic Info</div>
                    <button type="button" onClick={() => openPokerPanel('hand')} title={TOOLS_TOOLTIPS.hand} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Current Hand
                    </button>
                    <button type="button" onClick={() => openPokerPanel('session')} title={TOOLS_TOOLTIPS.session} className="block w-full px-3 py-2 text-left text-xs font-bold text-white hover:bg-zinc-800">
                      Session History
                    </button>
                  </div>
                </div>
              </>
              )
              // Anchored mode: the original absolute-positioned dropdown
              // hanging under the Tools button. Freeform mode: a
              // FloatingWindow at body level, draggable + resizable +
              // remembered. The user toggles between them with the
              // ↗/↺ button in the menu header.
              if (toolsFreeform) {
                return (
                  <FloatingWindow
                    open={tableMenuOpen}
                    onClose={() => setTableMenuOpen(false)}
                    onBack={() => setToolsFreeformPersist(false)}
                    backLabel="Anchor"
                    title="Tools"
                    icon="✦"
                    accent="zinc"
                    storageKey="pokerxyz:toolsmenu"
                    defaultWidth={448}
                    defaultHeight={Math.min(720, typeof window !== 'undefined' ? window.innerHeight - 60 : 720)}
                    minWidth={280}
                    minHeight={240}
                  >
                    {menuBody}
                  </FloatingWindow>
                )
              }
              // Anchored mode: portal to <body> with a fixed position
              // derived from the Tools button's screen rect. Without
              // the portal, the menu's z-index is trapped inside the
              // nav cluster's stacking context, so root-level peers
              // like the equity widget paint over it. data-tools-menu
              // tags the portaled node so the close-on-outside-click
              // handler still treats clicks inside as "inside Tools".
              if (!toolsMenuAnchorRect || typeof document === 'undefined') return null
              return createPortal(
                <div
                  data-tools-menu="1"
                  onPointerDown={() => setToolsMenuZ(bumpRaisedZ())}
                  className="fixed w-56 md:w-[28rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-lg border border-zinc-600/60 bg-zinc-900/98 shadow-2xl backdrop-blur-md"
                  style={{ top: toolsMenuAnchorRect.bottom + 8, right: toolsMenuAnchorRect.right, zIndex: toolsMenuZ }}
                >
                  {menuBody}
                </div>,
                document.body
              )
            })()}
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
            // h-9 matches the sibling Tools button (also h-9) AND the
            // global AccountDock's Sign-in chip / profile avatar. Drop
            // h-9 and `py-1.5` makes this chip ~30px tall, which leaves
            // it visibly shorter than Tools and the dock — the top
            // chrome stair-steps. h-9 keeps every chip on the same
            // baseline.
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-black shadow-sm transition-colors active:scale-95 sm:px-3 sm:text-sm ${
              leaveTableArmed
                ? 'border-red-400/70 bg-red-700/90 hover:bg-red-600 text-white'
                : 'border-zinc-500/50 bg-zinc-800/80 hover:bg-zinc-700/90 text-white'
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
            <span className="hidden sm:inline">{leaveTableArmed ? 'Confirm leave' : 'Lobby'}</span>
          </button>
          </div>
        </RouteNavCluster>
      </div>

      {/* Persistent finance widget. Wrapped in a centered max-w-7xl band so
          on wide screens the widget aligns to the SAME left edge as the
          Arena / Spectating badges and PhaseLabel in the header row, instead
          of sticking to the viewport edge. pointer-events-none on the wrap
          lets table clicks pass through; the widget itself re-enables them. */}
      {activePokerPanel && (
        // The Add Bots and Bot Arena panels are picker-heavy and look
        // cramped in the standard 460px max. They get a wider max
        // (640px) so the pill picker can breathe without forcing
        // every other tool to widen. Items & Powers also gets the
        // wider max so the 2-column power grid + per-item targets
        // pickers have room to read at a glance.
        <div
          ref={pokerPanelRef}
          // Base z is z-[600] — above the popup-window range (260+)
          // and the top chrome (z-[500]). Panels in the elevated
          // categories (Actions / Profile / Basic Info / Guide /
          // Daily Challenge / Bank — see ELEVATED_PANEL_IDS) jump to
          // z-[10000], far above the dynamic click-raise band the
          // docked Tools menu and floating windows now share (900+).
          // The high static value is safe — that band would need
          // thousands of pointerdowns in one session to reach it.
          className={`fixed right-3 top-16 ${ELEVATED_PANEL_IDS.has(activePokerPanel) ? 'z-[10000]' : 'z-[600]'} max-h-[calc(100dvh-5rem)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-zinc-600/60 bg-zinc-900/95 p-3 text-white shadow-2xl backdrop-blur-md sm:right-4 sm:top-20 ${
            activePokerPanel === 'bots' || activePokerPanel === 'arena' || activePokerPanel === 'items'
              ? 'max-w-[640px]'
              : 'max-w-[460px]'
          }`}
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-black truncate">
              {activePokerPanel === 'help' ? 'How to Play'
                : activePokerPanel === 'shortcuts' ? 'Window Shortcuts'
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
                : activePokerPanel === 'items' ? 'Items & Powers'
                : activePokerPanel === 'assets' ? 'Real Estate'
                : activePokerPanel === 'jobs' ? 'Jobs Board'
                : activePokerPanel === 'stocks' ? 'Stock Market'
                : activePokerPanel === 'world' ? 'World Map'
                : activePokerPanel === 'influence' ? 'Influence Ops'
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

          {activePokerPanel === 'shortcuts' && (() => {
            // One row per shortcut. Each shows the Mac chord first
            // (⌃ glyph — the macOS Control key, NOT Command — Cmd is
            // off the table because the OS reserves it) then the
            // Windows/Linux equivalent. Both fire the same handler:
            // the keydown listener only checks `ctrlKey`, which the
            // browser sets for the Control key on every platform.
            const ShortcutRow = ({ macKey, winKey, desc }) => (
              <div className="flex items-baseline gap-2">
                <div className="flex shrink-0 items-center gap-1">
                  <kbd className="inline-flex items-center justify-center gap-0.5 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-black text-zinc-200">{macKey}</kbd>
                  <span className="text-[9px] font-bold text-zinc-500">/</span>
                  <kbd className="inline-flex items-center justify-center gap-0.5 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-black text-zinc-200">{winKey}</kbd>
                </div>
                <span>{desc}</span>
              </div>
            )
            return (
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="text-xs font-black text-zinc-300">Floating Windows</div>
                  <div className="text-[9px] font-bold text-zinc-500">
                    macOS / Windows · Linux
                  </div>
                </div>
                <div className="space-y-2 text-xs font-bold text-zinc-400">
                  <div className="flex items-baseline gap-2">
                    <kbd className="inline-flex min-w-[2rem] justify-center rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-black text-zinc-200">Tab</kbd>
                    <span>Cycle through your open popups — brings the bottom-most window forward.</span>
                  </div>
                  <ShortcutRow macKey="⌃ X" winKey="Ctrl X" desc="Close the currently focused popup." />
                  <ShortcutRow macKey="⌃ A" winKey="Ctrl A" desc="Jump back to the previously focused popup (toggle between two)." />
                  <ShortcutRow macKey="⌃ ←" winKey="Ctrl ←" desc="Previous popup in the order they were opened." />
                  <ShortcutRow macKey="⌃ →" winKey="Ctrl →" desc="Next popup in the order they were opened." />
                  <ShortcutRow macKey="⌃ H" winKey="Ctrl H" desc="Hide every popup off-screen. Press again to bring them all back — exact spots and state preserved." />
                </div>
                <div className="mt-3 text-[10px] font-bold text-zinc-500">
                  On macOS use the <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] font-black text-zinc-200">control</kbd> key (⌃), not <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 text-[9px] font-black text-zinc-200">⌘</kbd> — the system reserves Cmd+H to hide the whole app, so it never reaches the browser. Shortcuts also ignore typing — they only fire when no input is focused.
                </div>
              </div>
              <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3">
                <div className="mb-2 text-xs font-black text-zinc-300">Window Chrome</div>
                <div className="space-y-1.5 text-xs font-bold text-zinc-400">
                  <div><span className="text-white">←</span> Back arrow: returns the window to its dock (where applicable) or jumps you back to the Tools menu.</div>
                  <div><span className="text-white">−&nbsp;%&nbsp;+</span> Zoom: scales the window's content. Chrome stays the same size.</div>
                  <div><span className="text-white">×</span> Close: dismisses the popup. Reopen it from Tools.</div>
                  <div>Drag the title bar to move; grab the bottom-right or top-left corner to resize. Position and size reset to defaults whenever you join a new game; zoom carries across sessions.</div>
                </div>
              </div>
            </div>
            )
          })()}

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
                  <div>Pot <span className="text-white">{(gameState?.pot || 0).toLocaleString()}</span></div>
                  <div>To call <span className="text-white">{Math.max(0, toCall).toLocaleString()}</span></div>
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
            // Pull gambler "app bots" into their own top-level section
            // — they're public but app-owned (synthetic system user),
            // not user-authored, so they shouldn't blend into either
            // "Your bots" or the user-made "Public roster".
            const appBots = publicOnly.filter(b => b.isGambler)
            const publicUserMade = publicOnly.filter(b => !b.isGambler)
            const mineGroups = subgroupsFromBuckets(bucketByCategory(botRoster.mine))
            const publicGroups = subgroupsFromBuckets(bucketByCategory(publicUserMade))
            const selectedCount = addBotSelection.size
            // Seated bots — live snapshot from the game state. Lets users
            // see (and kick) bots currently at the table without
            // bouncing to the arena panel. Same pattern as the arena
            // lineup display.
            const seatedBots = (gameState?.players || []).filter(p => p && p.isBot)
            // Capacity awareness: the table holds 5 seats (server's
            // POKER_CONFIG.MAX_PLAYERS — hardcoded here because the
            // client never receives that value as part of game state,
            // and the bots panel already hardcodes "/5" below).
            const TABLE_SEATS = 5
            const seatsTaken = (gameState?.players || []).length
            const seatsOpen = Math.max(0, TABLE_SEATS - seatsTaken)
            const tableFull = seatsOpen === 0
            const wantsMoreThanFits = selectedCount > seatsOpen

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

                {/* Bot decision speed — any human at the table can drag
                    this, the server broadcasts to everyone (same WS
                    path the arena slider uses). Range matches the dock
                    widget: 200ms (fast) → 2000ms (deliberate). Default
                    is the room's current value pulled from gameState. */}
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Bot speed</span>
                    <span className="tabular-nums text-[11px] font-black text-amber-200">{arenaThinkDelayMs}ms / turn</span>
                  </div>
                  <input
                    type="range"
                    min={200}
                    max={2000}
                    step={100}
                    value={arenaThinkDelayMs}
                    onChange={(e) => handleArenaSpeedChange(parseInt(e.target.value, 10))}
                    className="mt-2 h-1 w-full rounded-full bg-zinc-900 accent-amber-400"
                    aria-label="Bot think delay"
                  />
                  <div className="mt-1 flex justify-between text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    <span>Fast</span><span>Slow</span>
                  </div>
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
                          <BotAvatar name={b.username} color={b.botColor} textColor={b.botTextColor} avatarUrl={b.botAvatarUrl} size={18} />
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

                {/* Sticky action bar — count + Add + Clear + capacity. */}
                <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-1 flex items-center justify-between gap-2 border-b border-zinc-700/70 bg-zinc-900/95 px-3 py-2 backdrop-blur">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black text-zinc-200">
                      {selectedCount === 0
                        ? 'Nothing selected'
                        : `${selectedCount} bot${selectedCount === 1 ? '' : 's'} selected`}
                    </div>
                    {/* Inline capacity hint — surfaces the real reason the
                        Add button is dead, before the user clicks and
                        wonders why nothing happened. */}
                    {tableFull ? (
                      <div className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
                        Table is full ({seatsTaken}/{TABLE_SEATS}) — kick a seat first
                      </div>
                    ) : wantsMoreThanFits ? (
                      <div className="mt-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
                        Only {seatsOpen} seat{seatsOpen === 1 ? '' : 's'} open — extras won't seat
                      </div>
                    ) : null}
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
                      disabled={selectedCount === 0 || tableFull}
                      title={tableFull ? `Table is full (${seatsTaken}/${TABLE_SEATS})` : undefined}
                      className="rounded-md border border-emerald-500/50 bg-emerald-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {tableFull ? 'Full' : `Add ${selectedCount > 0 ? selectedCount : ''}`}
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

                {/* ── App bots ── Globally-shared "🎲 Gambler" squad
                    seeded at server boot. Same pill rendering as your
                    bots / public roster but pinned in its own card
                    above Public roster so it reads as a built-in
                    feature, not a regular user's submissions. */}
                {appBots.length > 0 && (
                  <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-950/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-widest text-rose-200">🎲 App bots</div>
                      <span className="text-[9px] font-black uppercase tracking-widest text-rose-300/70">
                        Built-in — usable by everyone
                      </span>
                    </div>
                    <PillStrip
                      label="Gambler"
                      accent="text-rose-200"
                      bots={appBots}
                    />
                  </div>
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
            const bankBalance = bankState.bankBalance ?? 0
            const overdrawn = bankBalance < 0
            const nextTier = nextUnlockTier(peakSwing)
            const handsAt = bankState.handsAtSession ?? 0
            return (
              <div className="space-y-3">
                {/* Top "wallet" card — bank cash sitting idle. This is
                    money not in any asset; it's what pays off loans,
                    funds investments, and rebuys chips when busted.
                    Goes red on overdraft with a tip to take a bank
                    loan from the section below. */}
                <div className={`rounded-lg border p-3 ${overdrawn ? 'border-red-500/50 bg-red-950/25' : 'border-sky-700/40 bg-sky-950/20'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-sky-200">Money on hand</span>
                    {/* Regular-sized amount, color-coded: emerald if
                        positive, red if negative, zinc if zero — same
                        signal the rest of the app's P/L badges use. */}
                    <span className={`text-sm font-black tabular-nums ${bankBalance > 0 ? 'text-emerald-300' : bankBalance < 0 ? 'text-red-300' : 'text-zinc-300'}`}>
                      ${bankBalance.toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] font-bold text-zinc-400 leading-snug">
                    Cash not in any asset. Funds investments, loan payoffs, and auto-rebuys when your poker stack hits zero.
                  </div>
                  {overdrawn && (
                    <div className="mt-2 rounded-md border border-red-500/50 bg-red-950/40 px-2 py-1.5 text-[11px] font-black text-red-100">
                      Overdrawn by <span className="text-red-200 tabular-nums">${Math.abs(bankBalance).toLocaleString()}</span>.
                      Take a bank loan below to dig out, or sell some assets to top up.
                    </div>
                  )}
                </div>

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
                  {/* Label classes use `whitespace-nowrap` + tighter
                      tracking + a smaller font so "INTEREST PAID" — the
                      widest label of the four — sits on one line in
                      every tile. Previously it wrapped onto a second
                      line which shoved its $0 value down half a row
                      and visually broke alignment with the other
                      three tiles. */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-400 whitespace-nowrap">Borrowed</div>
                      <div className="text-sm font-black text-white">${(bankState.lifetimeBorrowed ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-400 whitespace-nowrap">Interest paid</div>
                      <div className="text-sm font-black text-amber-300">${(bankState.lifetimeInterestPaid ?? 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-400 whitespace-nowrap">Credit low</div>
                      <div className={`text-sm font-black ${creditScoreColorClass(bankState.creditScoreMin ?? score)}`}>{bankState.creditScoreMin ?? score}</div>
                    </div>
                    <div className="rounded-md border border-zinc-700/70 bg-zinc-900/80 px-2 py-1.5 text-center">
                      <div className="text-[8px] font-black uppercase tracking-wider text-zinc-400 whitespace-nowrap">Credit high</div>
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
                {/* Scroll wrap — the list now goes up to absurd-blind
                    tiers (last entry is 500M/1B) so cap height and let
                    users scroll instead of pushing the rest of the
                    tools panel offscreen. overscroll-contain so flicks
                    don't bubble into the page scroll. */}
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
                          <BotAvatar name={b.username} color={b.botColor} textColor={b.botTextColor} avatarUrl={b.botAvatarUrl} size={18} />
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
                    // Same app-bot split as the Add Bots picker: gambler
                    // bots show in their own card above Public roster.
                    const appBots = publicOnly.filter(b => b.isGambler)
                    const publicUserMade = publicOnly.filter(b => !b.isGambler)
                    const mineGroups = subgroupsFromBuckets(bucketByCategory(botRoster.mine))
                    const publicGroups = subgroupsFromBuckets(bucketByCategory(publicUserMade))
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

                        {appBots.length > 0 && (
                          <div className="space-y-2 rounded-md border border-rose-500/40 bg-rose-950/20 p-2">
                            <div className="text-[10px] font-black uppercase tracking-widest text-rose-200">🎲 App bots</div>
                            <PillStrip label="Gambler" accent="text-rose-200" bots={appBots} />
                          </div>
                        )}

                        <div className="space-y-2 rounded-md border border-zinc-700/70 bg-zinc-950/30 p-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Public roster</div>
                          {!botRoster.loading && publicUserMade.length === 0 && (
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
                          title={`$${level.small.toLocaleString()} / $${level.big.toLocaleString()}`}
                          className={`rounded-md border px-2 py-1.5 text-[11px] font-black transition-colors ${
                            isCurrent
                              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 cursor-default'
                              : 'border-zinc-600/60 bg-zinc-900 text-white hover:bg-zinc-800'
                          }`}
                        >
                          ${formatChipsCompact(level.small)}/${formatChipsCompact(level.big)}
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
                          ? <> Next: <span className="text-amber-300">${cm.nextLevel.small.toLocaleString()}/${cm.nextLevel.big.toLocaleString()}</span> in <span className="text-amber-300">{cm.handsUntilNextLevel ?? '?'}</span> hand{cm.handsUntilNextLevel === 1 ? '' : 's'}.</>
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
                            title={`$${level.small.toLocaleString()} / $${level.big.toLocaleString()}`}
                            className="rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1.5 text-[11px] font-black text-white hover:bg-zinc-800"
                          >
                            ${formatChipsCompact(level.small)}/${formatChipsCompact(level.big)}
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
                    {/* List grew past 12 with the absurd-blind tiers
                        (500M/1B at the bottom). Cap height + scroll keeps
                        the big-stakes entries reachable without pushing
                        other tools-panel controls offscreen. Single-col
                        layout, so toLocaleString fits even at $1B. */}
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
                // Push the change to the room so every OTHER seat
                // re-renders. The REST endpoint above only persists to
                // DB; without this push the live Player object on the
                // server keeps the old skin and other seats never see
                // the update until the user reconnects.
                send('player:skin_update', { skinId, customSkin })
              }}
            />
          )}

          {/* Market panels (crypto / items / assets / jobs / stocks /
              world) used to render here as embedded panels under the
              Tools dropdown. They've moved to floating widgets — see
              the FloatingWindow block at the bottom of this file. The
              embedded path is gone because openPokerPanel routes those
              ids into `widgetPanels` now, not `activePokerPanel`. */}

          {/* Standalone Influence Ops panel removed — ops now live as
              tabs inside the markets they affect (stocks, world, real
              estate). Players were ignoring the standalone surface;
              putting ops where their effects land makes them
              discoverable. */}

        </div>
      )}

      {pendingBlindsProposal && !isSpectator && (() => {
        const prop = pendingBlindsProposal
        const iAmProposer = prop.proposerId === playerId
        const approvedBy = Array.isArray(prop.approvedBy) ? prop.approvedBy : []
        const rejectedBy = Array.isArray(prop.rejectedBy) ? prop.rejectedBy : []
        // Map IDs → seat usernames so the breakdown is human-readable.
        // Pending = seated humans who haven't voted yet (and aren't bots).
        // We need a seat list that includes humans only; gameState.players
        // is the live one (game_state broadcast). The room_update broadcast
        // also exposes humans via `players` but the proposer's own client
        // already has gameState in scope here.
        const seatedHumans = (gameState?.players || []).filter(p => p && !p.isBot)
        const nameFor = (id) => {
          const seat = seatedHumans.find(p => p?.id === id)
          return seat?.username || 'Player'
        }
        const votedSet = new Set([...approvedBy, ...rejectedBy])
        const pendingVoters = seatedHumans.filter(p => !votedSet.has(p.id))
        return (
          <div className="fixed left-1/2 top-16 z-[110] w-[calc(100vw-1.5rem)] max-w-[460px] -translate-x-1/2 rounded-xl border border-amber-400/60 bg-zinc-900/98 p-3 text-white shadow-2xl backdrop-blur-md">
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-amber-200">
              {iAmProposer ? 'Your blinds request — out for a vote' : 'Blinds change requested'}
            </div>
            <div className="text-sm font-black text-white mb-1">
              {iAmProposer
                ? <>You asked to set blinds to ${prop.small}/${prop.big}.</>
                : <>{prop.proposerName} wants to set blinds to ${prop.small}/${prop.big}.</>}
            </div>
            <div className="text-[10px] font-bold text-zinc-300 mb-2">
              Approvals: {prop.approvalsCount}/{prop.approvalsNeeded} of {prop.humanCount} humans.
            </div>

            {/* Per-player breakdown — three lanes (Yes / No / Pending).
                Helps the proposer see at a glance who's holding things
                up. Each name renders as a tiny chip so the list scans
                fast on a busy table. */}
            {(approvedBy.length + rejectedBy.length + pendingVoters.length) > 0 && (
              <div className="mb-3 space-y-1">
                {approvedBy.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                    <span className="text-emerald-300">✓ {approvedBy.length}</span>
                    {approvedBy.map(id => (
                      <span key={id} className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-black text-emerald-100">
                        {nameFor(id)}
                      </span>
                    ))}
                  </div>
                )}
                {rejectedBy.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                    <span className="text-red-300">✗ {rejectedBy.length}</span>
                    {rejectedBy.map(id => (
                      <span key={id} className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-black text-red-100">
                        {nameFor(id)}
                      </span>
                    ))}
                  </div>
                )}
                {pendingVoters.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                    <span className="text-zinc-400">… {pendingVoters.length}</span>
                    {pendingVoters.map(p => (
                      <span key={p.id} className="rounded border border-zinc-600/60 bg-zinc-800 px-1.5 py-0.5 text-[9px] font-black text-zinc-300">
                        {p.username || 'Player'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {iAmProposer ? (
              <div className="text-[10px] font-bold text-zinc-400 leading-snug">
                Waiting on the other players. You'll get a system message when the vote settles (applied / rejected / expired).
              </div>
            ) : (
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
            )}
          </div>
        )
      })()}

      {/* Main Table Wrapper. Mobile anchors the table near the top
          (justify-start) so the seat cards — which protrude BELOW the
          felt — clear the bottom-pinned action panel. justify-center
          looked balanced on its own but stacked the seat cards into the
          fold/check buttons. md+ keeps the centered layout because the
          desktop sidebets/chat sit in a side column, not below. */}
      <div className="flex-1 flex flex-col justify-start md:justify-center relative w-full mb-4">

        {/* Bot speed lives in a robot-icon button on the right side
            of the screen (BotSpeedDock, rendered near the bottom of
            this page) — only when there are bots at the table.
            Felt color + poker budget moved into the self-click profile
            popover so each user owns their own cosmetics privately. */}

        {/* The table is free-floating: no `mb-` ties it to the controls
            below. Mobile uses justify-start on the parent (above) so the
            felt sits at the top of the flex-1 column, and the bottom-UI
            sibling has its own pb-* offset from the viewport bottom —
            the gap between them is whatever flex-1 space remains, which
            grows naturally when the user zooms out (smaller felt → more
            room for the bottom seat's protruding cards to clear the
            action panel).
            Mobile aspect is capped at 1.4/1 (wider than tall) so the
            felt height never bullies the available column on phones in
            the 400-640px range — at the previous 1.1/1 the felt's
            natural height equalled the entire flex-1 space, leaving the
            bottom seat's cards to overflow into the controls below. md+
            keeps the original wide-oval ratios since the desktop layout
            puts sidebets/chat in a side column instead of below. */}
        <div className="relative w-full max-w-5xl mx-auto aspect-[1.4/1] sm:aspect-[1.8/1] md:aspect-[2.2/1] rounded-[50%] border-4 shrink-0 mt-2 sm:mt-6 md:mb-16"
             style={{
               borderColor: tablePalette.border,
               background: `radial-gradient(ellipse 70% 60% at 50% 45%, ${tablePalette.center} 0%, ${tablePalette.mid} 45%, ${tablePalette.edge} 80%, ${tablePalette.vignette} 100%)`,
               boxShadow: 'inset 0 2px 50px rgba(0,0,0,0.5), 0 0 100px rgba(0,0,0,0.4)',
             }}>

          {/* Pot */}
          <div className="absolute top-[12%] sm:top-[10%] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-0 max-w-[40vw] sm:max-w-none">
            <PotChips amount={gameState?.pot || 0} />
            <div className="text-[10px] sm:text-xs text-white/60 font-bold tracking-widest bg-black/30 px-2 py-0.5 rounded-md mt-1">POT</div>
            {/* Pot number — keep exact at sane stakes, compact (5B / 1.5B)
                only past the M/B threshold where the comma-formatted
                string would overflow the [40vw] cap on mobile. */}
            <div className="font-black text-xl sm:text-3xl text-white drop-shadow-md tabular-nums">
              {(gameState?.pot || 0) >= 1_000_000 ? formatChipsCompact(gameState?.pot || 0) : (gameState?.pot || 0).toLocaleString()}
            </div>
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

            // Bottom-center seat (seatIndex === 0) used to bias mt-8 at every
            // viewport below lg. Combined with the seat cards rendering BELOW
            // the nameplate, that pushed the cards 32px deeper INTO the action
            // panel on every mobile width (worst at the in-between 400-640px
            // range where the table is taller in proportion to its width).
            // Drop the bias on mobile/sm; keep the original mt-8 only in the
            // md range where the desktop-ish layout actually benefited from
            // the extra spacing.
            return (
              <div key={player.id} className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center min-w-[120px] sm:min-w-[140px] ${seatIndex === 0 ? 'md:mt-8 lg:mt-0' : ''}`} style={{ top: pos.top, left: pos.left }}>
                
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
                      to open the profile popover. 2026-05: extended to
                      "you" too — clicking your own seat now opens the
                      same popover with a self-quick-settings panel
                      (name, avatar, felt color, poker budget, skin,
                      finances). Bots still aren't clickable here; they
                      have their own BotProfilePopover wired separately. */}
                  <div
                    data-seat-id={player.id}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPopoverSeatId(player.id)
                      setPopoverSeat(player)
                    }}
                    onKeyDown={(e) => {
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
                    ${disconnectedPlayerIds.has(player.id) ? 'opacity-70' : ''}
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
                      {/* Tiny pulsing dot for disconnected-in-grace
                          players. Stays out of the username row's
                          length budget — the meta row below carries the
                          "Reconnecting…" word, same way "Waiting..."
                          works. Title prop gives the long form on
                          hover for desktop. */}
                      {disconnectedPlayerIds.has(player.id) && (
                        <span
                          title="Reconnecting — seat held"
                          aria-label="Reconnecting"
                          className="shrink-0 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"
                        />
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
                      {disconnectedPlayerIds.has(player.id) ? (
                        // Same italic pattern as the "Waiting..." span
                        // below — but in amber so it reads as transient
                        // ("they'll be right back") rather than permanent
                        // ("they're idle"). Pulsing dot in the username
                        // row carries the same signal in compact form.
                        <span className="text-amber-300 font-bold italic">Reconnecting…</span>
                      ) : isPlayerWaiting ? (
                        <span className="text-zinc-400 font-bold italic">Waiting...</span>
                      ) : phase === 'showdown' && handName && !player.folded ? (
                        <span className="block max-w-full truncate text-amber-300 font-bold">{handName}</span>
                      ) : (
                        // Compact at absurd-blind tiers — $5B/seat would
                        // overflow the 120/140px nameplate width and force
                        // truncation. formatChipsCompact returns "5B"
                        // there, full toLocaleString below 10K.
                        `${formatChipsCompact(player.chips)} chips`
                      )}
                    </div>
                    {/* Bot Remove button removed from the table nameplate — bots
                        can only be removed via the Add Bot panel (regular tables)
                        or the Arena tools panel (arenas). Keeps the table chrome
                        clean and the remove flow centralized. */}
                    <div className={`mt-0.5 text-[8px] sm:text-[10px] font-black leading-none ${profitClass(playerProfit)}`}>
                      P/L {formatProfit(playerProfit)}
                    </div>
                    {statsMode && !roomDisabledTools.has('equity') && playerAllInOdds && (
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

      {/* SpectatorPanel used to render here as a standalone fixed-
          positioned overlay. It now renders INSIDE the bottom-UI flex
          wrapper below (search for "Spectator panel — in-flow"), so it
          participates in the same layout system as the regular table's
          action panel and sidebets/chat docks. This unifies the
          spectator/arena UI with the regular-play UI: vertical stack
          on mobile, side-by-side on md+, no fixed-positioning math. */}

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
        // 2026-05: re-derive the seat from live gameState every render
        // (keyed by stable popoverSeatId) instead of the frozen
        // click-time snapshot. Otherwise a job-claim / stock-buy /
        // bank-loan that lands AFTER the popover was opened would
        // update bankState but the popover's seat snapshot would stay
        // stale ("$0 bank" even after a 26k payout). Falls back to
        // the snapshot if the seat has just been removed.
        seat={(() => {
          const id = popoverSeatId
          if (!id) return popoverSeat
          return (
            gameState?.players?.find(p => p.id === id) ||
            gameState?.spectators?.find(p => p.id === id) ||
            popoverSeat
          )
        })()}
        anchorSeatId={popoverSeatId}
        onClose={() => { setPopoverSeat(null); setPopoverSeatId(null) }}
        // Peer-loan wiring — viewer's id + chips, every open negotiation,
        // and viewer's own peerLoans (pulled off their seat). The popover
        // hands these to PeerLoanPanel which filters by counterparty.
        myId={playerId}
        myChips={myPlayer?.chips ?? bankState.chips ?? 0}
        // Loan eligibility compares BANK balance, not chips. Pass the
        // live bank balance so PeerLoanPanel decides offer-vs-request
        // direction against the off-table wallet.
        myBankBalance={bankState.bankBalance ?? 0}
        myPeerLoans={(myPlayer?.peerLoans) || []}
        negotiations={peerNegotiations}
        onPeerLoanSend={(type, data) => send(type, data)}
        viewerIsSpectator={isSpectator}
        // Kick-vote: only seated humans can vote, and only against other
        // seated humans. Disabled when the table has <3 humans (heads-up
        // is uninteresting to kick from). Threshold scales with table.
        kickState={kickState}
        onKickVote={(targetId) => send('poker_kick_vote', { targetId })}
        onNudge={(targetId) => send('player:nudge', { targetId })}
        onSessionDm={(targetId, message) => send('player:session_dm', { targetId, message })}
        // Self-popover commit handler. Server is the source of truth
        // for budget state — it does the chips ↔ reserves split and
        // broadcasts the new seat numbers. Budget does NOT persist
        // across sessions: every new game starts at the default
        // starting chips, and the user re-sets the cap if they want.
        onSelfBudgetCommit={(value) => {
          // value can be a number ≥100, or null to clear.
          send('player:set_budget', { amount: value })
        }}
        // Click on the avatar or name in the popover header → open
        // the in-Tools Edit Profile panel (the one with the username
        // input + ProfileSelector). Pre-seeds the draft fields from
        // current state so the panel opens with the live values, not
        // empty inputs.
        onSelfEditProfile={() => {
          setProfileDraftName(prev => prev || username || '')
          setProfileDraftAvatar(prev => prev || selectedAvatarId)
          setActivePokerPanel('profile')
        }}
        onMentionInChat={(username) => {
          // Insert "@name " into the chat input and force the chat
          // dock open. The user can then type the rest of their
          // message — we don't auto-send; their words are theirs.
          if (!username) return
          setChatInput(prev => {
            const safeName = String(username).replace(/[^A-Za-z0-9_-]/g, '')
            const at = `@${safeName} `
            // Avoid duplicate prefix if they already started typing @name.
            if (prev.toLowerCase().includes(`@${safeName.toLowerCase()}`)) return prev
            return prev ? `${prev.replace(/\s+$/, '')} ${at}` : at
          })
          // Focus the chat input via a deferred DOM lookup — the input
          // isn't bound to a ref in this file, so query by placeholder
          // attribute. Best-effort: try/catch swallows any UA quirks.
          setTimeout(() => {
            try {
              const el = typeof document !== 'undefined'
                ? document.querySelector('input[placeholder="Message..."]')
                : null
              el?.focus?.()
            } catch {}
          }, 30)
        }}
      />

      <BotProfilePopover
        open={!!popoverSeat && popoverSeat.isBot}
        seat={popoverSeat}
        anchorSeatId={popoverSeatId}
        onClose={() => { setPopoverSeat(null); setPopoverSeatId(null) }}
        viewerUserId={authUser?.id ?? null}
        // Kick eligibility mirrors the server's rule in
        // PokerRoom.removeBotForPlayer:
        //   • you added this bot → always allowed
        //   • adder is no longer seated → "abandoned bot," anyone present
        //     can kick it
        // Otherwise hide the button so the user doesn't try and get
        // a "only the adder can kick" error.
        canKick={(() => {
          if (!popoverSeat?.isBot) return false
          const adder = popoverSeat.addedByPlayerId
          if (adder && adder === playerId) return true
          // adder gone if not in the seated player list AND not in
          // the spectator list (best we can tell from the broadcast).
          const present = (gameState?.players || []).some(p => p && p.id === adder)
            || (gameState?.spectators || []).some(s => s && s.id === adder)
          if (!present && adder) return true
          // Adder unknown (legacy bot or pre-broadcast) → fall back to
          // anyone-can-kick so the bot isn't unkickable.
          if (!adder) return true
          return false
        })()}
        onKick={(botSeatId) => removeBotFromTable(botSeatId)}
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

      {/* Persistent investment HUD. Mini bottom-left widget showing
          every position across crypto / stocks / real-estate / world
          territories at a glance. One-tap rows open the matching
          panel. Collapsed by default; remembers state in localStorage. */}
      {/* InvestmentHUD now renders inside the chat/sidebets dock column
          (see the IIFE below) so it sits above them in a fixed-but-not-
          draggable slot on desktop, and joins the centered stack on
          mobile. No longer a separate floating widget. */}

      {/* Confirm-purchase modal. Asset / territory / (future) other buy
          buttons all route their click through `requestPurchase`. If
          the player can't afford the price they get a toast in the sys
          log and this modal never opens. Confirm = dispatch action. */}
      {pendingPurchase && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingPurchase(null)}>
          <div
            className="w-[calc(100vw-2rem)] max-w-[400px] rounded-xl border border-zinc-600/60 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-zinc-800 px-4 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-amber-300">Confirm purchase</div>
              <div className="text-base font-black text-white truncate">{pendingPurchase.title}</div>
            </div>
            <div className="px-4 py-3 text-[12px] font-bold text-zinc-300 leading-snug">
              {pendingPurchase.body}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-950/40 px-4 py-2.5">
              <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                Cost <span className="ml-1 text-white">${(pendingPurchase.cost || 0).toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPendingPurchase(null)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pendingPurchase.onConfirm?.()
                    setPendingPurchase(null)
                  }}
                  className="rounded-md border border-emerald-400/60 bg-emerald-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-100 hover:bg-emerald-500/25"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Peek-hand reveal — only the local user sees this. Shows the
          target's hole cards in a small modal. Tap anywhere to dismiss. */}
      {itemPeekResult && (
        <PeekRevealModal
          targetUsername={itemPeekResult.targetUsername}
          cards={itemPeekResult.cards}
          onClose={() => setItemPeekResult(null)}
        />
      )}

      {/* Floating mini-table window. Reads the same gameState that
          drives the main view; routes actions through the same `send`
          callbacks so a click here moves the real game. The window's
          outer wrapper carries data-pokerwin="1" so the Tools-menu
          outside-click handler treats clicks inside it as "still in
          the menu" — flipping between Tools and the mini view is
          seamless. */}
      {joined && (
        <PokerWindow
          open={pokerWindowOpen}
          onClose={() => setPokerWindowOpen(false)}
          // No back arrow — Mini Table is a permanent companion view
          // and doesn't need a ← Tools shortcut (Tools is already
          // reachable from its always-visible button in the nav).
          gameState={gameState}
          playerId={playerId}
          isSpectator={isSpectator}
          myPlayer={myPlayer}
          myHoleCards={myPlayer?.cards || []}
          canAct={canAct}
          toCall={toCall}
          minRaise={minRaise}
          hasRaiseRoom={hasRaiseRoom}
          raiseAmount={raiseAmount}
          setRaiseAmount={setRaiseAmount}
          safeRaise={safeRaise}
          onAction={(kind) => {
            if (kind === 'fold')   send('poker_fold')
            else if (kind === 'check')  send('poker_check')
            else if (kind === 'call')   send('poker_call')
            else if (kind === 'all_in') send('poker_all_in')
            else if (kind === 'raise')  send('poker_raise', { amount: safeRaise })
          }}
        />
      )}

      {/* Market widgets — each entry in `widgetPanels` opens here as
          its own draggable FloatingWindow at body level. Multiple can
          be open at once (you can play stocks AND crypto AND world
          simultaneously). Position + size persist per widget via the
          storageKey. State plumbing is the same as the legacy embedded
          panels — these consume the same props. */}
      {[...widgetPanels].map(id => {
        const meta = MARKET_WIDGET_META[id]
        if (!meta) return null
        const close = () => setWidgetPanelsPersist(prev => {
          const next = new Set(prev); next.delete(id); return next
        })
        const common = {
          open: true,
          onClose: close,
          title: meta.title,
          icon: meta.icon,
          accent: meta.accent,
          storageKey: `pokerxyz:widget:${id}`,
          defaultWidth: meta.defaultWidth,
          defaultHeight: meta.defaultHeight,
        }
        let body = null
        if (id === 'crypto') {
          body = (
            <CryptoMarketPanel
              crypto={cryptoState}
              myChips={bankState.bankBalance ?? 0}
              canTrade={joined}
              onBuy={cryptoBuy}
              onSell={cryptoSell}
              onCreate={cryptoCreate}
              onRug={cryptoRug}
            />
          )
        } else if (id === 'items') {
          body = (
            <ItemsPanel
              itemsState={itemsState}
              players={gameState?.players || []}
              myPlayerId={playerId}
              cryptoCoins={cryptoState?.coins || []}
              nextHandRigged={!!gameState?.nextHandRigged}
              activeEditor={itemsActiveEditor}
              setActiveEditor={setItemsActiveEditor}
              onUseItem={(itemId, targetId, extras) => {
                const payload = { itemId, targetId }
                if (Array.isArray(extras)) payload.picks = extras
                else if (extras && typeof extras === 'object') Object.assign(payload, extras)
                send('item:use', payload)
              }}
            />
          )
        } else if (id === 'assets') {
          body = (
            <AssetsPanel
              assetsState={assetsState}
              myChips={bankState.bankBalance ?? 0}
              joined={joined}
              onBuy={(assetId, units) => send('asset:buy', { assetId, units })}
              onSell={(assetId, units) => send('asset:sell', { assetId, units })}
              influenceState={!roomDisabledTools.has('influence') ? influenceState : null}
              onRunInfluence={(opId, targetSymbol) => send('influence:run', { opId, targetSymbol })}
            />
          )
        } else if (id === 'jobs') {
          body = (
            <JobsPanel
              jobsState={jobsState}
              joined={joined || isSpectator}
              onClaim={(claimId) => send('job:claim', { id: claimId })}
            />
          )
        } else if (id === 'stocks') {
          body = (
            <StocksPanel
              stocksState={stocksState}
              optionsState={optionsState}
              myChips={bankState.bankBalance ?? 0}
              joined={joined}
              onBuy={(symbol, amount) => send('stock:buy', { symbol, amount })}
              onSell={(symbol, sharesToSell) => send('stock:sell', { symbol, sharesToSell })}
              onSabotage={(symbol) => send('stock:sabotage', { symbol })}
              onBuyOption={(payload) => send('options:buy', payload)}
              onCloseOption={(payload) => send('options:close', payload)}
              influenceState={!roomDisabledTools.has('influence') ? influenceState : null}
              onRunInfluence={(opId, targetSymbol) => send('influence:run', { opId, targetSymbol })}
            />
          )
        } else if (id === 'world') {
          body = (
            <WorldPanel
              worldState={worldState}
              myChips={bankState.bankBalance ?? 0}
              joined={joined}
              myPlayerId={playerId}
              onClaim={(territoryId) => {
                const t = (worldState?.territories || []).find(tt => tt.id === territoryId)
                if (!t || t.isMine || t.ownerId) return
                send('world:claim', { territoryId })
              }}
              onPandemic={() => send('world:pandemic', {})}
              onMakeOffer={(territoryId, price) => send('world:offer', { territoryId, price })}
              onAcceptOffer={(territoryId, offerId) => send('world:accept_offer', { territoryId, offerId })}
              onDeclineOffer={(territoryId, offerId) => send('world:decline_offer', { territoryId, offerId })}
              onCancelOffer={(territoryId, offerId) => send('world:cancel_offer', { territoryId, offerId })}
              influenceState={!roomDisabledTools.has('influence') ? influenceState : null}
              onRunInfluence={(opId, targetSymbol) => send('influence:run', { opId, targetSymbol })}
            />
          )
        }
        return (
          <FloatingWindow key={id} {...common}>
            <div className="p-3">{body}</div>
          </FloatingWindow>
        )
      })}

      {/* Freeform copies of the existing docked widgets. Each opens
          here when the user clicked the widget's small ↗ button to
          pop it out; the floating window's back-arrow ("↺ Dock")
          returns it to its original anchored slot. The widget's own
          state (visibility / size / etc.) is unchanged — only the
          rendering frame moves. */}
      {hudEnabled && !roomDisabledTools.has('hud') && widgetFreeform.hud && (
        <FloatingWindow
          open
          onClose={() => setHudEnabledPersist(false)}
          onBack={() => toggleWidgetFreeform('hud')}
          backLabel="Dock"
          title="Investment HUD"
          icon="✦"
          accent="amber"
          storageKey="pokerxyz:widget:hud"
          defaultWidth={340}
          defaultHeight={420}
        >
          <div className="p-2">
            {/* No `onClose` — the floating chrome's × already closes
                this. Passing it here would render a SECOND × inside the
                panel header, stacked under the chrome's. */}
            <InvestmentHUD
              myBank={bankState.bankBalance ?? 0}
              myChips={bankState.chips ?? 0}
              bankLoans={bankState.loans || []}
              peerLoans={myPeerLoans}
              myPlayerId={playerId}
              cryptoState={cryptoState}
              assetsState={assetsState}
              stocksState={stocksState}
              worldState={worldState}
              onOpenPanel={openPokerPanel}
            />
          </div>
        </FloatingWindow>
      )}
      {sideBetsDockVisible && !roomDisabledTools.has('sidebets') && widgetFreeform.sidebets && (
        <FloatingWindow
          open
          onClose={toggleSideBetsDock}
          onBack={() => toggleWidgetFreeform('sidebets')}
          backLabel="Dock"
          title="Side Bets"
          icon="✦"
          accent="amber"
          storageKey="pokerxyz:widget:sidebets"
          defaultWidth={340}
          defaultHeight={500}
        >
          {/* No `onClose` — the floating chrome's × already closes
              this. See HUD note above. */}
          <SideBetsPanel
            sideBets={sideBetsState}
            myPlayerId={playerId}
            myStack={bankState.bankBalance ?? 0}
            onPlace={placeSideBet}
            onSell={sellSideBet}
            expanded={sideBetsExpanded}
            onToggleExpanded={() => setSideBetsExpanded(prev => !prev)}
          />
        </FloatingWindow>
      )}
      {chatDockVisible && !roomDisabledTools.has('chat') && widgetFreeform.chat && (
        <FloatingWindow
          open
          onClose={toggleChatDock}
          onBack={() => toggleWidgetFreeform('chat')}
          backLabel="Dock"
          title="Chat"
          icon="✦"
          accent="cyan"
          storageKey="pokerxyz:widget:chat"
          defaultWidth={340}
          defaultHeight={360}
        >
          {/* Inline × suppressed — the floating chrome's × handles it. */}
          {renderChatInner(false)}
        </FloatingWindow>
      )}

      {/* PIN-hack popup — landed on us because another player used
          pin_hack. The two-phase modal handles its own countdown; the
          server enforces the same 12s deadline so an AFK target still
          resolves cleanly into a drain. We clear local state when the
          user submits; the server's response message confirms the
          outcome via the toast. */}
      {pinHackPopup && (
        <PinHackModal
          senderUsername={pinHackPopup.senderUsername}
          pin={pinHackPopup.pin}
          amount={pinHackPopup.amount}
          onSubmit={(guess) => {
            send('item:pin_hack_resolve', { pinHackId: pinHackPopup.pinHackId, guess })
            setPinHackPopup(null)
          }}
        />
      )}

      {/* Scam popups — landed on us because other players used their
          Scam item. Sea of Accept buttons + one Block; buttons reshuffle
          every 400ms so a hasty click can hit Accept. Multiple in flight
          render at different corners so they're each addressable.
          The first popup keeps the centered/backdrop look so a single
          attacker still gets the dramatic full-screen treatment. */}
      {scamPopups.map((scam, idx) => {
        // Five corner/edge slots — enough to cover the typical "one
        // scammer per opponent" case (max 4 opponents at a 5-seat table).
        // Slot 0 is the centered/backdrop mode for a single-attacker
        // burst; slots 1+ peel off to corners.
        const CORNER_SLOTS = [
          null,
          { top: '4rem', right: '1rem' },
          { top: '4rem', left: '1rem' },
          { bottom: '5rem', right: '1rem' },
          { bottom: '5rem', left: '1rem' },
        ]
        const position = CORNER_SLOTS[Math.min(idx, CORNER_SLOTS.length - 1)]
        return (
          <ScamPopupModal
            key={scam.scamId}
            senderUsername={scam.senderUsername}
            amount={scam.amount}
            position={position}
            onAccept={() => {
              send('item:scam_resolve', { scamId: scam.scamId, accepted: true })
              setScamPopups(prev => prev.filter(p => p.scamId !== scam.scamId))
            }}
            onBlock={() => {
              send('item:scam_resolve', { scamId: scam.scamId, accepted: false })
              setScamPopups(prev => prev.filter(p => p.scamId !== scam.scamId))
            }}
          />
        )
      })}

      {/* Floating feed window — opened from the Tools menu. Movable,
          resizable, persisted position/size. Reuses PostCard + PostComposer
          so the in-table view matches /feed exactly. */}
      <FeedWindow
        open={feedWindowOpen}
        onClose={() => { setFeedWindowOpen(false); setFeedOpenedFromTools(false) }}
        // No back arrow — Tools is always reachable from its own
        // button in the nav, and a ← would just duplicate ×.
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
                    .map(w => `${w.username} +${(w.chips || 0).toLocaleString()}`)
                    .join(' · ')}
            </div>
          </div>
        </div>
      )}

      {/* Natural Flow Bottom UI — `md:relative` makes this the positioning
          anchor for the right column at md+ (sidebets + chat are absolutely
          positioned inside it so they share the action / spectator panel's
          baseline AND don't inflate the row's height when sidebets expands).
          Same pattern for every mode now: action panel OR spectator panel
          on the left, sidebets/chat docks on the right. Mobile (flex-col)
          stacks them via order-1 / order-2. md+ (flex-row + md:absolute
          for the docks) puts them side-by-side.
          No more pb-[XXXpx] reservations — panels are in-flow, the wrapper
          takes their natural height, and flex-1 on the table area auto-
          adjusts to fit whatever's left. */}
      {/* `pb-6` on mobile is the bottom-UI's distance from the viewport
          bottom — independent of the table above. With `mt-auto` pushing
          this block to the end of the page flex column, this is what
          drives "controls X pixels above the screen bottom" semantics:
          zoom out → felt shrinks → bigger gap between felt and these
          controls; we never re-tie to the felt's geometry. md+ keeps
          pb-0 because the desktop layout pins sidebets/chat to the side
          and the bottom-UI sits naturally at the column bottom. */}
      <div className={`w-full flex flex-col md:flex-row md:relative justify-center md:justify-between items-center md:items-end gap-3 sm:gap-4 shrink-0 mt-auto pb-6 md:pb-0 ${isSpectator ? 'md:min-h-[210px]' : ''}`}>
        
        {/* Actions Panel — fixed-size chrome regardless of turn so the rest
            of the layout doesn't shift between waiting and acting. */}
        {!isSpectator && (() => {
          const inHand = phase !== 'waiting' && phase !== 'showdown' && !myPlayer?.folded && !isWaitingNextHand
          // Block actions while the WS is closed mid-reconnect. Without this
          // a click would hit `ws.send` on a CLOSED socket and throw an
          // InvalidStateError into the React handler. Server already
          // auto-checks/folds for in-grace players, so the right UX is to
          // grey the buttons + let the banner explain the wait.
          const canAct = inHand && isMyTurn && connected
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
            {/* Check-in-the-dark / pre-action toggle removed — the
                table is now strictly action-on-your-turn-only. */}
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => send('poker_fold')}
                disabled={!canAct}
                className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700 flex items-center justify-center"
              >
                Fold
              </button>
              {toCall === 0 ? (
                <button
                  onClick={() => send('poker_check')}
                  disabled={!canAct}
                  className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700 flex items-center justify-center"
                >
                  Check
                </button>
              ) : (() => {
                const callAmt = Math.min(toCall, myPlayer?.chips || 0)
                return (
                  <button
                    onClick={() => send('poker_call')}
                    disabled={!canAct}
                    title={`Call $${callAmt.toLocaleString()}`}
                    className="px-2 py-1 rounded-md text-xs font-bold transition-all bg-emerald-600 hover:bg-emerald-500 border border-emerald-400/50 text-white shadow-sm active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 leading-tight"
                  >
                    Call ${callAmt.toLocaleString()}
                  </button>
                )
              })()}
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
                {allInArmed && canAct
                  ? `Confirm All In · $${(myPlayer?.chips || 0).toLocaleString()}`
                  : 'All In'}
              </button>
            </div>

            {/* Raise UI — redesigned for trillion-scale economy.
                The slider has log-scale resolution problems above $1M
                (one pixel = $100K minimum); a player with $5T can't
                use the slider to pick "$50B exactly". So we keep the
                slider for casual incremental bumps + add:
                  • a direct numeric input that accepts shorthand
                    (5K, 1.5M, 2B, 0.5T)
                  • four quick-bet buttons (¼ pot, ½ pot, pot, all-in)
                The button shows the bet + BB and respects both inputs. */}
            <div className={`flex flex-col gap-1.5 w-full ${(!canAct || !hasRaiseRoom) ? 'opacity-40' : ''}`}>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={raiseAmount > 0 ? safeRaise.toLocaleString() : ''}
                  placeholder={`min $${formatChipsCompact(minRaise)}`}
                  onChange={(e) => {
                    const parsed = parseChipShorthand(e.target.value)
                    if (parsed !== null) setRaiseAmount(parsed)
                    else if (e.target.value.trim() === '') setRaiseAmount(0)
                  }}
                  disabled={!canAct || !hasRaiseRoom}
                  className="flex-1 min-w-0 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1 text-xs font-bold text-white outline-none focus:border-zinc-300 disabled:cursor-not-allowed tabular-nums"
                />
                <button
                  onClick={() => send('poker_raise', { amount: safeRaise })}
                  disabled={!canAct || !hasRaiseRoom}
                  title={`Raise $${safeRaise.toLocaleString()}`}
                  className="shrink-0 px-2 py-1 rounded-md text-xs font-bold transition-all whitespace-nowrap bg-zinc-700 hover:bg-zinc-600 border border-zinc-500/50 text-white shadow-sm active:scale-95 disabled:cursor-not-allowed disabled:hover:bg-zinc-700 leading-tight"
                >
                  Raise ${formatChipsCompact(safeRaise)}
                </button>
              </div>
              {/* Quick-bet shortcuts. Pot-relative + all-in. All clamped
                  to [minRaise, myChips] so they're always legal. */}
              <div className="grid grid-cols-4 gap-1">
                {(() => {
                  const pot = gameState?.pot || 0
                  const myChips = myPlayer?.chips || 0
                  const clamp = (n) => Math.max(minRaise, Math.min(myChips, Math.floor(n)))
                  const presets = [
                    { label: '¼ pot', amount: clamp(pot * 0.25) },
                    { label: '½ pot', amount: clamp(pot * 0.5) },
                    { label: 'Pot',   amount: clamp(pot) },
                    { label: 'Max',   amount: myChips },
                  ]
                  return presets.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setRaiseAmount(p.amount)}
                      disabled={!canAct || !hasRaiseRoom}
                      title={`${p.label}: ${p.amount.toLocaleString()} chips`}
                      className="rounded-md border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] font-black uppercase tracking-wide text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                    >
                      {p.label}
                    </button>
                  ))
                })()}
              </div>
              {/* Stack-fraction quick buttons. Pot-relative buttons (above)
                  handle "what to bet given the pot"; this row handles
                  "what fraction of my chips am I willing to commit," which
                  matters more for players actively managing a budget /
                  set-aside stack. Per design ask #20 ("specify a range
                  you can bet with from your money"). */}
              <div className="grid grid-cols-4 gap-1">
                {(() => {
                  const myChips = myPlayer?.chips || 0
                  const clamp = (n) => Math.max(minRaise, Math.min(myChips, Math.floor(n)))
                  const stackPresets = [
                    { label: '¼ stack', amount: clamp(myChips * 0.25) },
                    { label: '½ stack', amount: clamp(myChips * 0.5) },
                    { label: '¾ stack', amount: clamp(myChips * 0.75) },
                    { label: 'All-in',  amount: myChips },
                  ]
                  return stackPresets.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setRaiseAmount(p.amount)}
                      disabled={!canAct || !hasRaiseRoom}
                      title={`${p.label}: ${p.amount.toLocaleString()} chips`}
                      className="rounded-md border border-zinc-700 bg-zinc-900/60 px-1 py-0.5 text-[10px] font-black uppercase tracking-wide text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
                    >
                      {p.label}
                    </button>
                  ))
                })()}
              </div>
              <input
                type="range"
                min={minRaise}
                max={myPlayer?.chips || minRaise}
                step={Math.max(1, Math.floor((myPlayer?.chips || minRaise) / 200))}
                value={safeRaise}
                onChange={e => setRaiseAmount(parseInt(e.target.value))}
                disabled={!canAct || !hasRaiseRoom}
                title="Drag to dial — for finer control, type in the box above"
                className="w-full accent-white h-1 bg-zinc-900 rounded-full disabled:cursor-not-allowed"
              />
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
          {/* Chat dock used to render here on the left stack when both
              chat AND sidebets were visible. That co-visible state is no
              longer reachable (the toggles mutually exclude), so chat
              always renders in the sidebets slot via the IIFE below. */}
        </div>
          )
        })()}

        {/* Stats panel — top-right, anchored to the SAME container edge as
            the Tools/Lobby buttons. Wrapped in a centered max-w-7xl band so
            on wide screens it doesn't drift to the viewport edge while the
            buttons stay inside the centered content. Click outside the
            panel auto-minimizes it (handled by a useEffect above) so it
            never shifts other UI around. The Close button exits entirely. */}
        {!isSpectator && statsMode && !roomDisabledTools.has('equity') && (
          <div className="pointer-events-none fixed inset-x-0 top-12 z-[500] sm:top-14">
            <div className="relative mx-auto max-w-7xl">
              <div
                ref={statsPanelRef}
                // Right edge matches the Tools/Lobby cluster's gutter
                // (auth-aware, same as RouteNavCluster). Width is
                // measured live from the Tools + Lobby pair so the
                // widget is exactly as wide as those two buttons
                // together, regardless of font/zoom. Falls back to a
                // sane default until the first ResizeObserver tick
                // lands so the widget isn't 0-width on first paint.
                className={`pointer-events-auto absolute top-0 ${authUser ? 'right-14 sm:right-16' : 'right-3 sm:right-4'}`}
                style={{ width: navPairWidth > 0 ? navPairWidth : undefined }}
              >
                <StatsPanel
                  statistics={statistics}
                  onClose={closeStatsPanel}
                />
              </div>
            </div>
          </div>
        )}

        {/* Spectator panel — in-flow. Wrapper classes exactly mirror
            the action panel's wrapper above (order-2 mobile / md:order-1
            desktop, same 92%/360px mobile sizing, same md:w-[320px] /
            md:max-w-none / shrink-0). That parity is the whole point of
            this refactor: spectator mode and seated-player mode now use
            the IDENTICAL bottom-UI layout, with the panel itself the
            only thing that varies between the two.

            ── DESKTOP LIFT (tweak `md:-translate-y-N md:-mb-N` below) ──
            On md+ the panel is lifted UP by `-translate-y-20` (= 80px).
            CRITICAL: pair it with a matching `-mb-20` so the layout
            box ALSO shrinks by 80px — without that, translate moves
            content visually but the layout still reserves the original
            footprint, leaving an 80px band of empty space below the
            panel that extends the page beyond viewport (causing the
            scrollbar). Both classes must use the SAME N value:
              -translate-y-12 / -mb-12 = -48px (subtle)
              -translate-y-16 / -mb-16 = -64px
              -translate-y-20 / -mb-20 = -80px (current default)
              -translate-y-24 / -mb-24 = -96px
              -translate-y-28 / -mb-28 = -112px (aggressive)
            KEEP BOTH VALUES IN SYNC with the dock wrapper below — all
            four classes (two pairs) must match or the spectator panel
            and sidebets/chat row will sit at different heights AND/OR
            the empty-space scroll bug returns.
            Mobile gets NO lift — sidebets stacks directly above the
            spectator panel there, so lifting would cause overlap. */}
        {isSpectator && (
          // Mobile gets `mt-10` so the centered panel clears the bottom-
          // center seat's protruding cards (the felt's bottom edge sits a
          // little above the panel; without margin the panel rides up and
          // overlaps the seat-6 hand). Reset to `md:mt-0` so the desktop
          // lift logic (-translate-y-20 / -mb-20) is unchanged.
          <div className="order-2 w-[92%] max-w-[360px] mt-10 md:mt-0 md:order-1 md:w-[320px] md:max-w-none shrink-0 md:-translate-y-20 md:-mb-20 md:relative md:z-10">
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
          </div>
        )}

        {/* Sidebets / chat dock — unified layout for ALL modes
            (non-spectator, non-arena spectator, arena spectator).
            One `order-1 mx-auto md:order-2 md:absolute md:bottom-0
            md:right-0` wrapper holds whichever docks are toggled on.
            On mobile this sits ABOVE the action/spectator panel; on
            md+ it pins to the bottom-right of the row.
            The previous code had three branches with fixed-position
            tricks for each spectator sub-mode — replaced here with the
            same in-flow pattern the seated-player view has used all
            along. */}
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

          // Visibility rules:
          //   • Spectator (arena or not): show whichever toggles are on.
          //     Arena enforces mutual exclusion at the toggle handler;
          //     non-arena spectator lets the user have both.
          //   • Non-spectator: chat takes the sidebets slot ONLY when
          //     sidebets is hidden — preserves the existing behavior
          //     where seated players use one or the other in this slot,
          //     not both (the inline chat under the yell input handles
          //     the always-on case for them).
          // Chat + Side Bets are mutually exclusive — the toggles enforce
          // it at write time, but a legacy localStorage state could still
          // have both enabled, so we belt-and-brace it here too. Side bets
          // wins the conflict (matches the toggle behavior).
          // Host-disabled tools force the corresponding dock off, even
          // if the player previously toggled it on in another room.
          const showSidebets = sideBetsDockVisible && !roomDisabledTools.has('sidebets')
          // Chat can claim the dock slot only when no docked side-bets
          // is using it. If side bets is in FREEFORM, the slot is free,
          // so chat docks normally. The "both docked simultaneously"
          // case is the one we suppress.
          const sidebetsBlockingDock = showSidebets && !widgetFreeform.sidebets
          const showChat = chatDockVisible && !sidebetsBlockingDock && !roomDisabledTools.has('chat')
          // Investment HUD sits ABOVE the dock in the same column. Render
          // the parent column whenever any of the three (HUD, sidebets,
          // chat) is on AND none are in freeform mode — otherwise the
          // freeform copy at body level is the only render.
          const showHUD = hudEnabled && !roomDisabledTools.has('hud')
          // Freeform widgets render OUTSIDE this column at body level
          // (see the FloatingWindow block further down). Skip them
          // here so they don't double-render.
          const dockHUD = showHUD && !widgetFreeform.hud
          const dockSidebets = showSidebets && !widgetFreeform.sidebets
          const dockChat = showChat && !widgetFreeform.chat
          if (!dockHUD && !dockSidebets && !dockChat) return null
          // Match the spectator panel's md+ lift so both sides of the
          // bottom-UI row visually align. KEEP THESE VALUES IN SYNC with
          // `md:-translate-y-20 md:-mb-20` on the spectator wrapper
          // above — translate moves visually, the negative mb pulls
          // the layout box up too so the page doesn't grow taller than
          // viewport. For seated players (no spectator wrapper), no
          // lift is applied — the action panel + sidebets sit at their
          // natural position.
          const lift = isSpectator ? 'md:-translate-y-20 md:-mb-20' : ''
          return (
            <div
              // The inline zIndex (driven by dockColumnZ) overrides the
              // baseline md:z-30 once the user activates any dock, so a
              // click on the chat / side-bets / HUD lifts the whole
              // column above windows and the Tools menu — matching the
              // click-to-front contract the windows and menu use.
              style={{ zIndex: dockColumnZ }}
              className={`order-1 w-[92%] max-w-[360px] mx-auto md:order-2 md:absolute md:bottom-0 md:right-0 md:mx-0 md:w-auto md:max-w-none md:z-30 relative flex flex-col items-end gap-3 shrink-0 ${lift}`}>
              {dockHUD && (
                <div ref={hudDockRef} onPointerDown={activateDockColumn} className="relative w-full md:w-auto">
                  {/* Small pop-out affordance — flips the HUD into a
                      freeform FloatingWindow at body level. Clicking
                      the ↺ button on the floating copy returns it to
                      this anchored slot. */}
                  <button
                    type="button"
                    onClick={() => toggleWidgetFreeform('hud')}
                    title="Pop out — drag this widget anywhere"
                    className="absolute -top-1.5 -left-1.5 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900 text-[9px] font-black text-zinc-300 shadow-md hover:bg-zinc-800 hover:text-amber-200"
                  >↗</button>
                  <InvestmentHUD
                    myBank={bankState.bankBalance ?? 0}
                    myChips={bankState.chips ?? 0}
                    bankLoans={bankState.loans || []}
                    peerLoans={myPeerLoans}
                    myPlayerId={playerId}
                    cryptoState={cryptoState}
                    assetsState={assetsState}
                    stocksState={stocksState}
                    worldState={worldState}
                    onOpenPanel={openPokerPanel}
                    onClose={() => setHudEnabledPersist(false)}
                  />
                </div>
              )}
              {dockSidebets && (
                // Outer wrapper holds the pop-out button so it can sit
                // OUTSIDE the rounded card — the inner card keeps
                // overflow-hidden for corner clipping, which would
                // otherwise chop a negative-offset button. The dock ref
                // wraps the outer node so a click on the pop-out button
                // still counts as "inside the side-bets dock" for the
                // tools-menu close-outside detector.
                <div ref={sideBetsDockRef} onPointerDown={activateDockColumn} className="relative w-full md:w-auto pt-1.5 pl-1.5">
                  <button
                    type="button"
                    onClick={() => toggleWidgetFreeform('sidebets')}
                    title="Pop out — drag this widget anywhere"
                    className="absolute top-0 left-0 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900 text-[9px] font-black text-zinc-300 shadow-md hover:bg-zinc-800 hover:text-amber-200"
                  >↗</button>
                  <div className={`relative w-full md:w-[320px] flex flex-col ${sidebetsHeight} bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0`}>
                    <SideBetsPanel
                      sideBets={sideBetsState}
                      myPlayerId={playerId}
                      myStack={bankState.bankBalance ?? 0}
                      onPlace={placeSideBet}
                      onSell={sellSideBet}
                      expanded={sideBetsExpanded}
                      onToggleExpanded={() => setSideBetsExpanded(prev => !prev)}
                      onClose={toggleSideBetsDock}
                    />
                  </div>
                </div>
              )}
              {dockChat && (
                <div ref={chatDockRef} onPointerDown={activateDockColumn} className="relative w-full md:w-auto pt-1.5 pl-1.5">
                  <button
                    type="button"
                    onClick={() => toggleWidgetFreeform('chat')}
                    title="Pop out — drag this widget anywhere"
                    className="absolute top-0 left-0 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900 text-[9px] font-black text-zinc-300 shadow-md hover:bg-zinc-800 hover:text-amber-200"
                  >↗</button>
                  <div className="relative w-full md:w-[320px] flex flex-col h-56 lg:h-72 bg-zinc-800/95 border border-zinc-600/50 rounded-xl shadow-2xl backdrop-blur-md overflow-hidden shrink-0">
                    {chatBoxInner}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Bot-speed dock is no longer rendered here — it's bridged
            into AccountDock via setDockBotSpeed (see effect below) so
            it lives in the SAME flex column as the avatar/DMs/bell
            and the same `gap-2` literally governs its spacing. */}

        {/* Session-notification toast stack. Bottom-middle, above the
            action panel's safe-area inset. Anchored with `fixed` so it
            doesn't move with the felt scroll. Newest toast at the
            bottom of the stack so the eye lands on the most recent. */}
        {sessionNotifs.length > 0 && (
          <div className="pointer-events-none fixed bottom-32 sm:bottom-36 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-1.5 px-3">
            {sessionNotifs.map(n => {
              // Loan-offer / counter toasts are clickable — they deep-
              // link into the counterparty's table popover, which already
              // hosts PeerLoanPanel and shows the open negotiation.
              const isLoan = (n.kind === 'peer_loan_offer' || n.kind === 'peer_loan_counter') && n.fromId
              const openLoanPopover = () => {
                if (!n.fromId) return
                const target =
                  gameState?.players?.find(p => p.id === n.fromId) ||
                  gameState?.spectators?.find(p => p.id === n.fromId)
                if (!target) return
                setPopoverSeatId(n.fromId)
                setPopoverSeat(target)
                // Dismiss the toast on click — once the popover is open
                // the notification has done its job, and leaving it up
                // looks redundant next to the open form.
                setSessionNotifs(prev => prev.filter(x => x.id !== n.id))
                const timer = sessionNotifTimersRef.current.get(n.id)
                if (timer) {
                  clearTimeout(timer)
                  sessionNotifTimersRef.current.delete(n.id)
                }
              }
              if (isLoan) {
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={openLoanPopover}
                    className="pointer-events-auto cursor-pointer rounded-full border border-amber-400/60 bg-zinc-950/90 px-3 py-1.5 text-[11px] font-black text-amber-100 shadow-xl backdrop-blur transition-colors hover:border-amber-300 hover:bg-amber-500/15 active:scale-95"
                    title="Open this player's profile to respond"
                  >
                    <span className="text-amber-300">·</span> {n.body}
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-amber-300/80">tap to open</span>
                  </button>
                )
              }
              return (
                <div
                  key={n.id}
                  className="pointer-events-auto rounded-full border border-amber-400/60 bg-zinc-950/90 px-3 py-1.5 text-[11px] font-black text-amber-100 shadow-xl backdrop-blur"
                >
                  <span className="text-amber-300">·</span> {n.body}
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
