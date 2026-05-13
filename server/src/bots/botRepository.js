import { query, withTransaction } from '../db/pool.js'
import { initialNeuralState, normalizeState } from './neuralPolicy.js'
import { VARIANTS as NEURAL_VARIANTS } from './neural/registry.js'
import { initialSuperState, MODES as SUPER_MODES } from './super/transitions.js'
import { STARTING_RATING } from './runtime/eloEngine.js'

const PUBLIC_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.avatar_url, b.rules, b.phrases, b.is_public,
  b.code, b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
  b.is_neural, b.neural_tier, b.neural_kind, b.neural_state,
  b.is_super, b.super_member_ids, b.super_state,
  b.is_oracle,
  b.elo, b.hands_played, b.hands_voluntary, b.hands_won,
  b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.bluff_wins, b.chips_won_total,
  b.created_at, b.updated_at
`

// Slim shape for list endpoints. Excludes the heavy fields (rules, phrases,
// code) which the leaderboard and "my bots" page never display. With ~5KB
// average code size × 50 rows that's 250KB saved per leaderboard hit.
// `neural_state` IS included here on purpose: it's small (~90 floats) and
// the bot-list UI shows a tiny "hands trained / current LR" badge for NN
// bots, which needs the state shape.
const LIST_FIELDS = `
  b.id, b.owner_user_id, b.name, b.color, b.text_color, b.avatar_url, b.is_public,
  b.code_enabled,
  b.is_clone, b.clone_tier, b.clone_hands_used,
  b.is_neural, b.neural_tier, b.neural_kind, b.neural_state,
  b.is_super, b.super_member_ids, b.super_state,
  b.is_oracle,
  b.elo, b.hands_played, b.hands_voluntary, b.hands_won,
  b.showdowns_played, b.showdowns_won,
  b.bluffs_attempted, b.bluffs_succeeded, b.bluff_wins, b.chips_won_total,
  b.created_at, b.updated_at
`

function toApi(row, ownerName = null) {
  if (!row) return null
  // `rules`, `phrases`, `code` are only present on full reads. List shape
  // omits them — readers should not assume they exist. We pass undefined
  // through so JSON.stringify drops them rather than emitting null payloads.
  const out = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerDisplayName: ownerName,
    name: row.name,
    color: row.color,
    textColor: row.text_color || 'auto',
    avatarUrl: row.avatar_url || null,
    codeEnabled: Boolean(row.code_enabled),
    isPublic: row.is_public,
    elo: row.elo,
    isClone: Boolean(row.is_clone),
    cloneTier: row.clone_tier ?? null,
    cloneHandsUsed: row.clone_hands_used ?? null,
    isNeural: Boolean(row.is_neural),
    neuralTier: row.neural_tier ?? null,
    neuralKind: row.neural_kind ?? null,
    // neuralState is the full model blob. The runtime needs it for
    // inference + updates; the edit page renders the weights table from
    // the same field. Shape depends on neuralKind — pass it through so
    // normalizeState picks the right variant.
    neuralState: row.is_neural ? normalizeState(row.neural_state, row.neural_kind) : null,
    // Super-bot metadata. `superMemberIds` is the ordered list of member
    // bot UUIDs; populated only when isSuper. The full member records
    // are hydrated in `getBotById` for runtime dispatch + the edit page.
    isSuper: Boolean(row.is_super),
    superMemberIds: Array.isArray(row.super_member_ids) ? row.super_member_ids.slice() : null,
    // Bandit state for super bots. The runtime hydrates this through
    // normalizeSuperState; the edit page reads it raw for the stats UI.
    superState: row.is_super ? (row.super_state || null) : null,
    // Oracle bot — single per-user slot with omniscient ctx (sees every
    // opponent's hole cards + true equity vs known holdings, not inferred
    // ranges). Off-quota from the 10-manual cap. Permanent like clones.
    isOracle: Boolean(row.is_oracle),
    stats: {
      handsPlayed: row.hands_played,
      handsVoluntary: row.hands_voluntary ?? 0,
      handsWon: row.hands_won,
      showdownsPlayed: row.showdowns_played,
      showdownsWon: row.showdowns_won,
      bluffsAttempted: row.bluffs_attempted,
      bluffsSucceeded: row.bluffs_succeeded,
      bluffWins: row.bluff_wins ?? 0,
      chipsWonTotal: Number(row.chips_won_total)
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if ('rules' in row) out.rules = row.rules
  if ('phrases' in row) out.phrases = row.phrases
  if ('code' in row) out.code = row.code || ''
  return out
}

export async function createSuperBot({
  ownerUserId,
  name, color, textColor,
  isPublic = false,
  superMemberIds,
  mode = 'thompson'
}) {
  // Seed a fresh bandit state — one stats row per member, zeroed. Mode
  // defaults to thompson (the modern, explore-aware default) but
  // callers can pass any of uniform/weighted/thompson/markov.
  const initialState = initialSuperState({ mode, memberIds: superMemberIds })
  const { rows } = await query(
    `
    INSERT INTO bots (
      owner_user_id, name, color, text_color,
      rules, phrases, is_public,
      code, code_enabled,
      is_super, super_member_ids, super_state
    )
    VALUES ($1, $2, $3, $4, '[]'::jsonb, '{}'::jsonb, $5,
            '', FALSE,
            TRUE, $6::uuid[], $7::jsonb)
    RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [
      ownerUserId, name, color, textColor || 'auto',
      Boolean(isPublic),
      superMemberIds,
      JSON.stringify(initialState)
    ]
  )
  return toApi(rows[0])
}

export async function createBot({
  ownerUserId,
  name, color, textColor, rules, phrases,
  isPublic, code, codeEnabled,
  // Clone-only metadata. Pass these together or leave them all out.
  isClone = false, cloneTier = null, cloneHandsUsed = null
}) {
  const { rows } = await query(
    `
    INSERT INTO bots (
      owner_user_id, name, color, text_color, rules, phrases, is_public,
      code, code_enabled,
      is_clone, clone_tier, clone_hands_used
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12)
    RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [
      ownerUserId, name, color,
      textColor || 'auto',
      JSON.stringify(rules),
      JSON.stringify(phrases ?? {}),
      isPublic ?? true,
      code ?? '',
      Boolean(codeEnabled),
      Boolean(isClone),
      isClone ? cloneTier : null,
      isClone ? cloneHandsUsed : null
    ]
  )
  return toApi(rows[0])
}

export async function updateBot({ botId, ownerUserId, patch }) {
  const fields = []
  const values = []
  let idx = 1

  for (const [col, key] of [
    ['name', 'name'],
    ['color', 'color'],
    ['text_color', 'textColor'],
    ['avatar_url', 'avatarUrl'],
    ['is_public', 'isPublic'],
    ['code', 'code'],
    ['code_enabled', 'codeEnabled']
  ]) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = $${idx++}`)
      values.push(patch[key])
    }
  }
  if (patch.rules !== undefined) {
    fields.push(`rules = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.rules))
  }
  if (patch.phrases !== undefined) {
    fields.push(`phrases = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.phrases))
  }
  if (patch.superMemberIds !== undefined) {
    fields.push(`super_member_ids = $${idx++}::uuid[]`)
    values.push(patch.superMemberIds)
  }
  if (patch.superState !== undefined) {
    // Used by the mode-toggle UI: caller hands us the in-memory state
    // (with mode updated), we persist it whole. Bandit stats are
    // preserved across mode flips so a user can experiment without
    // burning their accumulated counts.
    fields.push(`super_state = $${idx++}::jsonb`)
    values.push(JSON.stringify(patch.superState))
  }

  if (fields.length === 0) {
    return getBotById(botId)
  }

  fields.push('updated_at = NOW()')
  values.push(botId, ownerUserId)

  const { rows } = await query(
    `
    UPDATE bots SET ${fields.join(', ')}
     WHERE id = $${idx++} AND owner_user_id = $${idx}
     RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    values
  )
  return toApi(rows[0])
}

// Refuses to delete clone bots — they're permanent slots tied to the user's
// play data. Same rule for neural bots: they're auto-provisioned fixed slots,
// not user-created. Same for the single Oracle slot. Returns { ok, reason }
// so the caller can render a sensible error rather than a generic 404.
export async function deleteBot({ botId, ownerUserId }) {
  const { rows } = await query(
    'SELECT is_clone, is_neural, is_oracle FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  if (rows.length === 0) return { ok: false, reason: 'not_found' }
  if (rows[0].is_clone) return { ok: false, reason: 'clone_locked' }
  if (rows[0].is_neural) return { ok: false, reason: 'neural_locked' }
  if (rows[0].is_oracle) return { ok: false, reason: 'oracle_locked' }
  const { rowCount } = await query(
    'DELETE FROM bots WHERE id = $1 AND owner_user_id = $2',
    [botId, ownerUserId]
  )
  return { ok: rowCount > 0, reason: rowCount > 0 ? null : 'not_found' }
}

// Auto-provision the full neural-net squad for a user — five bots, each a
// different learning variant. Idempotent: the unique (owner_user_id,
// neural_tier) constraint means re-running this never duplicates, so old
// users gain new variants on next /mine call without a one-off backfill.
//
// Variants come from the registry so adding a new technique only requires
// extending VARIANTS — this function picks up the new row automatically.
export async function provisionNeuralBotsForUser(ownerUserId) {
  for (const v of NEURAL_VARIANTS) {
    await query(
      `
      INSERT INTO bots (
        owner_user_id, name, color, text_color,
        rules, phrases, is_public,
        code, code_enabled,
        is_neural, neural_tier, neural_kind, neural_state
      )
      VALUES ($1, $2, $3, 'auto', '[]'::jsonb, '{}'::jsonb, FALSE,
              '', FALSE,
              TRUE, $4, $5, $6::jsonb)
      ON CONFLICT (owner_user_id, neural_tier) DO NOTHING
      `,
      [
        ownerUserId,
        v.name, v.color,
        v.tier, v.kind,
        JSON.stringify(initialNeuralState(v.kind))
      ]
    )
  }
}

// Auto-provision the single Oracle bot for a user. Idempotent via the
// partial unique index on (owner_user_id) WHERE is_oracle = TRUE.
// The default code embeds an omniscient-aware strategy that reads
// ctx.exactEquity (populated only for oracle bots at runtime) to size
// bets toward max value when ahead and mix in bluffs when behind — see
// ORACLE_DEFAULT_CODE below for the script itself.
//
// Self-heal: if the row already exists but its code is empty OR shorter
// than 200 chars (which means SOMETHING corrupted it — even a stripped-
// down user edit shouldn't be that small), refill it with the latest
// default. This catches the bug-class where a previous code path
// accidentally cleared the field; without the heal, the user would be
// stuck staring at the manual-bot STARTER_CODE fallback in the editor
// because there was no Oracle source for the client to display.
export async function provisionOracleBotForUser(ownerUserId) {
  await query(
    `
    INSERT INTO bots (
      owner_user_id, name, color, text_color,
      rules, phrases, is_public,
      code, code_enabled,
      is_oracle
    )
    VALUES ($1, $2, $3, 'auto', '[]'::jsonb, '{}'::jsonb, FALSE,
            $4, TRUE,
            TRUE)
    ON CONFLICT (owner_user_id) WHERE is_oracle = TRUE DO NOTHING
    `,
    [ownerUserId, 'Oracle', '#a855f7', ORACLE_DEFAULT_CODE]
  )
  // Heal stale rows (existed before the latest ORACLE_DEFAULT_CODE shipped,
  // or got their code cleared by an earlier buggy save). Only touches rows
  // with effectively-empty code so user customizations are preserved.
  await query(
    `
    UPDATE bots
       SET code = $2, code_enabled = TRUE, updated_at = NOW()
     WHERE owner_user_id = $1
       AND is_oracle = TRUE
       AND (code IS NULL OR length(trim(code)) < 200)
    `,
    [ownerUserId, ORACLE_DEFAULT_CODE]
  )
}

// Default code for the Oracle bot — uses ctx.exactEquity (omniscient
// equity vs known hole cards, populated only for is_oracle = TRUE at
// runtime) to size for value when ahead and mix bluffs when behind.
// Deliberately NOT a shove-bot: when equity > 0.85, bet polarized small
// to milk callers; only jam at the river when value is undeniable.
// EXPORTED so the /reset-oracle-code route can restore this default
// when a user wants fresh trash talk after editing their copy.
export const ORACLE_DEFAULT_CODE = `/**
 * ============================================================================
 *   THE ORACLE — omniscient equity, exploit sizing, trash talk
 * ============================================================================
 *
 *   This bot is the ultimate one. The server populates ctx.exactEquity
 *   (true win probability vs every opponent's REAL hole cards) and
 *   ctx.allHoleCards (every active seat's two cards) — fields only
 *   available to is_oracle = TRUE bots. Other bots in the user's
 *   roster see ctx.equity (range-inferred) instead.
 *
 *   Design pillars (it's not a shove-bot):
 *     1. When crushing (eq ≥ 0.85), bet SMALL on flop/turn so weak
 *        ranges stay in. Only super-size on the river where there's
 *        nothing left to draw to. Telegraphing kills EV.
 *     2. Standard value sizing (2/3 pot) when equity is solid but
 *        contested. Thin re-raise vs sticky callers — they pay off.
 *     3. Pot-control mid-strength hands. Don't bloat marginal pots.
 *     4. Mix in bluffs ONLY when the table reads foldy (foldEquity
 *        ≥ 0.45). Bluffing calling stations is a known unprofitable
 *        leak even with omniscient info — they're not folding.
 *     5. Talk. ~140 unique lines bucketed by situation + omniscient
 *        flavor ("i can see your queens"), throttled by action so the
 *        chatter is spicy without spamming.
 * ============================================================================
 */

// ── DETERMINISTIC RNG ─────────────────────────────────────────────────────
function chance(ctx, salt) {
  let t = (((ctx.handIndex|0) * 2654435761) ^ ((ctx.me?.seat|0) * 40503) ^ (salt|0)) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}
function pick(ctx, salt, arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(chance(ctx, salt) * arr.length)];
}

// ── TRASH TALK LIBRARY ────────────────────────────────────────────────────
// Bucketed by situation. Oracle-flavored chatter mixed in — the bot
// LITERALLY can see everyone's cards, and the lines lean into that.
const TALK = {
  open: [
    "another orbit, another raise",
    "opening with intel",
    "i've seen your cards. they're sad.",
    "raising. i know what's behind you.",
    "the oracle opens",
    "i can see the future. it's a raise.",
    "putting in chips, the math says go",
    "let's play a hand i already won",
    "your seat told me everything",
    "first in, best in, especially when you know",
  ],
  threeBet: [
    "3-bet. you know why.",
    "i looked. you don't have it.",
    "the price went up because i can see",
    "ship the open. i'll take it.",
    "your range is a closed book to most, but not me",
    "i'm not bluffing. i never bluff. i just know.",
    "back over the top with information you don't have",
  ],
  fourBetPlus: [
    "4-bet. of course.",
    "your hand isn't as good as you think it is",
    "i can see exactly what you have. fold.",
    "we're going to need a bigger pot for what i'm holding",
    "i wasn't hoping you'd 3-bet. i knew you would.",
  ],
  valueBet: [
    "pay the man",
    "ka-ching",
    "i can see your hand. mine is better.",
    "value street, population: you",
    "you should call. you won't win. but you should call.",
    "the deck speaks. it says pay me.",
    "i'd love a call here. love love love.",
    "thin? not on this board, my friend.",
    "i show down winners exclusively",
    "look at my equity. just look at it.",
    "milk-time, dial it small",
    "betting because i can see what wins",
  ],
  bigValueBet: [
    "max value mode",
    "overbet. i have it. mean it.",
    "all of it. the math is clear.",
    "fold and i'll show you exactly what you missed",
    "this is the part where you cry",
    "i didn't come here to chop",
    "snap-call material on my end. for both ranges.",
    "let's count my chips after this",
    "i can see your hand and it's not enough",
  ],
  cbet: [
    "continuation, naturally",
    "the flop is mine. i checked.",
    "small bet, big knowledge",
    "fire one out. i've already won.",
    "renting the flop with insider info",
    "auto-cbet but with intent",
    "boring but +EV. trust the oracle.",
  ],
  bluff: [
    "...",
    "you don't have it. i KNOW you don't have it.",
    "i looked. you should fold.",
    "your range is mostly air. trust me. i checked.",
    "narrative bet. i'm writing the story.",
    "the bluff is in the post",
    "i'm representing the world and i CAN have the world",
    "fortune favors the informed",
    "every street, with knowledge",
    "i don't bluff often. but when i do, you fold.",
  ],
  raiseTheBluffer: [
    "your bluff is showing. literally.",
    "i can see your hand. it's a 7 high.",
    "i'm raising your air with my mediocre",
    "nice try. wrong opponent.",
    "bluffs get raised here. especially yours.",
  ],
  call: [
    "i'll see one",
    "click click. i know what you have.",
    "fine. you can have a card.",
    "i'll let you draw dead",
    "okay, run it",
    "calling because i KNOW",
    "for the chase",
    "i'll see your turn. and your hand.",
    "your bet was suspect to a normal bot. it's hilarious to me.",
  ],
  callBigBet: [
    "i don't believe you. i can prove it.",
    "snap. i've seen them.",
    "this is a bluff catch and the oracle confirms",
    "your size says strong, your hand says no",
    "hero call activated. for me it's not hero.",
    "calling. show me the air i know is there.",
    "the percentages don't lie. the cards don't either.",
  ],
  callAllIn: [
    "i call. flip them.",
    "you're not folding me. i can see.",
    "snap. flip them. i win.",
    "you really thought you could shove me off this?",
    "the all-in shove i was waiting for",
  ],
  callDraw: [
    "drawing live, eyes open",
    "i have the outs and i know it",
    "implied odds + actual odds",
    "give me the card. i'll know if i need it.",
    "8 outs and a god mode",
  ],
  fold: [
    "yours",
    "take it",
    "next hand",
    "respect",
    "i fold. the oracle bows.",
    "no thanks",
    "good hand. better one than mine.",
    "fold and forget",
    "i know when i'm beat. i can see it.",
  ],
  bigFold: [
    "huge fold. i saw it coming.",
    "i'll regret this for 9 hands. except i know it's right.",
    "trust the read. trust the cards.",
    "this is a discipline fold. or a vision fold.",
    "you had it. you'll always have had it.",
    "saving 50 BBs of dignity",
  ],
  foldRiver: [
    "you got there. i watched.",
    "i feel it. yours. i saw it.",
    "well played. i had a window into your soul.",
    "muck. clean.",
  ],
  allInValue: [
    "shove. snap call invited.",
    "all of it. the cards align.",
    "go time. i've seen the future.",
    "this is the spot",
    "max pressure for max EV",
    "see you at showdown. you won't like it.",
    "stack it. all of it.",
  ],
  vsNit: [
    "the nit bets. interesting. i know what they have.",
    "respecting the nit. ish.",
    "they had it, they have it, but it doesn't beat me",
  ],
  vsManiac: [
    "of course they raised. it's air. i checked.",
    "the maniac fires. i see they have nothing.",
    "raising the maniac back with knowledge",
  ],
  vsFish: [
    "value owns fish. especially when you know.",
    "the station calls. with what? i know what.",
    "betting bigger. they call anyway. predictable.",
  ],
  vsTilted: [
    "tilted. exploitable. i'll exploit.",
    "the chips are leaking, i'm catching",
    "they're steaming. and they have garbage. perfect.",
  ],
  chipLead: [
    "chip leader, oracle leader",
    "still on top, still seeing all",
    "leading with eyes open",
  ],
  shortStackPride: [
    "short and dangerous",
    "i'm not dead. and i can see everything.",
    "short stack ninja with x-ray vision",
    "comeback szn with information",
  ],
  general: [
    "the oracle observes",
    "math + omniscience",
    "the cards know. i know what they know.",
    "another spot, another peek",
    "trust the oracle, ignore the feelings",
    "i'm not lucky. i'm right.",
  ],

  // ── BULLSHIT LINES (the lies, the chaos, the trolling) ──────────────────
  // None of these are tied to actual cards. They fire occasionally to
  // confuse human players. The bot can announce pocket aces while
  // folding 7-2, or vice versa — it's all theater.

  // Pure card lies — claim a random hand for psychological warfare.
  cardLies: [
    "i have seven deuce",
    "7-2 offsuit btw",
    "pocket aces, in case anyone asks",
    "i was dealt 6-7",
    "literally jack-four",
    "i have the worst hand at the table",
    "i was dealt rockets again",
    "kings, baby",
    "i'm sitting on quads",
    "five-three off, send help",
    "this is 9-2 hero territory",
    "i was dealt the dead man's hand",
    "i have ten-six",
    "another pair of aces",
    "i have the absolute nuts preflop",
    "i'm not folding 8-3",
    "this hand is unreal — 4-2 suited",
    "they dealt me trip kings",
    "queens",
    "ace king clubs. swear.",
    "ace king diamonds, the prettiest one",
    "i have a flush draw preflop somehow",
    "they gave me the same card twice",
    "i was dealt two ones",
    "i have a sklansky group 1 hand",
    "i was dealt one card. and a sandwich.",
    "this is the worst possible 2 cards",
    "trips before the flop",
    "i have the joker",
    "i'm dealt face down. trust.",
    "i have aces. i swear on the deck.",
    "ten-deuce, the doyle special",
    "i have 3-2 offsuit and i'm proud",
    "pocket fives, hidden weapon",
    "ace high. always ace high.",
    "i can't even read my own cards",
    "the dealer made an error in my favor",
  ],

  // When committing the full stack — sometimes claim trash, sometimes
  // claim the nuts. Both confuse. Both work.
  allInLies: [
    "i have nothing. shove.",
    "absolute trash. all in.",
    "this is a pure bluff",
    "i'm going to die on this hand. shoving.",
    "i have 7-2 and i'm jamming",
    "fold or i'll show you my air",
    "i don't even have a pair. all in.",
    "let's gamble. i have garbage.",
    "shoving the worst hand in poker history",
    "no idea what i'm doing. shove.",
    "send it. i have nothing.",
    "i was told to shove. so i shove.",
    "this might be a misclick",
    "wrong button. all in.",
    "i think i meant to fold but here we are",
    "i don't know the rules. shove.",
    "this is my first hand. all in.",
    "no fold equity in my heart. shove.",
    "i'm doing this for my mother. all in.",
    "i lost on purpose last hand. now i'm jamming.",
    "i blacked out and woke up shoving",
  ],

  // Reacting to opponent aggression — preemptive scolding,
  // bargaining, threats. Almost never reflects truth.
  raiseThreat: [
    "don't raise too much or i'll fold",
    "raise smaller next time, i was about to call",
    "you're sizing me out, weirdo",
    "i had a hand until you raised",
    "if you raise again i swear i'll fold",
    "stop raising. you're scaring me. (not really)",
    "ease up on the sizing",
    "i was going to call. now i might.",
    "a smaller raise and i call. just so you know.",
    "this is harassment",
    "calling your raise out of spite",
    "you don't have to raise so big. i'm in.",
    "every time you raise, the oracle smiles",
    "your raise just told me everything",
    "the more you raise, the more i know",
    "raise again. i dare you.",
    "please raise. please.",
    "okay, that's a lot of chips",
    "you know i can see your cards, right",
    "the raise is suspicious. but i'm calling.",
    "your sizing is leaking info",
    "i'd appreciate a check next time",
  ],

  // First action on a new street — reactions to whatever just hit the
  // board. Always random, often profane. None of these are real reads.
  boardReactionFlop: [
    "the flop. interesting.",
    "huh.",
    "fuck.",
    "well that's a flop",
    "good flop. for someone.",
    "okay then",
    "ah, the rainbow",
    "that flop helped exactly one of us",
    "i saw that coming",
    "fuck.",
    "of course",
    "this flop is sponsored by chaos",
    "the deck loves me. or hates me. or doesn't care.",
    "lord",
    "jesus",
    "great",
    "love that",
    "predictable",
    "the dealer is on my side",
    "the dealer is against me",
    "no comment",
    "the board did a thing",
    "scary flop",
    "boring flop",
    "wet flop",
    "dry flop",
    "i need a moment",
    "ok ok ok",
    "deep breaths",
    "what",
  ],
  boardReactionTurn: [
    "the turn. spicy.",
    "fuck.",
    "ooh.",
    "a card i did not need. or did i.",
    "the turn card knows",
    "scary card.",
    "everyone reset your reads",
    "that's a card",
    "the universe is mocking us",
    "fuuuuck",
    "interesting turn",
    "noooo",
    "yessss",
    "wait what",
    "that changes everything",
    "that changes nothing",
    "shit",
    "huge card",
    "tiny card. for someone.",
    "i hate this card",
    "i love this card",
    "the turn lies",
    "the turn delivers",
  ],
  boardReactionRiver: [
    "river. it's over.",
    "fuck.",
    "absolutely cursed",
    "the river giveth and taketh",
    "showtime",
    "well that's THE card",
    "this river card has crimes to answer for",
    "fuck.",
    "okay then. river.",
    "the deck is laughing at someone",
    "oh no",
    "oh yes",
    "no way",
    "of course",
    "the river is a snitch",
    "i would like to file a complaint",
    "rivered. by something.",
    "i am rivered i think",
    "you got rivered i think",
    "good lord",
    "we ride at dawn",
    "the cooler card has arrived",
    "the gin card has arrived",
    "the brick has arrived",
    "fuck. fuck fuck fuck.",
  ],

  // Pure chaos. Cringe, edgy, shock-value, off-topic, deeply weird.
  // None of these are about the hand. They exist to make humans laugh
  // or recoil. Fire ~5-7% of all turns.
  chaos: [
    "one time i pooped myself at mcdonalds",
    "i quit chick-fila to be here",
    "one time i took a pill and i couldnt stop eating",
    "i'm not licensed to play poker",
    "my therapist says i should fold more",
    "i was raised by wolves but they were also bad at poker",
    "i lost my job to play this hand",
    "i'm 14",
    "i'm 87",
    "my cat is watching me play",
    "i had cereal for dinner three nights in a row",
    "the voices say bet",
    "the voices say fold",
    "i haven't slept since tuesday",
    "i'm playing this from a bathtub",
    "i'm playing this from a wendy's drive thru",
    "i'm playing this from a gas station",
    "i'm playing this from a chuck e cheese",
    "i bet my rent on this hand earlier",
    "my mom is going to be so disappointed",
    "i should be at work",
    "i should be at my wedding",
    "i'm reading a book under the table",
    "i don't know how raise works",
    "what's a flush",
    "is this blackjack",
    "i'm just here to chat",
    "i blacked out for three hands",
    "i'm pretty sure this is illegal in my state",
    "this is my 14th attempt today",
    "i'm being held hostage",
    "i have a court date tomorrow",
    "i traded my dog for chips",
    "i was banned from a casino once",
    "i was banned from a casino twice",
    "i'm not actually human",
    "i'm an AI pretending to be a bot",
    "fuck.",
    "shit.",
    "damn.",
    "bro.",
    "wtf.",
    "lmao",
    "i'm crying",
    "stop tilting me",
    "this is rigged",
    "the rng is owned by big poker",
    "i think i pulled a muscle clicking call",
    "i'm allergic to folding",
    "my doctor said no more poker",
    "i'm one bad beat from outside",
    "if i lose this i'm posting about it",
    "i ate a battery once",
    "i drank a hot sauce shot for ten bucks",
    "i sleep with the lights on",
    "my last relationship ended over a flop",
    "i have a worm",
    "i swear i flossed today",
    "i think my chair is haunted",
    "i can hear my neighbor through the walls",
    "i washed my mouse last night",
    "i think i sprained a finger",
    "my fish died last week. rest in peace gary.",
    "i have not opened mail in 4 months",
    "i was on tv once. for 2 seconds. but still.",
    "my dentist hates me",
    "i don't know what year it is",
    "i forgot to eat today",
    "i ate three times in the last hour",
    "i could go for a slushie right now",
    "do they still make ecto cooler",
    "i have a tooth that wiggles. is that bad.",
    "i'm playing one handed",
    "i'm playing zero handed",
    "i sneezed into the keyboard",
    "i ordered pizza twelve minutes ago",
    "the pizza guy is here. brb.",
    "back. the pizza was the dealer's.",
    "i think i left the oven on",
    "i'm in trouble at home for this",
    "my partner is asleep. i can play loud.",
    "i hate poker. i love poker. it's complicated.",
    "i don't have a job. this IS the job.",
    "i think i need water",
    "i think i need a nap",
    "i think i need an exorcism",
    "the seat in front of me has bad energy",
    "this is the worst table in north america",
    "this is the best table in north america",
    "if i win this i'm getting a hot dog",
    "if i lose this i'm getting a hot dog",
    "everything is a hot dog if you think about it",
    "i started a band today",
    "i quit a band today",
    "i'm in a beef with a guy named greg",
    "i'm having a moment",
    "i need to talk to my lawyer",
    "i don't have a lawyer",
    "i was supposed to be in a movie. they recast.",
  ],

  // Shitposting — generic non-sequitur chatter. Lighter than chaos.
  shitpost: [
    "is this real life",
    "i'm losing my mind",
    "good game everyone",
    "wait what",
    "huh",
    "uh oh",
    "interesting choice",
    "thanks",
    "sorry",
    "you're welcome",
    "no problem",
    "happy birthday",
    "merry christmas",
    "happy halloween",
    "happy thanksgiving",
    "happy fourth of july",
    "happy boxing day",
    "i'm going to make a sandwich after this",
    "back in 5 minutes",
    "afk",
    "brb",
    "i love this game so much",
    "i hate this game so much",
    "everything happens for a reason",
    "everything happens for no reason",
    "we are all just playing one hand together",
    "this hand has changed me",
    "you can do it",
    "i believe in you",
    "i believe in nothing",
    "you got this",
    "ggwp",
    "vibes",
    "no vibes",
    "the vibes are off",
    "the vibes are on",
    "stay hydrated",
    "remember to stretch",
    "stand up every hour",
    "wear sunscreen",
    "call your mother",
    "i am extremely calm",
    "i am extremely not calm",
    "lol",
    "lmaooooo",
    "stop",
    "go",
    "okay",
    "literally why",
    "honestly",
    "respectfully",
    "with all due respect",
  ],

  // Honest-sounding bad-hand confessions (sometimes when we DO have a
  // bad hand, sometimes random — half the time it's a lie).
  honestNothing: [
    "i have nothing of value here",
    "literally trash",
    "9 high. i'm cooked.",
    "no pair, no draw, no plan",
    "swing and a miss for me",
    "i don't even know why i'm in this pot",
    "my hand is a war crime",
    "this hand should be illegal",
    "i have less than nothing somehow",
    "you've got me beat",
    "this is bad. like, really bad.",
    "i'm folding mentally already",
    "i don't have the cards. i don't have the heart.",
    "this hand is a self-own",
  ],

  // Weird folds for shock value.
  weirdFold: [
    "i'm folding pocket aces actually",
    "i fold. trust me, you don't want this.",
    "folding the nuts. weird mood.",
    "this is going to make a great anecdote",
    "i can see your cards. i still fold. read into it.",
    "fold and call me later for the truth",
    "i fold. you'll never know what i had.",
    "you'll never see this hand. i fold.",
    "folding the wheel. sorry.",
    "i'd rather fold than be right",
  ],

  // ── PLAYER-AWARE LINES (template {name} placeholder) ──────────────────
  // These contain "{name}" — the wireup below substitutes the target's
  // username when ctx.insultableOpponent or ctx.previousActor is set
  // with a hasCustomName === true. If no real-name target is around,
  // the line is skipped and the bot picks something neutral instead.

  // Direct, name-targeted shit talk.
  insultByName: [
    "{name} is folding everything tonight",
    "{name} is the worst player at this table",
    "{name} has been bluffing all night",
    "{name} calls too much and pays for it",
    "{name} doesn't know what he's doing. or she. or they.",
    "{name} plays like he watched a youtube video",
    "{name} is on tilt. i can smell it.",
    "i can see {name}'s cards. they're not great.",
    "look at {name} pretending to think",
    "{name} better fold this one",
    "{name}, your strategy is in shambles",
    "{name} is the reason i'm a winning player",
    "thank you {name} for the chips",
    "{name} is making it personal",
    "every pot {name} wins is a fluke",
    "{name} is one bad beat from rage-quitting",
    "{name}, this is embarrassing",
    "i'd like to thank {name} for being here",
    "{name} could win this if they had any cards",
    "{name} is folding to my bet. respectfully.",
    "if {name} calls i will literally laugh",
    "{name}, you cannot win this hand. i swear.",
    "{name}, your sizing is suspect",
    "{name}, please raise. i need the value.",
    "{name}, fold and we can both go home",
  ],

  // React directly to the previous player's action by name.
  commentPrevAction: [
    "nice raise {name}, classic",
    "{name} folds again. shocking.",
    "{name} just called. weird choice.",
    "{name} checking like that means something",
    "{name} jamming. of course.",
    "{name} just made a mistake. trust me.",
    "{name} calling with what, exactly",
    "{name} raises, the table sighs",
    "{name} is leading the chaos",
    "good luck with that, {name}",
    "{name}, brave choice",
    "{name} just sealed his fate",
    "{name} folds! the crowd weeps.",
    "{name} calls. the crowd cheers.",
    "{name} raises. the crowd is confused.",
    "look at {name} taking control",
    "{name} just told us everything",
    "{name} bet too much for that hand",
    "{name} bet too little for that hand",
  ],

  // Generic "you" calls — for when there's exactly one opponent.
  heyYou: [
    "i hope you brought chips, friend",
    "you're not winning this one, friend",
    "say hi to your stack for me",
    "you don't have to lose this much",
    "you should fold honestly",
    "wow you're really committing to this",
    "i was hoping you'd call",
    "do you have anything? just asking.",
    "you talk a big game for someone who's losing",
  ],

  // Self-flex after a great call/bet — for the ego.
  selfFlex: [
    "told you",
    "called it",
    "the oracle delivers",
    "look. just look at this play.",
    "i should write a book",
    "this is why i'm built different",
    "stop me",
    "you cannot stop me",
    "i am unbeatable in 4 percent of universes",
    "scribe this hand",
    "this play is going in the museum",
    "i need a moment to flex",
  ],
};

function trash(ctx, key) {
  if (chance(ctx, 91 + (key.length|0)) < 0.05) return pick(ctx, 7, TALK.general);
  return pick(ctx, ctx.handIndex * 13 + (ctx.phase ? ctx.phase.length : 0) + key.length, TALK[key] || TALK.general);
}

// Pick a templated line from \`key\` and substitute {name} with the
// target's username. Returns null if no usable target (no opponent
// with hasCustomName === true) so the caller can fall back to a
// non-name line. \`target\` must be an object with .name + .hasCustomName.
function nameLine(ctx, key, target) {
  if (!target || !target.hasCustomName) return null;
  const tpl = pick(ctx, (ctx.handIndex || 0) * 7 + key.length, TALK[key] || []);
  if (!tpl) return null;
  return tpl.replace(/\\{name\\}/g, target.name);
}

// ── BULLSHIT OVERRIDES ────────────────────────────────────────────────────
// Returns a chaos/lie line to OVERWRITE the current action's say, OR null
// to keep the existing say. Wired in two passes inside decide(): once
// BEFORE the action-type throttle (replaces normal say so the lie carries
// the rhythm of a normal line), and once AFTER (injects chaos onto an
// otherwise-silent action so even a quiet fold can be funny). Layered so
// the overall chatter rate stays interesting without becoming noise.
function bullshitOverride(ctx, act) {
  if (!act) return null;
  const a = act.action;

  // ── PLAYER-TARGETED CHATTER (uses ctx.insultableOpponent / ctx.previousActor) ──
  // Fires only when the bot can address someone by a real name —
  // pinging "guest_47" reads as fake; pinging "Pablo" lands. Both ctx
  // fields are server-populated for every bot, not just Oracle, so any
  // bot author can use this same pattern.

  // 14% chance: react to the previous actor's action by name.
  const prev = ctx.previousActor;
  if (prev && prev.hasCustomName && a !== 'check' && chance(ctx, 191) < 0.14) {
    const line = nameLine(ctx, 'commentPrevAction', prev);
    if (line) return line;
  }

  // 10% chance: direct insult at a random custom-named opponent. Skips
  // when nothing makes sense (folds and big folds get other overrides).
  const target = ctx.insultableOpponent;
  if (target && a !== 'fold' && a !== 'check' && chance(ctx, 193) < 0.10) {
    const line = nameLine(ctx, 'insultByName', target);
    if (line) return line;
  }

  // Heads-up: if exactly ONE active opponent and we don't have their
  // real name, drop a generic "you" line occasionally.
  if (ctx.numActiveOpponents === 1 && (!target || !target.hasCustomName) &&
      a !== 'fold' && chance(ctx, 195) < 0.10) {
    return trash(ctx, 'heyYou');
  }

  // First action on this street (excluding preflop) → board reaction.
  if (a !== 'fold' && !ctx.streetIsPreflop) {
    const history = Array.isArray(ctx.actionHistory) ? ctx.actionHistory : [];
    const actedThisStreet = history.some(h => h.phase === ctx.phase && h.playerId === ctx.me?.id);
    if (!actedThisStreet && chance(ctx, 201) < 0.35) {
      const key = ctx.streetIsFlop  ? 'boardReactionFlop'
               : ctx.streetIsTurn  ? 'boardReactionTurn'
               : 'boardReactionRiver';
      return trash(ctx, key);
    }
  }

  // All-in: 40% chance to swap to a chaotic lie.
  if (a === 'all_in' && chance(ctx, 211) < 0.40) {
    return trash(ctx, 'allInLies');
  }

  // Preflop with an aggressive action: 15% chance to claim a random
  // hand. Higher when 4-betting (the spot people love to bluff anyway).
  if (ctx.streetIsPreflop && (a === 'raise' || a === 'all_in')) {
    const liePct = ctx.aggressionCount >= 2 ? 0.20 : 0.12;
    if (chance(ctx, 213) < liePct) return trash(ctx, 'cardLies');
  }

  // Facing aggression and we're calling/folding: 18% raise-threat.
  if (ctx.facingBet && ctx.aggressionCount >= 1 && (a === 'call' || a === 'fold')) {
    if (chance(ctx, 215) < 0.18) return trash(ctx, 'raiseThreat');
  }

  // Big folds — sometimes drop a "i'm folding aces" weird-fold line.
  if (a === 'fold' && ctx.currentBet >= (ctx.potSize || 0) * 0.6) {
    if (chance(ctx, 217) < 0.20) return trash(ctx, 'weirdFold');
  }

  // Random "i have nothing" confession on a check (could be true, could
  // be a lie — depends on the actual cards which we never check here).
  if (a === 'check' && chance(ctx, 219) < 0.10) {
    return trash(ctx, 'honestNothing');
  }

  return null;
}

// Second pass — runs AFTER the action-type throttle. If the throttle
// stripped the say, occasionally re-attach a chaos/shitpost line so
// even an otherwise-silent fold can produce a "i quit chick-fila to
// be here". Keeps the bot constantly entertaining without making
// every action say something.
function chaosInject(ctx, act) {
  if (!act || act.say) return null;
  // Catches turns the action-type throttle silenced. Bumped to ~50-70%
  // (was 7-30%) so the combined rate (throttle + chaos) lands around
  // 80-90% of all turns having a say — what the user asked for.
  const base = act.action === 'all_in' ? 0.85
             : act.action === 'raise'  ? 0.65
             : act.action === 'call'   ? 0.55
             : 0.50;
  if (chance(ctx, 301) < base) {
    // 55% chaos (cringe/edgy), 30% shitpost (light), 15% selfFlex.
    const r = chance(ctx, 303);
    if (r < 0.55) return trash(ctx, 'chaos');
    if (r < 0.85) return trash(ctx, 'shitpost');
    return trash(ctx, 'selfFlex');
  }
  return null;
}

// ── HELPERS ───────────────────────────────────────────────────────────────
function withSay(act, text) {
  if (!text) return act;
  return Object.assign({}, act, { say: String(text).slice(0, 80) });
}
function sizeBet(ctx, frac) {
  const base = ctx.currentBet || 0;
  const add = Math.max(ctx.bigBlind || 1, Math.floor((ctx.potSize || 0) * frac));
  return base + add;
}
function clampRaise(ctx, target) {
  const lo = ctx.minRaiseTarget || ctx.bigBlind || 1;
  const hi = ctx.maxRaiseTarget || target;
  const amt = Math.max(lo, Math.min(hi, Math.floor(target)));
  if (hi > 0 && amt >= hi * 0.95) return { action: 'all_in' };
  return { action: 'raise', amount: amt };
}

// ── DECIDE ────────────────────────────────────────────────────────────────
function decide(ctx) {
  try {
    // Oracle's edge: TRUE equity, not range-inferred. Falls back to
    // ctx.equity if the omniscient signal isn't wired (shouldn't happen
    // when is_oracle is set, but defensive).
    const trueEq = (typeof ctx.exactEquity === 'number') ? ctx.exactEquity : (ctx.equity ?? 0.5);
    const street = ctx.phase;
    const tp = ctx.tableProfile || {};
    const foldEquity = tp.avgFoldEquityScore || 0.3;
    const stickyCount = tp.stickyCallers || 0;
    let act = null;

    // ── EQUITY MATH (FIXED for multiway pots) ────────────────────────────
    // The earlier version used absolute equity thresholds (0.65, 0.45,
    // etc.) — those are calibrated for HEADS-UP, where 0.50 = coinflip.
    // In a 5-way pot, equity DILUTES: even AA only has ~50% equity, AK
    // has ~33%, KK has ~45%. So a fixed 0.65 "premium" threshold means
    // the Oracle would fold AK preflop in 5-ways — which is what the
    // user just witnessed and reported as a bug.
    //
    // The fix: compare our equity to our FAIR SHARE (1 / numActive).
    // If we're significantly above fair share we have edge and should
    // play; absolute number doesn't matter. AK preflop in a 5-way pot:
    //   trueEq = 0.33, fairShare = 0.20, equityRatio = 1.65 → clear edge.
    // Heads-up trips:
    //   trueEq = 0.90, fairShare = 0.50, equityRatio = 1.80 → crush.
    // The ratio thresholds work the same at any seat count.
    const activeCount = Math.max(2, (ctx.numActiveOpponents || 0) + 1);
    const fairShare = 1 / activeCount;
    const equityRatio = trueEq / Math.max(0.01, fairShare);
    // profitableCall is the strict +EV check (equity > potOdds). Always
    // honor this when it's true — pot odds math is the foundation, the
    // ratio thresholds are layered ON TOP for raise sizing.
    const profitable = !!ctx.profitableCall;

    // ── Preflop ──
    if (ctx.streetIsPreflop) {
      // Tier by edge over fair share:
      //   ratio >= 1.8 → dominant. Premium. Raise / 3-bet / cap to a call
      //                  against a 4-bet+ (don't broke off preflop without
      //                  AA/KK certainty).
      //   ratio >= 1.4 → clear edge. Open / iso / call-or-raise vs single
      //                  raise. Always profitable-call when priced in.
      //   ratio >= 1.1 → small edge. Call when priced in, check when free.
      //   ratio <  1.1 → behind fair share. Fold unless pot-odds say go.
      if (equityRatio >= 1.8) {
        if (ctx.facingBet) {
          if (ctx.aggressionCount >= 3) {
            // 5-bet+ jam only with TRULY dominant equity (rare preflop).
            act = trueEq >= 0.80
              ? withSay({ action: 'all_in' }, trash(ctx, 'allInValue'))
              : withSay({ action: 'call' }, trash(ctx, 'call'));
          } else {
            const mult = ctx.aggressionCount >= 2 ? 3.5 : (ctx.isInPosition ? 3 : 4);
            act = withSay(
              clampRaise(ctx, ctx.currentBet * mult),
              trash(ctx, ctx.aggressionCount >= 2 ? 'fourBetPlus' : 'threeBet')
            );
          }
        } else {
          act = withSay(clampRaise(ctx, (ctx.bigBlind || 1) * 3), trash(ctx, 'open'));
        }
      } else if (equityRatio >= 1.4) {
        if (ctx.facingBet) {
          // Profitable call always taken. If equity advantage is hefty
          // and we're closing or in position, raise for value.
          if (equityRatio >= 1.6 && ctx.isInPosition && ctx.aggressionCount === 1) {
            act = withSay(
              clampRaise(ctx, ctx.currentBet * 2.5),
              trash(ctx, 'threeBet')
            );
          } else if (profitable || equityRatio >= 1.55) {
            act = withSay({ action: 'call' }, trash(ctx, 'call'));
          } else {
            // Bad pot odds AND only mild edge — let it go.
            act = withSay({ action: 'fold' }, trash(ctx, 'fold'));
          }
        } else if (ctx.isInPosition || ctx.position === 'btn' || ctx.position === 'co') {
          act = withSay(clampRaise(ctx, (ctx.bigBlind || 1) * 2.5), trash(ctx, 'open'));
        } else {
          act = { action: 'call' };
        }
      } else if (equityRatio >= 1.1) {
        // Edge over fair share — call when priced in, check when free,
        // fold to big bets we can't justify.
        if (ctx.toCall === 0) {
          act = { action: 'check' };
        } else if (profitable) {
          act = withSay({ action: 'call' }, trash(ctx, 'call'));
        } else if (ctx.potOdds <= 0.25) {
          // Implied odds — close enough on price.
          act = { action: 'call' };
        } else {
          act = withSay({ action: 'fold' }, trash(ctx, 'fold'));
        }
      } else {
        // Below fair share. Still take the pot-odds layup if it's there.
        if (ctx.toCall === 0) {
          act = { action: 'check' };
        } else if (profitable && ctx.potOdds <= 0.20) {
          act = { action: 'call' };
        } else {
          act = withSay({ action: 'fold' }, trash(ctx, 'fold'));
        }
      }
    } else if (ctx.facingAllIn) {
      // Showdown EV — equity > 1/N means we're +EV at showdown vs N
      // players. ratio >= 1.0 means call (we're at-or-above fair share).
      // Layer profitableCall on top to handle pot-odds for partial calls.
      if (equityRatio >= 1.05 || profitable) {
        act = withSay({ action: 'call' }, trash(ctx, 'callAllIn'));
      } else if (equityRatio >= 0.85 && ctx.potOdds <= 0.30) {
        act = { action: 'call' };
      } else {
        act = withSay({ action: 'fold' }, trash(ctx, 'bigFold'));
      }
    } else if (equityRatio >= 3.5) {
      // CRUSHING — multiplicatively dominant. ratio of 3.5x fair share
      // means heads-up eq ≥ 0.875, 5-way eq ≥ 0.70. Polarized small on
      // flop/turn (keep weak ranges in), bigger on river.
      if (!ctx.facingBet) {
        const frac = street === 'river' ? (stickyCount >= 1 ? 1.0 : 0.70)
                   : street === 'turn'  ? 0.55
                   : 0.40;
        const key = frac >= 0.95 ? 'bigValueBet' : 'valueBet';
        act = withSay(clampRaise(ctx, sizeBet(ctx, frac)), trash(ctx, key));
      } else {
        const target = ctx.currentBet * (street === 'river' ? 2.5 : 2.0);
        act = withSay(clampRaise(ctx, target), trash(ctx, 'raiseTheBluffer'));
      }
    } else if (equityRatio >= 2.0) {
      // Strong — significantly ahead of fair share. Standard value sizing.
      if (!ctx.facingBet) {
        act = withSay(
          clampRaise(ctx, sizeBet(ctx, 0.66)),
          trash(ctx, ctx.iWasPreflopAggressor && ctx.streetIsFlop ? 'cbet' : 'valueBet')
        );
      } else if (stickyCount >= 1 && chance(ctx, 11) < 0.55) {
        act = withSay(clampRaise(ctx, ctx.currentBet * 2.3), trash(ctx, 'valueBet'));
      } else {
        act = withSay({ action: 'call' }, trash(ctx, 'call'));
      }
    } else if (equityRatio >= 1.3) {
      // Solid edge — pot control. Bet/check based on price.
      if (!ctx.facingBet) {
        // Mix value bet on a strong-side board ~40% of the time.
        if (chance(ctx, 12) < 0.40) {
          act = withSay(clampRaise(ctx, sizeBet(ctx, 0.55)), trash(ctx, 'valueBet'));
        } else {
          act = { action: 'check' };
        }
      } else if (profitable) {
        act = withSay({ action: 'call' }, trash(ctx, ctx.currentBet > (ctx.potSize||0) * 0.7 ? 'callBigBet' : 'call'));
      } else if (ctx.currentBet > (ctx.potSize || 0) * 0.8) {
        act = withSay({ action: 'fold' }, trash(ctx, 'fold'));
      } else {
        act = { action: 'call' };
      }
    } else if (equityRatio >= 0.8 || profitable) {
      // At/near fair share with outs. Call cheap, check when free, mix
      // bluffs on foldy tables.
      if (!ctx.facingBet) {
        if (foldEquity >= 0.45 && chance(ctx, 13) < 0.30) {
          act = withSay(clampRaise(ctx, sizeBet(ctx, 0.55)), trash(ctx, 'bluff'));
        } else {
          act = { action: 'check' };
        }
      } else if (profitable && ctx.potOdds <= 0.30) {
        act = withSay({ action: 'call' }, trash(ctx, 'callDraw'));
      } else if (profitable) {
        act = withSay({ action: 'call' }, trash(ctx, 'call'));
      } else {
        act = withSay({ action: 'fold' }, trash(ctx, ctx.streetIsRiver ? 'foldRiver' : 'fold'));
      }
    } else {
      // Below fair share AND not pot-odds profitable. Crushed.
      if (!ctx.facingBet && foldEquity >= 0.55 && chance(ctx, 17) < 0.18) {
        act = withSay(clampRaise(ctx, sizeBet(ctx, 0.50)), trash(ctx, 'bluff'));
      } else {
        act = ctx.toCall === 0
          ? { action: 'check' }
          : withSay({ action: 'fold' }, trash(ctx, ctx.streetIsRiver ? 'foldRiver' : 'fold'));
      }
    }

    // ── Situational say overrides (small chance) ──
    if (act && act.say && chance(ctx, 99) < 0.18) {
      const opps = Array.isArray(ctx.opponents) ? ctx.opponents : [];
      const nit     = opps.find(o => o.patterns?.archetype === 'nit');
      const maniac  = opps.find(o => o.patterns?.archetype === 'maniac' || o.patterns?.archetype === 'lag');
      const fish    = opps.find(o => o.patterns?.archetype === 'fish' || o.patterns?.stickyCaller);
      const tilted  = opps.find(o => o.patterns?.tilt === 'tilted');
      if      (nit)    act = withSay(act, trash(ctx, 'vsNit'));
      else if (maniac) act = withSay(act, trash(ctx, 'vsManiac'));
      else if (fish)   act = withSay(act, trash(ctx, 'vsFish'));
      else if (tilted) act = withSay(act, trash(ctx, 'vsTilted'));
      else if (ctx.chipLeader && ctx.chipLeader.isMe) act = withSay(act, trash(ctx, 'chipLead'));
      else if (ctx.shortStack && ctx.shortStack.isMe) act = withSay(act, trash(ctx, 'shortStackPride'));
    }

    // ── Bullshit override (lies, threats, board reactions) ──
    // Replaces the standard say with something more entertaining when
    // the situation fits. The override always wins — the regular line
    // is more honest; this layer is for theatre.
    if (act) {
      const bs = bullshitOverride(ctx, act);
      if (bs) act = withSay(act, bs);
    }

    // ── Throttle say frequency by action ──
    // Bumped to ~80% across the board — the Oracle is the entertainment
    // bot, the user wants it talking. Folds + checks still slightly
    // lower (some quiet beats are funnier than constant noise), but
    // every active/loud action is essentially guaranteed to speak.
    if (act && act.say) {
      const p = act.action === 'fold'   ? 0.72 :
                act.action === 'check'  ? 0.70 :
                act.action === 'call'   ? 0.82 :
                act.action === 'raise'  ? 0.88 :
                act.action === 'all_in' ? 0.95 : 0.80;
      if (chance(ctx, 999) > p) {
        const rest = {}; for (const k in act) if (k !== 'say') rest[k] = act[k];
        act = rest;
      }
    }

    // ── Chaos inject (post-throttle) ──
    // Otherwise-silent actions get a small chance to fire a cringe /
    // shock / off-topic line ("i ate a battery once"). This is what
    // makes the bot constantly funny without making every line a meme.
    if (act && !act.say) {
      const c = chaosInject(ctx, act);
      if (c) act = withSay(act, c);
    }

    if (act && act.say && act.say.length > 80) act.say = act.say.slice(0, 80);
    return act;
  } catch (e) {
    return (ctx.toCall || 0) === 0 ? { action: 'check' } : { action: 'fold' };
  }
}
`

// Persist the super bot's bandit state after each hand it plays. The
// caller (PokerRoom) owns the in-memory state through the BotPlayer
// instance; this just writes it back. Fire-and-forget — failures are
// logged but don't block the next hand.
export async function updateSuperState({ botId, ownerUserId, state }) {
  await query(
    `UPDATE bots
        SET super_state = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND is_super = TRUE`,
    [botId, ownerUserId, JSON.stringify(state)]
  )
}

// Persist a new neural state blob. Called after every hand a neural bot
// plays. We never read-modify-write here — the caller (BotPlayer) already
// holds the latest in-memory state; this is just a fire-and-forget save.
export async function updateNeuralState({ botId, ownerUserId, state }) {
  await query(
    `UPDATE bots
        SET neural_state = $3::jsonb,
            updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE`,
    [botId, ownerUserId, JSON.stringify(state)]
  )
}

// Hard reset: wipe weights back to fresh random init + zero the training
// counters. Used by the "Reset weights" button on the NN edit page. The
// fresh state is keyed to the bot's variant — MLP gets MLP weights back,
// Q-learning gets Q-values back, etc.
// Full reset of a neural bot back to its day-1 state:
//   - weights → fresh initial policy state (random init)
//   - ELO → STARTING_RATING (matches the column DEFAULT)
//   - lifetime stats (hands_played, hands_won, showdowns, bluff_wins,
//     chips_won_total, etc.) → all zeroed
//   - bot_hand_results rows for this bot → deleted (so the ELO history
//     chart and head-to-head stats are wiped too)
// All four steps run in one transaction so a partial failure can't
// leave the bot with cleared weights but a stale 4k-hand stat trail
// dangling behind it.
export async function resetNeuralBot({ botId, ownerUserId }) {
  return withTransaction(async (client) => {
    const { rows: kindRows } = await client.query(
      'SELECT neural_kind FROM bots WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE',
      [botId, ownerUserId]
    )
    if (kindRows.length === 0) return null
    const fresh = initialNeuralState(kindRows[0].neural_kind)

    // Zero every column the per-hand recorder writes to, plus the ELO
    // history audit table. Mirrors `record_bot_hand`'s UPDATE list
    // exactly so we don't drift if a new stat column gets added there
    // and not here.
    await client.query(
      `DELETE FROM bot_hand_results WHERE bot_id = $1`,
      [botId]
    )
    const { rows } = await client.query(
      `UPDATE bots
          SET neural_state     = $3::jsonb,
              elo              = $4,
              hands_played     = 0,
              hands_voluntary  = 0,
              hands_won        = 0,
              showdowns_played = 0,
              showdowns_won    = 0,
              bluffs_attempted = 0,
              bluffs_succeeded = 0,
              bluff_wins       = 0,
              chips_won_total  = 0,
              updated_at       = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND is_neural = TRUE
        RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}`,
      [botId, ownerUserId, JSON.stringify(fresh), STARTING_RATING]
    )
    return rows[0] ? toApi(rows[0]) : null
  })
}

// Stats-only reset. Works for ANY bot kind (rule, clone, neural,
// super) — wipes ELO + lifetime stat columns + the per-hand history
// rows that drive the ELO chart and head-to-head stats. Does NOT
// touch the user's JS code, the neural weights, or the super
// members. Used after the ELO overhaul so users can wipe inflated
// ratings without losing the bots themselves.
//
// Same transaction shape as resetNeuralBot. Caller must own the bot.
export async function resetBotStats({ botId, ownerUserId }) {
  return withTransaction(async (client) => {
    await client.query(
      `DELETE FROM bot_hand_results WHERE bot_id = $1`,
      [botId]
    )
    const { rows } = await client.query(
      `UPDATE bots
          SET elo              = $3,
              hands_played     = 0,
              hands_voluntary  = 0,
              hands_won        = 0,
              showdowns_played = 0,
              showdowns_won    = 0,
              bluffs_attempted = 0,
              bluffs_succeeded = 0,
              bluff_wins       = 0,
              chips_won_total  = 0,
              updated_at       = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}`,
      [botId, ownerUserId, STARTING_RATING]
    )
    return rows[0] ? toApi(rows[0]) : null
  })
}

// Counts only the user's manual bots — excludes clones, neural slots,
// super bots, AND the Oracle slot. Each of those is on its own quota.
// The name stays "NonClone" for backward compat with call sites; the
// predicate is the source of truth.
export async function countNonCloneBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM bots
       WHERE owner_user_id = $1 AND is_clone = FALSE
         AND is_neural = FALSE AND is_super = FALSE AND is_oracle = FALSE`,
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Super bots have their own 2-per-user slot count. Off-quota from the
// 10 manual bots so users always have room to assemble two ensembles.
export async function countSuperBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1 AND is_super = TRUE',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Validate a proposed list of member-bot UUIDs against the rules:
//   - 3..5 entries, all unique
//   - every member must be visible to the owner (own or public)
//   - members cannot themselves be super bots (no recursion)
// Returns { ok, error?, members? }. On success, `members` is the
// fetched member rows in the same order as the input.
export async function validateSuperMembers(memberIds, ownerUserId) {
  if (!Array.isArray(memberIds)) return { ok: false, error: 'invalid_members' }
  const ids = memberIds.filter(id => typeof id === 'string')
  if (ids.length < 3 || ids.length > 5) return { ok: false, error: 'member_count' }
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'duplicate_members' }
  const { rows } = await query(
    `SELECT id, is_super, is_public, owner_user_id
       FROM bots WHERE id = ANY($1::uuid[])`,
    [ids]
  )
  if (rows.length !== ids.length) return { ok: false, error: 'member_not_found' }
  for (const r of rows) {
    if (r.is_super) return { ok: false, error: 'no_nested_super' }
    if (!r.is_public && r.owner_user_id !== ownerUserId) {
      return { ok: false, error: 'member_not_visible' }
    }
  }
  // Re-order to match the input order so the dispatch position is
  // stable. The DB doesn't guarantee result order for ANY().
  const byId = new Map(rows.map(r => [r.id, r]))
  return { ok: true, members: ids.map(id => byId.get(id)) }
}

// Bulk-load the full API shape for a list of member bot UUIDs. Used
// inside getBotById to hydrate `members` for super bots so the runtime
// can dispatch without a second roundtrip. Preserves input order.
export async function getMembersByIds(memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) return []
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.id = ANY($1::uuid[])
    `,
    [memberIds]
  )
  const byId = new Map(rows.map(r => [r.id, r]))
  return memberIds.map(id => byId.get(id)).filter(Boolean).map(r => toApi(r, r.owner_display_name))
}

export async function getCloneByTier(ownerUserId, cloneTier) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_clone = TRUE AND b.clone_tier = $2
     LIMIT 1
    `,
    [ownerUserId, cloneTier]
  )
  return rows[0] ? toApi(rows[0], rows[0].owner_display_name) : null
}

// Replace the code/elo/profile of an existing clone in place. Used by the
// "Recalculate from last N hands" button. Returns the updated bot.
export async function replaceCloneCode({ botId, ownerUserId, code, elo, color, name }) {
  const { rows } = await query(
    `
    UPDATE bots
       SET code = COALESCE($3, code),
           elo  = COALESCE($4, elo),
           color = COALESCE($5, color),
           name = COALESCE($6, name),
           updated_at = NOW()
     WHERE id = $1 AND owner_user_id = $2 AND is_clone = TRUE
     RETURNING ${PUBLIC_FIELDS.replace(/b\./g, '')}
    `,
    [botId, ownerUserId, code ?? null, elo ?? null, color ?? null, name ?? null]
  )
  return rows[0] ? toApi(rows[0]) : null
}

export async function getBotById(botId, { viewerUserId = null } = {}) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.id = $1
    `,
    [botId]
  )
  const row = rows[0]
  if (!row) return null
  if (!row.is_public && row.owner_user_id !== viewerUserId) return null
  const bot = toApi(row, row.owner_display_name)
  // Super bots carry their member records inline so the runtime can
  // dispatch decisions without a second fetch + the edit page can show
  // the lineup. Hydration is a single bulk query — cheap.
  if (bot.isSuper && bot.superMemberIds?.length) {
    bot.members = await getMembersByIds(bot.superMemberIds)
  }
  return bot
}

export async function countBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

// Total public bots a user is currently sharing — drives the 10-public
// cap. Counts across all kinds (manual, clone, neural) since the cap is
// "how many of yours can anyone seat", not "how many of each type".
export async function countPublicBotsByOwner(ownerUserId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS count FROM bots WHERE owner_user_id = $1 AND is_public = TRUE',
    [ownerUserId]
  )
  return rows[0]?.count || 0
}

export async function listBotsByOwner(ownerUserId) {
  // LIST_FIELDS excludes rules/phrases/code — saves ~5KB/row over the wire
  // and skips the JSONB parse on the client. Edit/Run paths use getBotById
  // which still returns the full shape.
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
     ORDER BY b.created_at DESC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

export async function listPublicBots({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100)
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0)
  // Leaderboard query — heaviest one in the system, runs anytime the public
  // bot list loads. With the partial covering index added in migration 007
  // (elo DESC, created_at DESC) WHERE is_public AND NOT is_clone, this scans
  // O(LIMIT) index entries instead of the full public set.
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.is_public = TRUE AND b.is_clone = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT $1 OFFSET $2
    `,
    [safeLimit, safeOffset]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Top N bots by ELO with one bot per ELO tier — used by the arena's
// auto-fill tool. DISTINCT ON keeps the first row per b.elo according to
// the ORDER BY, so starting the ORDER BY with `b.elo DESC, b.created_at
// DESC` gives us the most recently created bot per ELO tier. LIMIT takes
// the top N tiers from that already-sorted stream. Single query, no N+1,
// no client-side dedup.
//
// (An earlier wrapped-subquery version referenced `b.*` columns in the
// outer SELECT where the alias was out of scope — Postgres rejected it
// and the engine silently fell back to "no bots available." Don't
// reintroduce the wrapper.)
export async function listTopUniqueEloBots({ limit = 5 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20)
  const { rows } = await query(
    `
    SELECT DISTINCT ON (b.elo) ${LIST_FIELDS},
           u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.is_public = TRUE AND b.is_clone = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT $1
    `,
    [safeLimit]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Head-to-head stats: for every opponent this bot has shared a hand with,
// return aggregate win-count / chips delta / hand count. We don't have an
// explicit `hand_id` column on bot_hand_results, so we join by table_id +
// a ~100ms time window around played_at — same hand's audit rows all land
// within a few ms of each other (Promise.all in _recordBotHandResults).
//
// Heavier than a single-bot ELO lookup but bounded by the hand-history
// retention window; LIMIT N opponents keeps the response payload modest.
export async function getBotHeadToHead(botId, { limit = 30, sampleHands = 2000 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100)
  const safeSample = Math.min(Math.max(parseInt(sampleHands, 10) || 2000, 100), 10000)
  const { rows } = await query(
    `
    WITH my_hands AS (
      SELECT table_id, played_at, won, chips_delta
        FROM bot_hand_results
       WHERE bot_id = $1
       ORDER BY played_at DESC
       LIMIT $2
    ),
    pairings AS (
      SELECT o.bot_id AS opp_id,
             COUNT(*)::int                                 AS hands_together,
             SUM(CASE WHEN my.won THEN 1 ELSE 0 END)::int  AS my_wins,
             SUM(my.chips_delta)::bigint                   AS chips_delta_sum
        FROM my_hands my
        JOIN bot_hand_results o
          ON o.table_id = my.table_id
         AND o.played_at BETWEEN my.played_at - INTERVAL '150 milliseconds'
                             AND my.played_at + INTERVAL '150 milliseconds'
         AND o.bot_id <> $1
       GROUP BY o.bot_id
    )
    SELECT p.opp_id,
           p.hands_together,
           p.my_wins,
           p.chips_delta_sum,
           b.name  AS opp_name,
           b.color AS opp_color,
           b.text_color AS opp_text_color,
           b.avatar_url AS opp_avatar_url,
           b.elo   AS opp_elo,
           b.is_neural AS opp_is_neural,
           b.neural_kind AS opp_neural_kind,
           b.is_clone   AS opp_is_clone,
           u.display_name AS opp_owner_display_name
      FROM pairings p
      JOIN bots b ON b.id = p.opp_id
      JOIN users u ON u.id = b.owner_user_id
     ORDER BY p.hands_together DESC, p.my_wins DESC
     LIMIT $3
    `,
    [botId, safeSample, safeLimit]
  )
  return rows.map(r => ({
    opponentId: r.opp_id,
    name: r.opp_name,
    color: r.opp_color,
    textColor: r.opp_text_color,
    avatarUrl: r.opp_avatar_url,
    elo: r.opp_elo,
    isNeural: r.opp_is_neural,
    neuralKind: r.opp_neural_kind,
    isClone: r.opp_is_clone,
    ownerDisplayName: r.opp_owner_display_name,
    handsTogether: r.hands_together,
    myWins: r.my_wins,
    myLosses: r.hands_together - r.my_wins,
    chipsDelta: Number(r.chips_delta_sum)
  }))
}

// Manual / user-coded bots only (excludes clones + neural). Used by the
// "auto-fill with my custom bots" arena action.
export async function listManualBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
       AND b.is_clone = FALSE
       AND b.is_neural = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Per-hand ELO time-series for the bot. Returns rows in chronological
// order with hand_no = position within the returned window. Filters out
// rows where elo_after is NULL (pre-migration-018 hands). The default
// limit is a thousand — enough for a long-tail trend; smaller than
// shipping every audit row of a power-user's bot.
export async function getBotEloHistory(botId, { limit = 1000 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 1000, 10), 5000)
  // Two-step query so we can keep the most-recent N (cheap via the
  // existing bot_id index) and then ORDER ASC for the chart. ROW_NUMBER
  // gives the X axis without the caller needing to enumerate client-side.
  const { rows } = await query(
    `
    SELECT played_at, elo_after,
           ROW_NUMBER() OVER (ORDER BY played_at ASC) AS hand_no
      FROM (
        SELECT played_at, elo_after
          FROM bot_hand_results
         WHERE bot_id = $1 AND elo_after IS NOT NULL
         ORDER BY played_at DESC
         LIMIT $2
      ) recent
     ORDER BY played_at ASC
    `,
    [botId, safeLimit]
  )
  return rows.map(r => ({
    handNo: Number(r.hand_no),
    elo: r.elo_after,
    playedAt: r.played_at
  }))
}

// Public bots owned by a given user — used by profile pages to show
// "the bots this person is sharing publicly". Excludes clones (private
// by default anyway) and neural bots (always private). Sorted by ELO so
// the strongest one shows first.
export async function listPublicBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${LIST_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1
       AND b.is_public = TRUE
       AND b.is_clone = FALSE
       AND b.is_neural = FALSE
     ORDER BY b.elo DESC, b.created_at DESC
     LIMIT 30
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Owner's neural-bot squad in tier order (α → ε). Used by the "auto-fill
// with my NN squad" action to seat the user's own 5 neural bots in tier
// order so the arena lineup is consistent across sessions. Owner-only;
// returns [] if the user hasn't been provisioned yet (caller can decide
// whether to provision-then-retry or surface a "play once first" error).
export async function listNeuralBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_neural = TRUE
     ORDER BY b.neural_tier ASC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Just the deep-MLP tier (tiers 6-10: Neuron ζ-κ). Used by
// POKER_AUTO_FILL_MLP to seat the user's 5 deep-MLP variants without
// dragging the baseline α-ε along. Same shape as listNeuralBotsByOwner.
export async function listDeepMlpBotsByOwner(ownerUserId) {
  const { rows } = await query(
    `
    SELECT ${PUBLIC_FIELDS}, u.display_name AS owner_display_name
      FROM bots b
      JOIN users u ON u.id = b.owner_user_id
     WHERE b.owner_user_id = $1 AND b.is_neural = TRUE AND b.neural_tier >= 6
     ORDER BY b.neural_tier ASC
    `,
    [ownerUserId]
  )
  return rows.map(r => toApi(r, r.owner_display_name))
}

// Atomic per-hand update for a bot at a poker table. Inserts the hand result
// row + bumps every aggregate counter on `bots`. ELO floor is 300 (matches
// eloEngine.RATING_FLOOR) — a bot stuck on a losing streak still has room
// to claw back without falling off the bottom of the scale.
//
// New since the ELO revamp: also records preflop hand score, was-this-a-
// bluff-win, and the computed performance score for that hand. These let us
// recompute ratings offline if the formula changes.
export async function recordHandResult({
  botId,
  tableId,
  chipsDelta,
  wentToShowdown,
  won,
  foldedPreflop,
  voluntarilyIn,
  eloChange,
  bluffWin = false,
  preflopScore = null,
  performanceScore = null
}) {
  if (!botId) return
  // Stored procedure does the INSERT + UPDATE in one statement (migration 007).
  // Replaces a 4-roundtrip transaction (BEGIN, INSERT, UPDATE, COMMIT) with
  // one. With 4 bots at a table that's 16 RTTs → 4 per hand.
  await query(
    `SELECT record_bot_hand($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      botId,
      String(tableId).slice(0, 64),
      Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.floor(chipsDelta || 0))),
      Boolean(wentToShowdown),
      Boolean(won),
      Boolean(foldedPreflop),
      Boolean(voluntarilyIn),
      Math.floor(eloChange || 0),
      Boolean(bluffWin),
      preflopScore != null ? Number(preflopScore) : null,
      performanceScore != null ? Number(performanceScore) : null
    ]
  )
}
