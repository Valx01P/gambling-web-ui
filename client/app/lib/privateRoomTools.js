// Catalog of tools a private-room host can switch off when they create
// a room. The host's selection persists in localStorage (see
// PRIVATE_TOOLS_STORAGE_KEY) and is sent on the create_private payload,
// where the server stores it on the PokerRoom and includes it in every
// roomData broadcast — so all clients hide the same set.
//
// General rooms ignore this list — they're the wild west by design.
//
// Keep the `id` field in sync with:
//   * the panel ids consumed by openPokerPanel() in poker/page.jsx
//   * the TOOL_FOR_TYPE map in server/src/network/MessageHandler.js
export const TOGGLEABLE_TOOLS = [
  // ─── Markets / economy panels ────────────────────────────────────
  { id: 'crypto',    label: 'Crypto Market',   description: 'Meme coin trading, minting, rug pulls' },
  { id: 'items',     label: 'Items & Powers',  description: 'Peek, swap, scam, hack' },
  { id: 'assets',    label: 'Real Estate',     description: 'Property buys + passive yield' },
  { id: 'jobs',      label: 'Jobs Board',      description: 'Per-hand gig claims' },
  { id: 'stocks',    label: 'Stock Market',    description: 'Stocks, options, sabotage, earnings' },
  { id: 'world',     label: 'World Map',       description: 'Territory claims + pandemics' },
  { id: 'influence', label: 'Influence Ops',   description: 'Fake news, scandals, crises' },
  { id: 'casino',    label: 'Casino',          description: 'Slots, craps, and the lottery' },
  { id: 'bank',      label: 'Bank Loans',      description: 'Take / repay loans, credit score' },
  { id: 'daily',     label: 'Daily Challenge', description: "Today's rotating challenge panel" },
  // ─── In-hand betting + analysis ──────────────────────────────────
  { id: 'sidebets',  label: 'Side Bets',       description: 'In-hand prop bets (board pairs, all-in, etc.)' },
  { id: 'equity',    label: 'Hand Equity HUD', description: 'Live win-percentage overlay during a hand' },
  { id: 'hud',       label: 'Investment HUD',  description: 'Floating summary of all market positions' },
  { id: 'finances',  label: 'Finances Widget', description: 'Persistent P/L widget in the corner' },
  // ─── Social / chat ───────────────────────────────────────────────
  { id: 'chat',      label: 'Chat',            description: 'Table chat dock + emote/yell input' },
  // ─── Bot management ──────────────────────────────────────────────
  // Single toggle for the whole "seat a bot" surface: manual Bots
  // panel, auto-fills (Top / Neural / Custom / MLP), and Kick All.
  { id: 'bots',      label: 'Bot Seating',     description: 'Add bots, auto-fill table, kick all bots' },
  // ─── Personal nuclear options ────────────────────────────────────
  { id: 'reset',     label: 'Reset Bankroll',  description: 'Wipe bankroll back to starting chips' },
  { id: 'big_yahu',  label: 'Big Yahu',        description: 'Forgive all loans, reset P/L (one-use unlock)' },
]

export const TOGGLEABLE_TOOL_IDS = new Set(TOGGLEABLE_TOOLS.map(t => t.id))

// Host-side persistence — survives reloads so a player who always wants
// "no crypto" in their private rooms doesn't have to re-toggle it each
// session. Stored as a JSON array of disabled tool ids.
export const PRIVATE_TOOLS_STORAGE_KEY = 'gwu_private_room_disabled_tools'

export function loadPrivateRoomDisabledTools() {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(PRIVATE_TOOLS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter(id => TOGGLEABLE_TOOL_IDS.has(id)))
  } catch {
    return new Set()
  }
}

export function savePrivateRoomDisabledTools(set) {
  if (typeof window === 'undefined') return
  try {
    const arr = [...set].filter(id => TOGGLEABLE_TOOL_IDS.has(id))
    window.localStorage.setItem(PRIVATE_TOOLS_STORAGE_KEY, JSON.stringify(arr))
  } catch {}
}
