export const POKER_CONFIG = {
  MAX_PLAYERS: 5,
  MIN_PLAYERS: 2,
  // Initial poker bankroll — chips on the table. Every player buys in
  // for this much; busting at zero auto-rebuys another batch of this
  // size, funded from the bank account below. Keeping it small means
  // every hand at the table is the same scale of stack regardless of
  // how well the player's investing portfolio is doing.
  STARTING_CHIPS: 1000,
  // Starting balance of the SEPARATE bank account. Stocks, crypto,
  // options, assets, jobs, world yields — all settle here, not in
  // the poker stack. When the poker stack busts, we draw STARTING_CHIPS
  // from this account to rebuy. The split keeps "I lost a big poker
  // hand" cleanly distinct from "my stock portfolio is down" so the
  // P/L badges read honestly.
  BANK_START_BALANCE: 5000,
  // Hard cap on the on-table poker stack. Wins that would push a seat
  // above this size sweep the excess into the bank wallet so every
  // hand is played at the same scale of stacks. Combined with the
  // 5000 chip-stack maximum on blinds (50/100), the table economy
  // stays a tight one-buy-in game regardless of how rich the player's
  // bank account gets from outside investments.
  CHIP_STACK_MAX: 1000,
  SMALL_BLIND: 5,
  BIG_BLIND: 10,
  MIN_RAISE: 10,
  TURN_LIMIT_MS: 60 * 1000,
  TURN_WARNING_MS: 10 * 1000
}

// Allowed blind levels at the table. Validated server-side so a malicious
// client can't propose arbitrary numbers. 2026-05: ladder collapsed to
// the small-stack range only — the poker stack is hard-capped at 1000
// chips (see CHIP_STACK_MAX), so blinds in the K+ range would force
// everyone all-in on the post. Off-table earnings live in the bank
// wallet, not the poker stack, so we don't need huge blinds anymore.
// IMPORTANT: must stay in sync with client/app/poker/page.jsx BLIND_LEVELS.
export const BLIND_LEVELS = [
  { id: '1_2',    small: 1,   big: 2   },
  { id: '2_3',    small: 2,   big: 3   },
  { id: '5_10',   small: 5,   big: 10  },
  { id: '10_15',  small: 10,  big: 15  },
  { id: '20_25',  small: 20,  big: 25  },
  { id: '25_50',  small: 25,  big: 50  },
  { id: '50_100', small: 50,  big: 100 },
]

// Approvals required to apply a blinds change, indexed by # of seated humans
// (excluding bots). Solo with bots auto-applies. Otherwise:
//   2 humans → both must approve     (2/2)
//   3 humans → 2 of 3 must approve   (2/3)
//   4 humans → 2 of 4 must approve   (1/2)
//   5 humans → 3 of 5 must approve   (3/5)
export const BLIND_APPROVALS_NEEDED = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 3 }
export const BLIND_PROPOSAL_TIMEOUT_MS = 60_000

// Contest mode bumps blinds every N hands at the table.
export const CONTEST_MODE_HANDS_PER_LEVEL = 10

// Run-it-twice: when exactly two human players are both all-in pre-river
// and the pot is at least RUN_IT_TWICE_MIN_POT chips, the engine offers
// both players a vote to deal the remaining streets up to RUN_IT_TWICE_MAX_RUNS
// times. Each player has RUN_IT_TWICE_VOTE_TIMEOUT_MS to confirm. The pot
// is split evenly across each runout and awarded to that runout's winner.
// Both players must agree on the same number; any mismatch (or a timeout)
// falls back to a single runout.
export const RUN_IT_TWICE_MIN_POT = 10_000
export const RUN_IT_TWICE_MAX_RUNS = 4
export const RUN_IT_TWICE_VOTE_TIMEOUT_MS = 60_000
// Delay between successive runout reveals so each "boom" lands cleanly
// instead of stacking on top of the previous one.
export const RUN_IT_TWICE_STEP_DELAY_MS = 3500
// How long the multi-runout summary holds on screen before the next-hand
// reset kicks in. Matches resolveShowdown's 15s for parity.
export const RUN_IT_TWICE_SUMMARY_HOLD_MS = 12_000

export const PROFILE_AVATARS = [
  { id: 'op1', url: 'https://i.ibb.co/Wpf6XVp0/image.png' },
  { id: 'op2', url: 'https://i.ibb.co/XdFhJ7w/image.png' },
  { id: 'op3', url: 'https://i.ibb.co/TD0NJ5TR/image.png' },
  { id: 'op4', url: 'https://i.ibb.co/0jwk0qwP/image.png' },
  { id: 'op5', url: 'https://i.ibb.co/qYM6dhcB/image.png' },
  { id: 'op6', url: 'https://i.ibb.co/4g55Ppjs/image.png' },
  { id: 'op7', url: 'https://i.ibb.co/WWQbgGzW/image.png' },
  { id: 'op8', url: 'https://i.ibb.co/GfRfzcBM/image.png' },
  { id: 'op9', url: 'https://i.ibb.co/mFr14sFv/image.png' },
  { id: 'op10', url: 'https://i.ibb.co/8nm24QfJ/image.png' },
]

export const DEFAULT_PROFILE_AVATAR = PROFILE_AVATARS[0]

export const MESSAGE_TYPES = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',

  // Room
  JOIN_GAME: 'join_game',
  LEAVE_GAME: 'leave_game',
  ROOM_UPDATE: 'room_update',
  LIST_TABLES: 'list_tables',
  TABLE_LIST: 'table_list',

  // Poker actions
  POKER_FOLD: 'poker_fold',
  POKER_CHECK: 'poker_check',
  POKER_CALL: 'poker_call',
  POKER_RAISE: 'poker_raise',
  POKER_ALL_IN: 'poker_all_in',

  // Bot management (poker only)
  ADD_BOT: 'add_bot',
  REMOVE_BOT: 'remove_bot',
  BOT_YELL: 'bot_yell',

  // Player utilities
  POKER_LOAN: 'poker_loan',
  POKER_REPAY_LOAN: 'poker_repay_loan',
  POKER_SET_AUTOPAY: 'poker_set_autopay',
  POKER_BIG_YAHU: 'poker_big_yahu',

  // Blinds change voting
  POKER_PROPOSE_BLINDS: 'poker_propose_blinds',
  POKER_BLINDS_PROPOSAL: 'poker_blinds_proposal',
  POKER_BLINDS_VOTE: 'poker_blinds_vote',
  POKER_BLINDS_RESOLVED: 'poker_blinds_resolved',
  POKER_BLINDS_CHANGED: 'poker_blinds_changed',

  // Contest mode (auto-escalating blinds)
  POKER_TOGGLE_CONTEST_MODE: 'poker_toggle_contest_mode',
  POKER_CONTEST_MODE_UPDATE: 'poker_contest_mode_update',

  // Bot Arena
  POKER_ARENA_SET_RUNNING: 'poker_arena_set_running',
  POKER_ARENA_SET_STARTING_CHIPS: 'poker_arena_set_starting_chips',
  // Spectator-controlled think delay for bot moves in an arena. Lets the
  // viewer trade follow-along comfort (longer pause) for fast-forward
  // density (shorter pause). Server clamps to [200, 4000] ms.
  POKER_ARENA_SET_SPEED: 'poker_arena_set_speed',
  // Auto-fill works at both arenas (spectator-initiated) and regular
  // tables (seated-player-initiated). Generic name reflects the
  // broader scope; the previous POKER_ARENA_AUTO_FILL was arena-only.
  POKER_AUTO_FILL_BOTS: 'poker_auto_fill_bots',
  // Auto-fill with the caller's own 5 neural-net bots (α through ε). Auth
  // required — anonymous sessions have no NN squad. Different from
  // POKER_AUTO_FILL_BOTS which seats top-ELO public bots regardless of
  // signed-in state.
  POKER_AUTO_FILL_NEURAL: 'poker_auto_fill_neural',
  // Auto-fill with the caller's own user-coded (non-clone, non-NN) bots
  // sorted by ELO. Auth required. Useful when you want a table of your
  // own creations without picking each one manually.
  POKER_AUTO_FILL_CUSTOM: 'poker_auto_fill_custom',
  // Auto-fill with the caller's 5 deep-MLP neural bots (tiers 6-10:
  // Neuron ζ-κ). Auth required. Distinct from POKER_AUTO_FILL_NEURAL,
  // which seats the baseline α-ε lineup (tiers 1-5).
  POKER_AUTO_FILL_MLP: 'poker_auto_fill_mlp',
  // Bulk-remove every bot currently seated in the caller's room. Used
  // by the Tools menu's "Kick all bots" action so a user who lands at
  // a full bot table can clear seats in one click instead of fanning
  // out N separate REMOVE_BOT messages.
  POKER_KICK_ALL_BOTS: 'poker_kick_all_bots',
  // Vote-to-kick a human seat. data: { targetId }. Server tallies votes
  // per 3-min window; thresholds: 3-4 players → 2 votes, 5 → 3.
  POKER_KICK_VOTE: 'poker_kick_vote',

  // Auth handshake — client sends a JWT after connect so the server knows
  // which signed-in user this socket belongs to (needed for arena creation).
  AUTH_HELLO: 'auth_hello',

  // Safe rejoin: the client sends RECONNECT with the last-issued
  // sessionToken to re-attach a fresh WS to its existing seat (which the
  // server held during the grace window). On success the server replies
  // with RECONNECT_OK + a full room snapshot; on failure (token unknown,
  // grace expired, seat already filled) it replies RECONNECT_FAIL and the
  // client falls back to a fresh join.
  RECONNECT: 'reconnect',
  RECONNECT_OK: 'reconnect_ok',
  RECONNECT_FAIL: 'reconnect_fail',

  // Broadcast to a room when one of its players' WS closes but they're
  // still in the grace window. Lets the client show a "(reconnecting…)"
  // tag on the affected seat instead of treating them as gone.
  PLAYER_DISCONNECTED: 'player_disconnected',
  PLAYER_RECONNECTED: 'player_reconnected',

  // Player-vs-player griefing items. See server/src/items/itemEngine.js.
  // - item:use     (client → server)  { itemId, targetId? }
  // - item:result  (server → client)  generic ack for the user (cards on peek, amount on hack, etc.)
  // - item:scam_popup (server → target only)  trigger the shifting-buttons popup
  // - item:scam_resolve (client → server)     { scamId, accepted }
  // - items:state  (server → client)  per-player snapshot of cooldowns / readiness
  ITEM_USE: 'item:use',
  ITEM_RESULT: 'item:result',
  ITEM_SCAM_POPUP: 'item:scam_popup',
  ITEM_SCAM_RESOLVE: 'item:scam_resolve',
  ITEMS_STATE: 'items:state',

  // Achievement events — fired when a signed-in user crosses a milestone
  // (e.g., the 12-hand "your bot is unlocked" trigger). Renders as a toast
  // on the client.
  ACHIEVEMENT: 'achievement',

  UPDATE_PROFILE: 'update_profile',
  RESET_MONEY: 'reset_money',

  // Chat
  CHAT: 'chat',
  SYSTEM_MESSAGE: 'system_message',
  PLAYER_EMOTE: 'player_emote',
  PLAYER_YELL: 'player_yell',

  // State
  GAME_STATE: 'game_state',
  CHIP_THROW: 'chip_throw',
  PLAYER_UPDATE: 'player_update',
  SPECTATOR_UPDATE: 'spectator_update',
  ERROR: 'error',

  // Run-it-twice flow. Vote messages broadcast to the whole table (so
  // spectators can render "they're deciding"); only eligible-seat players
  // can submit. Step messages drive each runout's reveal on the client.
  RUNOUT_VOTE_START: 'runout_vote_start',
  RUNOUT_VOTE_SUBMIT: 'runout_vote_submit',
  RUNOUT_VOTE_UPDATE: 'runout_vote_update',
  RUNOUT_VOTE_RESOLVED: 'runout_vote_resolved',
  RUNOUT_STEP: 'runout_step',

  // Session-scoped notifications. Unlike the persisted `notif:*` flow
  // (DB-backed, user-id keyed), these are ephemeral toasts targeted by
  // playerId so anon seats can receive them. Cleared when the player
  // leaves the table — no DB write, no read marker, no /api fetch.
  // Used for "X nudged you", @-mentions, peer-loan offers to anons.
  SESSION_NOTIF: 'session_notif',
  // Client → server: nudge another player at the table. Server pushes
  // a SESSION_NOTIF of kind:'nudge' to the target. Mild rate-limit per
  // sender so the feature isn't a spam vector.
  PLAYER_NUDGE: 'player:nudge',
  // Client → server: send a session-scoped DM to another player at the
  // table. Server pushes a SESSION_NOTIF of kind:'dm' to the recipient
  // with the message body. No persistence — works for anon both ways.
  // Rate-limited per sender (3s cooldown) so it doesn't replace chat.
  PLAYER_SESSION_DM: 'player:session_dm'
}

// Bank loans: each bank lends $10k principal once at a base rate. The number of
// active loans you may carry expands as your |P/L| swings widen — banks get more
// generous when you're tilting, and credit gets pricier the deeper you go.
//
// Interest model: COMPOUND. Every hand the owed balance is multiplied by
// (1 + perTurnRate), so a forgotten loan blows up exponentially — and the
// per-turn rate scales with the credit-score multiplier, which itself can
// climb to 10× at the floor. A bad-credit player carrying 5 loans through
// 50+ hands easily hits thousands-of-percent territory, which is the
// thematic goal (predatory banking, by design).
export const LOAN_AMOUNT = 10_000
// Kept for backward-compat (how often interest USED to fire) — accrual now
// runs every hand, so this constant scales the per-turn rate instead.
// Effective per-turn rate = baseRate * creditMultiplier / LOAN_INTEREST_HAND_INTERVAL.
export const LOAN_INTEREST_HAND_INTERVAL = 10
export const CREDIT_SCORE_DEFAULT = 700
// Credit can go negative once a player is deep underwater + carrying many
// loans. The -1 floor is intentional: lets the credit-score badge bottom
// out at a memorable number and makes the credit-multiplier curve hit its
// max (10×) at exactly that point.
export const CREDIT_SCORE_MIN = -1
export const CREDIT_SCORE_MAX = 850

// Sticky bank-unlock tiers. Once you swing past the threshold (in either
// direction), the next slot opens permanently for the session. peakSwing >= X
// → maxLoans = Y. Big Yahu resets peakSwing back to 0.
export const BANK_UNLOCK_TIERS = [
  { swingAtLeast: 0,       maxLoans: 2  },
  { swingAtLeast: 10_000,  maxLoans: 4  },
  { swingAtLeast: 20_000,  maxLoans: 8  },
  { swingAtLeast: 40_000,  maxLoans: 16 },
  { swingAtLeast: 80_000,  maxLoans: 20 }
]

export const BANKS = [
  { id: 'chase',          name: 'Chase',                tagline: '$200 just for opening',                 baseRate: 0.045 },
  { id: 'boa',            name: 'Bank of America',      tagline: 'Erica is judging you',                  baseRate: 0.05  },
  { id: 'wells_fargo',    name: 'Wells Fargo',          tagline: 'New account, who dis?',                 baseRate: 0.06  },
  { id: 'citi',           name: 'Citi',                 tagline: 'Citi never sleeps',                     baseRate: 0.05  },
  { id: 'capital_one',    name: 'Capital One',          tagline: "What's in your wallet?",                baseRate: 0.07  },
  { id: 'us_bank',        name: 'U.S. Bank',            tagline: 'Possibility starts here',               baseRate: 0.045 },
  { id: 'pnc',            name: 'PNC Bank',             tagline: 'Yes, we can do that',                   baseRate: 0.05  },
  { id: 'truist',         name: 'Truist',               tagline: 'Built on trust',                        baseRate: 0.055 },
  { id: 'td',             name: 'TD Bank',              tagline: "America's most convenient",             baseRate: 0.06  },
  { id: 'hsbc',           name: 'HSBC',                 tagline: 'Together we thrive',                    baseRate: 0.07  },
  { id: 'barclays',       name: 'Barclays',             tagline: 'Forward-thinking',                      baseRate: 0.08  },
  { id: 'amex',           name: 'American Express',     tagline: "Don't leave home without it",           baseRate: 0.085 },
  { id: 'discover',       name: 'Discover',             tagline: 'Cashback overlords',                    baseRate: 0.10  },
  { id: 'sofi',           name: 'SoFi',                 tagline: 'The bank for the YOLO generation',      baseRate: 0.12  },
  { id: 'ally',           name: 'Ally Bank',            tagline: 'Do it right',                           baseRate: 0.06  },
  { id: 'goldman',        name: 'Goldman Sachs',        tagline: 'Definitely not predatory',              baseRate: 0.085 },
  { id: 'morgan_stanley', name: 'Morgan Stanley',       tagline: 'Capital created here',                  baseRate: 0.09  },
  { id: 'jpmorgan',       name: 'J.P. Morgan',          tagline: 'Old money energy',                      baseRate: 0.075 },
  { id: 'schwab',         name: 'Charles Schwab',       tagline: 'Through the cycle',                     baseRate: 0.08  },
  { id: 'fidelity',       name: 'Fidelity',             tagline: 'Smart move, big bet',                   baseRate: 0.07  }
]

// Map a credit score to a multiplier on the bank's base (per-turn) rate.
// Linear in each direction off the default:
//   850 (MAX) → 0.5×   great credit halves the per-turn rate
//   700 (DEFAULT) → 1× base behavior
//   -1  (MIN) → 10×    "loan shark mode" — combined with compounding,
//                       lets a forgotten loan reach thousands-of-percent
//                       owed inside a single session.
export function creditScoreRateMultiplier(score) {
  const clamped = Math.max(CREDIT_SCORE_MIN, Math.min(CREDIT_SCORE_MAX, score))
  if (clamped >= CREDIT_SCORE_DEFAULT) {
    const t = (clamped - CREDIT_SCORE_DEFAULT) / (CREDIT_SCORE_MAX - CREDIT_SCORE_DEFAULT)
    return 1.0 - 0.5 * t
  }
  const t = (CREDIT_SCORE_DEFAULT - clamped) / (CREDIT_SCORE_DEFAULT - CREDIT_SCORE_MIN)
  // Peaks at 10× at the very bottom; previously was 3×. The bigger
  // multiplier is what gets the compounding into "thousands of %" range
  // over a hand session for a player who's actually in distress.
  return 1.0 + 9.0 * t
}

export function effectiveLoanRate(bank, creditScore) {
  return Math.round(bank.baseRate * creditScoreRateMultiplier(creditScore) * 1000) / 1000
}

export function maxLoansForSwing(peakSwing) {
  let result = 2
  for (const tier of BANK_UNLOCK_TIERS) {
    if (peakSwing >= tier.swingAtLeast) result = tier.maxLoans
  }
  return result
}

export const GAME_PHASES = {
  WAITING: 'waiting',
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
}
