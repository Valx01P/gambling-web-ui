export const POKER_CONFIG = {
  MAX_PLAYERS: 5,
  MIN_PLAYERS: 2,
  STARTING_CHIPS: 1000,
  SMALL_BLIND: 5,
  BIG_BLIND: 10,
  MIN_RAISE: 10,
  TURN_LIMIT_MS: 60 * 1000,
  TURN_WARNING_MS: 10 * 1000
}

// Allowed blind levels at the table. Validated server-side so a malicious
// client can't propose arbitrary numbers.
export const BLIND_LEVELS = [
  { id: '5_10',     small: 5,    big: 10   },
  { id: '15_25',    small: 15,   big: 25   },
  { id: '25_50',    small: 25,   big: 50   },
  { id: '50_100',   small: 50,   big: 100  },
  { id: '100_200',  small: 100,  big: 200  },
  { id: '250_500',  small: 250,  big: 500  },
  { id: '500_1000', small: 500,  big: 1000 }
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

export const BLACKJACK_CONFIG = {
  MAX_PLAYERS: 5,
  STARTING_CHIPS: 1000,
  MIN_BET: 10,
  BLACKJACK_PAYOUT_NUMERATOR: 3,
  BLACKJACK_PAYOUT_DENOMINATOR: 2,
}

export const BACCARAT_CONFIG = {
  MAX_PLAYERS: 5,
  STARTING_CHIPS: 1000,
  MIN_BET: 10,
  MAX_DISPLAY_CHIPS: 1000000,
  BANKER_COMMISSION_PERCENT: 5,
  TIE_PAYOUT_MULTIPLIER: 8,
}

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

  // Auth handshake — client sends a JWT after connect so the server knows
  // which signed-in user this socket belongs to (needed for arena creation).
  AUTH_HELLO: 'auth_hello',

  UPDATE_PROFILE: 'update_profile',
  RESET_MONEY: 'reset_money',

  // Blackjack actions
  BLACKJACK_BET: 'blackjack_bet',
  BLACKJACK_HIT: 'blackjack_hit',
  BLACKJACK_STAND: 'blackjack_stand',
  BLACKJACK_DOUBLE: 'blackjack_double',
  BLACKJACK_SPLIT: 'blackjack_split',
  BLACKJACK_SURRENDER: 'blackjack_surrender',
  BLACKJACK_SET_AFK: 'blackjack_set_afk',

  // Baccarat actions
  BACCARAT_BET: 'baccarat_bet',
  BACCARAT_SET_AFK: 'baccarat_set_afk',

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
  ERROR: 'error'
}

// Bank loans: each bank lends $10k principal once at a base rate. The number of
// active loans you may carry expands as your |P/L| swings widen — banks get more
// generous when you're tilting, and credit gets pricier the deeper you go.
export const LOAN_AMOUNT = 10_000
export const LOAN_INTEREST_HAND_INTERVAL = 10  // turns/hands between interest charges
export const CREDIT_SCORE_DEFAULT = 700
export const CREDIT_SCORE_MIN = 300
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

// Map a credit score to a multiplier on the bank's base rate.
// 850 → 0.5x (great credit halves the rate), 700 → 1x, 300 → 3x.
export function creditScoreRateMultiplier(score) {
  const clamped = Math.max(CREDIT_SCORE_MIN, Math.min(CREDIT_SCORE_MAX, score))
  if (clamped >= CREDIT_SCORE_DEFAULT) {
    const t = (clamped - CREDIT_SCORE_DEFAULT) / (CREDIT_SCORE_MAX - CREDIT_SCORE_DEFAULT)
    return 1.0 - 0.5 * t
  }
  const t = (CREDIT_SCORE_DEFAULT - clamped) / (CREDIT_SCORE_DEFAULT - CREDIT_SCORE_MIN)
  return 1.0 + 2.0 * t
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
