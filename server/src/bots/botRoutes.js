import { createHash } from 'node:crypto'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired, authOptional } from '../auth/middleware.js'

// Bot creation / mutation is the main spam vector. The DB caps each user at
// 10 manual bots + 5 clones, but a rate limit on top prevents an attacker
// from churning through delete+create cycles or hammering the validation
// path. Keyed on the authenticated user id when available (per-account),
// falling back to IP for the rare unauth path. Generous enough for a real
// session: 60 mutating actions per minute = one per second.
const botWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down on bot edits — try again in a moment.' },
})

// Clone-from-user is more expensive: it scans the user's full hand history
// and runs the template generator. Tighter cap so a malicious script can't
// burn CPU on the server by hammering this endpoint.
const cloneBuildLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Clone builds are limited to 10 per minute.' },
})
import {
  createBot,
  createSuperBot,
  updateBot,
  deleteBot,
  getBotById,
  listBotsByOwner,
  listPublicBots,
  countBotsByOwner,
  countNonCloneBotsByOwner,
  countSuperBotsByOwner,
  countPublicBotsByOwner,
  validateSuperMembers,
  getCloneByTier,
  replaceCloneCode,
  provisionNeuralBotsForUser,
  resetNeuralBot,
  getBotEloHistory,
  getBotHeadToHead
} from './botRepository.js'

// Hard caps per account. Manual bots are user-created and capped to keep
// the public roster spam-free. Clones are auto-built from the player's own
// data and live in fixed tier slots, so they don't count against the manual
// cap. Total ceiling for any one user is MAX_MANUAL + 5 = 15.
export const MAX_MANUAL_BOTS_PER_USER = 10
// Kept as an alias for the existing client API surface — equals the manual
// cap because that's the cap clients actually need to gate their UI on.
export const MAX_BOTS_PER_USER = MAX_MANUAL_BOTS_PER_USER
// How many of your bots can be public at once. Half of the theoretical
// maximum (10 manual + 5 clone + 5 neural + 2 super = 22) so users have
// to curate which ones they share. Enforced at create + isPublic-flip time.
export const MAX_PUBLIC_BOTS_PER_USER = 10
// Super bots are off-quota from the manual cap — users always have two
// ensemble slots available regardless of how many manual bots they've made.
export const MAX_SUPER_BOTS_PER_USER = 2
import {
  validateRules,
  validatePhrases,
  validateColor,
  validateTextColor,
  validateName,
  validateCode,
  defaultRules,
  defaultCode
} from './ruleSchema.js'
import {
  getPlayStats,
  getRecentHands,
  markBotBuilt,
  BOT_UNLOCK_THRESHOLD
} from '../users/playHistoryRepository.js'
import {
  buildBotFromUser,
  CLONE_TIERS,
  findCloneTier,
  recentHandsForTier
} from '../users/botFromUser.js'
import { findUserById } from '../users/userRepository.js'
import { query as dbQuery } from '../db/pool.js'
import { MODES as SUPER_MODES } from './super/transitions.js'

function handleValidationError(err, res) {
  if (err && err.code === 'invalid_rules') {
    return res.status(400).json({ error: 'invalid_input', detail: err.message, path: err.path })
  }
  throw err
}

// Tiny stale-while-revalidate cache for the public leaderboard. Every visitor
// hitting /poker fires this; the underlying ELO + slim-row query is fast but
// not free. With a 30s TTL the cache absorbs the burst and the next request
// after expiry kicks off a single refresh while still serving the stale copy
// to in-flight callers — so we never block a request on the refresh.
const LEADERBOARD_TTL_MS = 30 * 1000
let _leaderboardCache = null // { fetchedAt, payload, etag, refreshing: Promise|null }

function computeLeaderboardEtag(bots) {
  // Light fingerprint covering each bot's id + elo + updated_at + chip-counter.
  // Cheap to compute (string concat), strong enough that any change to a
  // public bot's stats invalidates the etag. The hash is sha1 truncated to
  // 16 hex chars — collision-resistant well past any realistic dataset.
  const h = createHash('sha1')
  for (const b of bots) {
    h.update(b.id)
    h.update('|')
    h.update(String(b.elo))
    h.update('|')
    h.update(String(b.stats?.handsPlayed ?? 0))
    h.update('\n')
  }
  return `"lb-${h.digest('hex').slice(0, 16)}"`
}

async function getLeaderboardCached() {
  const now = Date.now()
  if (_leaderboardCache && now - _leaderboardCache.fetchedAt < LEADERBOARD_TTL_MS) {
    return _leaderboardCache
  }
  // Single in-flight refresh: every caller during the refetch awaits the
  // same promise. Important on a cache miss after restart when many clients
  // race the first request.
  if (_leaderboardCache?.refreshing) return _leaderboardCache.refreshing

  const refreshing = listPublicBots().then(bots => {
    const payload = { bots }
    const etag = computeLeaderboardEtag(bots)
    _leaderboardCache = { fetchedAt: Date.now(), payload, etag, refreshing: null }
    return _leaderboardCache
  }).catch(err => {
    if (_leaderboardCache) _leaderboardCache.refreshing = null
    throw err
  })

  if (_leaderboardCache) _leaderboardCache.refreshing = refreshing
  else _leaderboardCache = { fetchedAt: 0, payload: null, etag: null, refreshing }
  return refreshing
}

// Per-user cache for /api/bots/mine. Same shape + semantics as the
// leaderboard cache, but keyed by ownerUserId because each user gets a
// distinct payload. TTL is short (10s) so a manual create/delete reflects
// fast even if we forget to invalidate; the invalidate helper below is the
// fast path. Stale-while-revalidate gives navigation snappiness without
// sacrificing correctness after a mutation.
const MINE_TTL_MS = 10 * 1000
const MINE_STALE_MS = 30 * 1000
const _mineCache = new Map() // userId → { fetchedAt, payload, refreshing }

async function getMyBotsCached(userId) {
  const now = Date.now()
  const entry = _mineCache.get(userId)
  if (entry && now - entry.fetchedAt < MINE_TTL_MS) {
    return entry.payload
  }
  if (entry?.refreshing) return entry.refreshing

  const refreshing = (async () => {
    // Lazy-provision the NN squad on first hit. Idempotent INSERT ... ON
    // CONFLICT DO NOTHING — cheap when bots already exist.
    try { await provisionNeuralBotsForUser(userId) }
    catch (err) { console.warn('[bots] neural provisioning failed:', err.message) }
    const bots = await listBotsByOwner(userId)
    const payload = { bots, limit: MAX_BOTS_PER_USER, publicLimit: MAX_PUBLIC_BOTS_PER_USER }
    _mineCache.set(userId, { fetchedAt: Date.now(), payload, refreshing: null })
    return payload
  })().catch(err => {
    const e = _mineCache.get(userId)
    if (e) e.refreshing = null
    throw err
  })

  if (entry) entry.refreshing = refreshing
  else _mineCache.set(userId, { fetchedAt: 0, payload: null, refreshing })
  return refreshing
}

// Drop a user's cache after a write. Called from create/update/delete
// routes. We don't try to merge — the next read repopulates from a fresh
// query, which is also when neural provisioning happens if it's needed.
function invalidateMyBotsCache(userId) {
  if (userId) _mineCache.delete(userId)
}

// Background sweep of stale entries so per-user caches don't grow without
// bound. Keep entries that are still inside the stale-while-revalidate
// window; the next request after that drops them naturally. Runs every
// 5 minutes — light enough to be invisible, frequent enough to keep the
// map small for a server with rotating users.
setInterval(() => {
  const cutoff = Date.now() - (MINE_TTL_MS + MINE_STALE_MS)
  for (const [k, v] of _mineCache) if (v.fetchedAt < cutoff) _mineCache.delete(k)
}, 5 * 60 * 1000).unref?.()

export function botRoutes() {
  const router = Router()

  router.get('/public', async (req, res) => {
    const cached = await getLeaderboardCached()
    // Allow the browser + any CDN in front of us to cache for 30s, then
    // serve-stale-while-revalidate for another 60s. Pairs naturally with
    // the in-process cache above for layered caching.
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60')
    res.setHeader('ETag', cached.etag)
    // If the client sent matching If-None-Match, save them the body — the
    // server saves the gzip+stringify, the client saves the parse. Pure win.
    if (req.headers['if-none-match'] === cached.etag) {
      res.status(304).end()
      return
    }
    res.json(cached.payload)
  })

  router.get('/mine', authRequired, async (req, res) => {
    // In-process per-user cache (see getMyBotsCached). Short TTL + SWR
    // so rapid Bots → Table → Bots navigation feels instant without
    // sacrificing correctness after a mutation (writes invalidate).
    const payload = await getMyBotsCached(req.user.id)
    // Browser-side cache too, scoped private so a shared proxy doesn't
    // serve one user's bots to another. Pairs naturally with the
    // in-process cache for layered fast-paths.
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json(payload)
  })

  // Reset a neural bot's weights back to the random init + zero its
  // training counters. The bot is otherwise immutable from the API (no
  // user-editable code, no rules); reset is the only "edit" you can do.
  router.post('/:id/neural/reset', authRequired, botWriteLimiter, async (req, res) => {
    const bot = await resetNeuralBot({ botId: req.params.id, ownerUserId: req.user.id })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    invalidateMyBotsCache(req.user.id)
    res.json({ bot })
  })

  // Per-user clone shelf. Returns one entry per tier (1..5) with current
  // unlock + build state plus a generated draft when the user has enough
  // hands but hasn't built that tier yet. Used by the /poker/bots page to
  // render the 5 reserved slots.
  router.get('/from-me/preview', authRequired, async (req, res) => {
    // Three independent DB reads — kick all of them off at once so the route
    // is bottlenecked by the slowest, not their sum. Was 3 sequential RTTs.
    const [stats, user, allHands] = await Promise.all([
      getPlayStats(req.user.id),
      findUserById(req.user.id),
      getRecentHands(req.user.id)
    ])
    const seated = stats?.handsSeated ?? 0
    if (!user) return res.status(404).json({ error: 'user_not_found' })

    const tiers = await Promise.all(CLONE_TIERS.map(async (t) => {
      const existing = await getCloneByTier(req.user.id, t.tier)
      const unlocked = seated >= t.hands
      if (existing) {
        return {
          tier: t.tier,
          hands: t.hands,
          label: t.label,
          unlocked: true,
          built: true,
          botId: existing.id,
          name: existing.name,
          color: existing.color,
          elo: existing.elo,
          isPublic: existing.isPublic
        }
      }
      if (!unlocked) {
        return {
          tier: t.tier,
          hands: t.hands,
          label: t.label,
          unlocked: false,
          built: false,
          handsRemaining: Math.max(0, t.hands - seated)
        }
      }
      const draft = buildBotFromUser({
        user: { id: user.id, displayName: user.display_name },
        stats,
        recentHands: recentHandsForTier(allHands, t.tier),
        tier: t.tier
      })
      return {
        tier: t.tier,
        hands: t.hands,
        label: t.label,
        unlocked: true,
        built: false,
        draft: {
          name: draft.name,
          color: draft.color,
          elo: draft.elo,
          profile: draft.profile,
          seedHandsAnalyzed: draft.seedHandsAnalyzed
        }
      }
    }))

    res.json({
      handsSeated: seated,
      manualBotLimit: MAX_MANUAL_BOTS_PER_USER,
      tiers
    })
  })

  // Materialize a clone for a specific tier. Body: { tier: 1..5 }. Idempotent
  // by (owner_user_id, clone_tier) — already-built tiers return the existing
  // bot rather than erroring.
  router.post('/from-me', authRequired, cloneBuildLimiter, async (req, res) => {
    const tierId = Number(req.body?.tier ?? 1)
    const tierMeta = findCloneTier(tierId)
    if (!tierMeta) return res.status(400).json({ error: 'invalid_tier' })

    // Race the gate check, the idempotency check, and the data we'd need
    // if we end up building. Saves 3 sequential RTTs down to one wall-clock
    // round, and the wasted work (user/hands fetch when tier is locked or
    // already built) is bounded — both fast single-row reads.
    const [stats, already, user, allHands] = await Promise.all([
      getPlayStats(req.user.id),
      getCloneByTier(req.user.id, tierId),
      findUserById(req.user.id),
      getRecentHands(req.user.id)
    ])
    const seated = stats?.handsSeated ?? 0
    if (seated < tierMeta.hands) {
      return res.status(400).json({
        error: 'tier_locked',
        detail: `Play at least ${tierMeta.hands} hands to unlock this clone. You're at ${seated}.`,
        handsRequired: tierMeta.hands,
        handsSeated: seated
      })
    }
    // Already built? Return what's there — the unique index would block a
    // duplicate insert anyway, and it's nicer for the client to get the
    // existing bot back than to handle a 400.
    if (already) return res.json({ bot: already, alreadyBuilt: true })

    try {
      if (!user) return res.status(404).json({ error: 'user_not_found' })
      const draft = buildBotFromUser({
        user: { id: user.id, displayName: user.display_name },
        stats,
        recentHands: recentHandsForTier(allHands, tierId),
        tier: tierId
      })
      const cleanName = validateName(draft.name)
      validateColor(draft.color)
      validateCode(draft.code)
      const bot = await createBot({
        ownerUserId: req.user.id,
        name: cleanName,
        color: draft.color,
        textColor: draft.textColor,
        rules: defaultRules(),  // unused with codeEnabled
        phrases: {},
        code: draft.code,
        codeEnabled: true,
        isPublic: false,        // clones are private by default
        isClone: true,
        cloneTier: tierId,
        cloneHandsUsed: tierMeta.hands
      })
      if (typeof draft.elo === 'number' && draft.elo !== bot.elo) {
        const finalElo = Math.max(300, Math.min(2000, Math.floor(draft.elo)))
        await dbQuery(
          'UPDATE bots SET elo = $1 WHERE id = $2 AND owner_user_id = $3',
          [finalElo, bot.id, req.user.id]
        )
        bot.elo = finalElo
      }
      await markBotBuilt(req.user.id)
      invalidateMyBotsCache(req.user.id)
      res.status(201).json({
        bot,
        profile: draft.profile,
        seedHandsAnalyzed: draft.seedHandsAnalyzed,
        tier: tierId
      })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] from-me failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // Recompute an existing clone in place from the user's most-recent N hands
  // (where N is locked by the clone's tier). Replaces the code, ELO, and
  // color while keeping the bot id stable so anyone with a saved reference
  // (table, public link if they shared it) keeps pointing at the same bot.
  router.post('/:id/recalculate-clone', authRequired, cloneBuildLimiter, async (req, res) => {
    try {
      const existing = await getBotById(req.params.id, { viewerUserId: req.user.id })
      if (!existing) return res.status(404).json({ error: 'not_found' })
      if (existing.ownerUserId !== req.user.id) return res.status(403).json({ error: 'forbidden' })
      if (!existing.isClone || !existing.cloneTier) {
        return res.status(400).json({ error: 'not_a_clone' })
      }
      const tierMeta = findCloneTier(existing.cloneTier)
      if (!tierMeta) return res.status(500).json({ error: 'unknown_tier' })

      // Same parallel fetch pattern as /from-me — stats/user/hands are
      // independent reads.
      const [stats, user, allHands] = await Promise.all([
        getPlayStats(req.user.id),
        findUserById(req.user.id),
        getRecentHands(req.user.id)
      ])
      const seated = stats?.handsSeated ?? 0
      if (seated < tierMeta.hands) {
        return res.status(400).json({
          error: 'tier_locked',
          detail: `You need ${tierMeta.hands} hands of play data — you have ${seated}.`
        })
      }
      const draft = buildBotFromUser({
        user: { id: user.id, displayName: user.display_name },
        stats,
        recentHands: recentHandsForTier(allHands, existing.cloneTier),
        tier: existing.cloneTier
      })
      validateCode(draft.code)
      const finalElo = Math.max(300, Math.min(2000, Math.floor(draft.elo)))
      const updated = await replaceCloneCode({
        botId: existing.id,
        ownerUserId: req.user.id,
        code: draft.code,
        elo: finalElo,
        color: draft.color,
        name: draft.name
      })
      if (!updated) return res.status(404).json({ error: 'not_found' })
      invalidateMyBotsCache(req.user.id)
      res.json({
        bot: updated,
        profile: draft.profile,
        seedHandsAnalyzed: draft.seedHandsAnalyzed
      })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] recalculate-clone failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.get('/:id', authOptional, async (req, res) => {
    const bot = await getBotById(req.params.id, { viewerUserId: req.user?.id ?? null })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    // The bot record is read on the edit page plus implicitly by the
    // ELO chart and H2H panel that mount alongside it — a short browser
    // cache coalesces those into one round trip on first paint without
    // sacrificing freshness after a save (PATCH/DELETE go to different
    // URLs, so this only caches stable reads).
    res.setHeader('Cache-Control', 'private, max-age=5, stale-while-revalidate=30')
    res.json({ bot })
  })

  // ELO time-series. Authorization piggybacks on getBotById: private bots
  // resolve to null for non-owners, which we treat as 404. `limit` query
  // param is clamped on the repo side (10..5000). Used by the bot edit
  // page to render the rating chart.
  router.get('/:id/elo-history', authOptional, async (req, res) => {
    const bot = await getBotById(req.params.id, { viewerUserId: req.user?.id ?? null })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const points = await getBotEloHistory(bot.id, { limit })
    // Short browser cache so navigating back to the page doesn't refetch
    // immediately, but stale-while-revalidate keeps the chart current
    // after a fresh hand resolves.
    res.setHeader('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    res.json({ points, currentElo: bot.elo })
  })

  // Head-to-head stats for the bot edit page. Surfaces "which opponents
  // does this bot actually beat?" — the most useful diagnostic when
  // iterating on a bot. Same access gate as the bot record itself.
  router.get('/:id/h2h', authOptional, async (req, res) => {
    const bot = await getBotById(req.params.id, { viewerUserId: req.user?.id ?? null })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    const limit = req.query.limit ? Number(req.query.limit) : undefined
    const opponents = await getBotHeadToHead(bot.id, { limit })
    res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    res.json({ opponents })
  })

  // Reset a rule/JS bot's code back to the starter template. Mirrors the
  // clone "recalculate" and neural "reset weights" affordances — gives
  // manual bots a "start over" path that doesn't require deleting +
  // re-creating. Neural / clone bots reject (they have their own resets).
  router.post('/:id/reset-code', authRequired, botWriteLimiter, async (req, res) => {
    const target = await getBotById(req.params.id, { viewerUserId: req.user.id })
    if (!target || target.ownerUserId !== req.user.id) {
      return res.status(404).json({ error: 'not_found' })
    }
    if (target.isClone || target.isNeural) {
      return res.status(400).json({
        error: 'wrong_kind',
        detail: 'Use the clone recalc / neural reset for those bot types.'
      })
    }
    const bot = await updateBot({
      botId: target.id,
      ownerUserId: req.user.id,
      patch: { code: defaultCode(), codeEnabled: true }
    })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    invalidateMyBotsCache(req.user.id)
    res.json({ bot })
  })

  // Manual bot creation. `isPublic` defaults to false now — users have to
  // opt their bots into the public roster explicitly. The 10-manual cap
  // still excludes clones / NN slots so users get those for free.
  router.post('/', authRequired, botWriteLimiter, async (req, res) => {
    const { name, color, textColor, rules, phrases, code, codeEnabled, isPublic } = req.body || {}
    try {
      const cleanName = validateName(name ?? '')
      const cleanColor = color ?? '#3b82f6'
      validateColor(cleanColor)
      validateTextColor(textColor)
      const cleanRules = rules ?? defaultRules()
      validateRules(cleanRules)
      validatePhrases(phrases)
      validateCode(code)

      const existing = await countNonCloneBotsByOwner(req.user.id)
      if (existing >= MAX_MANUAL_BOTS_PER_USER) {
        return res.status(400).json({
          error: 'bot_limit_reached',
          detail: `You can only have up to ${MAX_MANUAL_BOTS_PER_USER} bots per account. Delete one to make room. (Clone + neural slots don't count.)`,
          limit: MAX_MANUAL_BOTS_PER_USER
        })
      }
      // Only check the public cap if the new bot is going public — keeps
      // the cheap private-by-default path one query lighter.
      const wantPublic = isPublic === undefined ? false : Boolean(isPublic)
      if (wantPublic) {
        const publicCount = await countPublicBotsByOwner(req.user.id)
        if (publicCount >= MAX_PUBLIC_BOTS_PER_USER) {
          return res.status(400).json({
            error: 'public_limit_reached',
            detail: `You're already sharing ${MAX_PUBLIC_BOTS_PER_USER} bots publicly. Hide one before making this one public.`,
            limit: MAX_PUBLIC_BOTS_PER_USER
          })
        }
      }

      const bot = await createBot({
        ownerUserId: req.user.id,
        name: cleanName,
        color: cleanColor,
        textColor: textColor ?? 'auto',
        rules: cleanRules,
        phrases: phrases ?? {},
        code: code ?? defaultCode(),
        codeEnabled: Boolean(codeEnabled),
        isPublic: wantPublic
      })
      invalidateMyBotsCache(req.user.id)
      res.status(201).json({ bot })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] create failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // POST /api/bots/super — create a "super bot" that round-robins between
  // 3-5 member bots. Members must be visible to the caller (own or
  // public) and cannot themselves be super (no nesting). The 2-per-user
  // slot count is enforced here.
  router.post('/super', authRequired, botWriteLimiter, async (req, res) => {
    const { name, color, textColor, isPublic, memberIds, mode } = req.body || {}
    try {
      const cleanName = validateName(name ?? '')
      const cleanColor = color ?? '#a855f7'
      validateColor(cleanColor)
      validateTextColor(textColor)

      const existing = await countSuperBotsByOwner(req.user.id)
      if (existing >= MAX_SUPER_BOTS_PER_USER) {
        return res.status(400).json({
          error: 'super_limit_reached',
          detail: `You can have at most ${MAX_SUPER_BOTS_PER_USER} super bots. Delete one to make room.`,
          limit: MAX_SUPER_BOTS_PER_USER
        })
      }
      const wantPublic = isPublic === true
      if (wantPublic) {
        const publicCount = await countPublicBotsByOwner(req.user.id)
        if (publicCount >= MAX_PUBLIC_BOTS_PER_USER) {
          return res.status(400).json({
            error: 'public_limit_reached',
            detail: `You're already sharing ${MAX_PUBLIC_BOTS_PER_USER} bots publicly. Hide one first.`,
            limit: MAX_PUBLIC_BOTS_PER_USER
          })
        }
      }
      const validation = await validateSuperMembers(memberIds, req.user.id)
      if (!validation.ok) {
        const details = {
          member_count: 'Pick 3 to 5 member bots.',
          duplicate_members: 'A bot can only appear once in the lineup.',
          member_not_found: 'One of the picked bots no longer exists.',
          member_not_visible: 'One of the picked bots isn\'t shared with you.',
          no_nested_super: 'Super bots can\'t use other super bots as members.',
          invalid_members: 'Invalid member list.'
        }
        return res.status(400).json({ error: validation.error, detail: details[validation.error] })
      }

      const cleanMode = SUPER_MODES.includes(mode) ? mode : 'thompson'
      const bot = await createSuperBot({
        ownerUserId: req.user.id,
        name: cleanName,
        color: cleanColor,
        textColor: textColor ?? 'auto',
        isPublic: wantPublic,
        superMemberIds: memberIds,
        mode: cleanMode
      })
      invalidateMyBotsCache(req.user.id)
      // Re-fetch to hydrate the members array for the response.
      const hydrated = await getBotById(bot.id, { viewerUserId: req.user.id })
      res.status(201).json({ bot: hydrated || bot })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] super create failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.patch('/:id', authRequired, botWriteLimiter, async (req, res) => {
    const { name, color, textColor, avatarUrl, rules, phrases, code, codeEnabled, isPublic, memberIds } = req.body || {}
    try {
      // Neural bots reject code / rules / phrases / codeEnabled patches —
      // their behavior is the policy net, not user-supplied logic. We
      // silently drop those fields rather than 400-ing so the existing
      // edit page can keep PATCHing { name, color, avatarUrl, ... }
      // without special-casing the request shape.
      const target = await getBotById(req.params.id, { viewerUserId: req.user.id })
      if (!target) return res.status(404).json({ error: 'not_found' })
      const isNeural = Boolean(target.isNeural)

      const patch = {}
      if (name !== undefined) patch.name = validateName(name)
      if (color !== undefined) { validateColor(color); patch.color = color }
      if (textColor !== undefined) { validateTextColor(textColor); patch.textColor = textColor }
      // Custom avatar URL — must be either null (clear it) or a CloudFront URL
      // from our own bucket. Anyone-anywhere URLs would let a bot owner
      // broadcast an attacker-chosen image to every table the bot sits at.
      if (avatarUrl !== undefined) {
        if (avatarUrl === null || avatarUrl === '') {
          patch.avatarUrl = null
        } else if (typeof avatarUrl !== 'string' || avatarUrl.length > 512) {
          return res.status(400).json({ error: 'invalid_avatar_url' })
        } else {
          try {
            const parsed = new URL(avatarUrl)
            const baseHost = process.env.S3_PUBLIC_BASE_URL ? new URL(process.env.S3_PUBLIC_BASE_URL).hostname : null
            if (!baseHost || parsed.hostname !== baseHost) {
              return res.status(400).json({ error: 'invalid_avatar_url', detail: 'Avatar must be uploaded through this app.' })
            }
            patch.avatarUrl = avatarUrl
          } catch {
            return res.status(400).json({ error: 'invalid_avatar_url' })
          }
        }
      }
      if (!isNeural && !target.isSuper) {
        if (rules !== undefined) { validateRules(rules); patch.rules = rules }
        if (phrases !== undefined) { validatePhrases(phrases); patch.phrases = phrases }
        if (code !== undefined) { validateCode(code); patch.code = code }
        if (codeEnabled !== undefined) patch.codeEnabled = Boolean(codeEnabled)
      }
      // Super bots only — let the owner change the transition mode.
      // Mode flips preserve accumulated bandit stats: a thompson run
      // can be flipped to markov mid-evolution and the new chain has
      // the same win/loss history to draw from.
      if (target.isSuper && typeof req.body?.mode === 'string') {
        if (!SUPER_MODES.includes(req.body.mode)) {
          return res.status(400).json({ error: 'invalid_mode', detail: `mode must be one of ${SUPER_MODES.join(', ')}` })
        }
        const nextState = { ...(target.superState || {}), mode: req.body.mode }
        patch.superState = nextState
      }
      // Super bots only — let the owner re-pick the lineup.
      if (target.isSuper && memberIds !== undefined) {
        const validation = await validateSuperMembers(memberIds, req.user.id)
        if (!validation.ok) {
          const details = {
            member_count: 'Pick 3 to 5 member bots.',
            duplicate_members: 'A bot can only appear once in the lineup.',
            member_not_found: 'One of the picked bots no longer exists.',
            member_not_visible: 'One of the picked bots isn\'t shared with you.',
            no_nested_super: 'Super bots can\'t use other super bots as members.',
            invalid_members: 'Invalid member list.'
          }
          return res.status(400).json({ error: validation.error, detail: details[validation.error] })
        }
        patch.superMemberIds = memberIds
      }
      if (isPublic !== undefined) {
        const next = Boolean(isPublic)
        // Only enforce the public cap when flipping false → true. Flipping
        // true → false reduces the count and always succeeds.
        if (next && !target.isPublic) {
          const publicCount = await countPublicBotsByOwner(req.user.id)
          if (publicCount >= MAX_PUBLIC_BOTS_PER_USER) {
            return res.status(400).json({
              error: 'public_limit_reached',
              detail: `You're already sharing ${MAX_PUBLIC_BOTS_PER_USER} bots publicly. Hide one first.`,
              limit: MAX_PUBLIC_BOTS_PER_USER
            })
          }
        }
        patch.isPublic = next
      }

      const bot = await updateBot({ botId: req.params.id, ownerUserId: req.user.id, patch })
      if (!bot) return res.status(404).json({ error: 'not_found' })
      invalidateMyBotsCache(req.user.id)
      res.json({ bot })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] update failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.delete('/:id', authRequired, botWriteLimiter, async (req, res) => {
    const result = await deleteBot({ botId: req.params.id, ownerUserId: req.user.id })
    if (result.ok) {
      invalidateMyBotsCache(req.user.id)
      return res.status(204).end()
    }
    if (result.reason === 'clone_locked') {
      return res.status(400).json({
        error: 'clone_locked',
        detail: 'Clone bots are permanent slots and can\'t be deleted. Recalculate or edit them instead.'
      })
    }
    if (result.reason === 'neural_locked') {
      return res.status(400).json({
        error: 'neural_locked',
        detail: 'Neural bots are permanent — reset their weights instead of deleting.'
      })
    }
    return res.status(404).json({ error: 'not_found' })
  })

  return router
}
