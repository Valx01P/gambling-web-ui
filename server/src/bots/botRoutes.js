import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authRequired, authOptional } from '../auth/middleware.js'
import {
  createBot,
  updateBot,
  deleteBot,
  getBotById,
  listBotsByOwner,
  listPublicBots,
  countBotsByOwner,
  countNonCloneBotsByOwner,
  getCloneByTier,
  replaceCloneCode
} from './botRepository.js'

// Hard caps per account. Manual bots are user-created and capped to keep
// the public roster spam-free. Clones are auto-built from the player's own
// data and live in fixed tier slots, so they don't count against the manual
// cap. Total ceiling for any one user is MAX_MANUAL + 5 = 15.
export const MAX_MANUAL_BOTS_PER_USER = 10
// Kept as an alias for the existing client API surface — equals the manual
// cap because that's the cap clients actually need to gate their UI on.
export const MAX_BOTS_PER_USER = MAX_MANUAL_BOTS_PER_USER
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

function handleValidationError(err, res) {
  if (err && err.code === 'invalid_rules') {
    return res.status(400).json({ error: 'invalid_input', detail: err.message, path: err.path })
  }
  throw err
}

export function botRoutes() {
  const router = Router()

  router.get('/public', async (_req, res) => {
    const bots = await listPublicBots()
    res.json({ bots })
  })

  router.get('/mine', authRequired, async (req, res) => {
    const bots = await listBotsByOwner(req.user.id)
    res.json({ bots, limit: MAX_BOTS_PER_USER })
  })

  // Per-user clone shelf. Returns one entry per tier (1..5) with current
  // unlock + build state plus a generated draft when the user has enough
  // hands but hasn't built that tier yet. Used by the /poker/bots page to
  // render the 5 reserved slots.
  router.get('/from-me/preview', authRequired, async (req, res) => {
    const stats = await getPlayStats(req.user.id)
    const seated = stats?.handsSeated ?? 0
    const user = await findUserById(req.user.id)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    const allHands = await getRecentHands(req.user.id)

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
  router.post('/from-me', authRequired, async (req, res) => {
    const tierId = Number(req.body?.tier ?? 1)
    const tierMeta = findCloneTier(tierId)
    if (!tierMeta) return res.status(400).json({ error: 'invalid_tier' })

    const stats = await getPlayStats(req.user.id)
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
    const already = await getCloneByTier(req.user.id, tierId)
    if (already) return res.json({ bot: already, alreadyBuilt: true })

    try {
      const user = await findUserById(req.user.id)
      if (!user) return res.status(404).json({ error: 'user_not_found' })
      const allHands = await getRecentHands(req.user.id)
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
  router.post('/:id/recalculate-clone', authRequired, async (req, res) => {
    try {
      const existing = await getBotById(req.params.id, { viewerUserId: req.user.id })
      if (!existing) return res.status(404).json({ error: 'not_found' })
      if (existing.ownerUserId !== req.user.id) return res.status(403).json({ error: 'forbidden' })
      if (!existing.isClone || !existing.cloneTier) {
        return res.status(400).json({ error: 'not_a_clone' })
      }
      const tierMeta = findCloneTier(existing.cloneTier)
      if (!tierMeta) return res.status(500).json({ error: 'unknown_tier' })

      const stats = await getPlayStats(req.user.id)
      const seated = stats?.handsSeated ?? 0
      if (seated < tierMeta.hands) {
        return res.status(400).json({
          error: 'tier_locked',
          detail: `You need ${tierMeta.hands} hands of play data — you have ${seated}.`
        })
      }
      const user = await findUserById(req.user.id)
      const allHands = await getRecentHands(req.user.id)
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
    res.json({ bot })
  })

  // Manual bot creation. `isPublic` is honored — defaults to true so the
  // public roster keeps growing for users who don't think about visibility,
  // but the owner can opt into a private bot at create time. The 10-bot cap
  // counts only NON-clone bots so users always have their 5 reserved clone
  // slots regardless of how many manual bots they've made.
  router.post('/', authRequired, async (req, res) => {
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
          detail: `You can only have up to ${MAX_MANUAL_BOTS_PER_USER} bots per account. Delete one to make room. (Clone slots don't count.)`,
          limit: MAX_MANUAL_BOTS_PER_USER
        })
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
        isPublic: isPublic === undefined ? true : Boolean(isPublic)
      })
      res.status(201).json({ bot })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] create failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.patch('/:id', authRequired, async (req, res) => {
    const { name, color, textColor, rules, phrases, code, codeEnabled } = req.body || {}
    try {
      const patch = {}
      if (name !== undefined) patch.name = validateName(name)
      if (color !== undefined) { validateColor(color); patch.color = color }
      if (textColor !== undefined) { validateTextColor(textColor); patch.textColor = textColor }
      if (rules !== undefined) { validateRules(rules); patch.rules = rules }
      if (phrases !== undefined) { validatePhrases(phrases); patch.phrases = phrases }
      if (code !== undefined) { validateCode(code); patch.code = code }
      if (codeEnabled !== undefined) patch.codeEnabled = Boolean(codeEnabled)

      const bot = await updateBot({ botId: req.params.id, ownerUserId: req.user.id, patch })
      if (!bot) return res.status(404).json({ error: 'not_found' })
      res.json({ bot })
    } catch (err) {
      try { return handleValidationError(err, res) } catch {}
      console.error('[bots] update failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  router.delete('/:id', authRequired, async (req, res) => {
    const result = await deleteBot({ botId: req.params.id, ownerUserId: req.user.id })
    if (result.ok) return res.status(204).end()
    if (result.reason === 'clone_locked') {
      return res.status(400).json({
        error: 'clone_locked',
        detail: 'Clone bots are permanent slots and can\'t be deleted. Recalculate or edit them instead.'
      })
    }
    return res.status(404).json({ error: 'not_found' })
  })

  return router
}
