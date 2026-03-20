export const POKER_CONFIG = {
  MAX_PLAYERS: 5,
  MIN_PLAYERS: 2,
  STARTING_CHIPS: 1000,
  SMALL_BLIND: 5,
  BIG_BLIND: 10,
  MIN_RAISE: 10
}

export const MESSAGE_TYPES = {
  // Connection
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',

  // Room
  JOIN_GAME: 'join_game',
  LEAVE_GAME: 'leave_game',
  ROOM_UPDATE: 'room_update',

  // Poker actions
  POKER_FOLD: 'poker_fold',
  POKER_CHECK: 'poker_check',
  POKER_CALL: 'poker_call',
  POKER_RAISE: 'poker_raise',
  POKER_ALL_IN: 'poker_all_in',

  // Chat
  CHAT: 'chat',
  SYSTEM_MESSAGE: 'system_message',

  // State
  GAME_STATE: 'game_state',
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