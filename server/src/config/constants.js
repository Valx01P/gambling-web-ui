export const POKER_CONFIG = {
  MAX_PLAYERS: 5,
  MIN_PLAYERS: 2,
  STARTING_CHIPS: 1000,
  SMALL_BLIND: 5,
  BIG_BLIND: 10,
  MIN_RAISE: 10
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

  // Chat
  CHAT: 'chat',
  SYSTEM_MESSAGE: 'system_message',
  PLAYER_EMOTE: 'player_emote',

  // State
  GAME_STATE: 'game_state',
  CHIP_THROW: 'chip_throw',
  PLAYER_UPDATE: 'player_update',
  SPECTATOR_UPDATE: 'spectator_update',
  ERROR: 'error'
}

export const GAME_PHASES = {
  WAITING: 'waiting',
  PREFLOP: 'preflop',
  FLOP: 'flop',
  TURN: 'turn',
  RIVER: 'river',
  SHOWDOWN: 'showdown'
}
