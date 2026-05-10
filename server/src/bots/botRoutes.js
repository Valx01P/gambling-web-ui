import { Router } from 'express'
import { authRequired, authOptional } from '../auth/middleware.js'
import {
  createBot,
  updateBot,
  deleteBot,
  getBotById,
  listBotsByOwner,
  listPublicBots,
  countBotsByOwner
} from './botRepository.js'

// Hard cap per account — prevents an authenticated user from spamming the
// public bot list. Tweak server-side; clients display this number too.
export const MAX_BOTS_PER_USER = 10
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

  router.get('/:id', authOptional, async (req, res) => {
    const bot = await getBotById(req.params.id, { viewerUserId: req.user?.id ?? null })
    if (!bot) return res.status(404).json({ error: 'not_found' })
    res.json({ bot })
  })

  // Bots are always public by product decision — `isPublic` from clients is ignored.
  router.post('/', authRequired, async (req, res) => {
    const { name, color, textColor, rules, phrases, code, codeEnabled } = req.body || {}
    try {
      const cleanName = validateName(name ?? '')
      const cleanColor = color ?? '#3b82f6'
      validateColor(cleanColor)
      validateTextColor(textColor)
      const cleanRules = rules ?? defaultRules()
      validateRules(cleanRules)
      validatePhrases(phrases)
      validateCode(code)

      const existing = await countBotsByOwner(req.user.id)
      if (existing >= MAX_BOTS_PER_USER) {
        return res.status(400).json({
          error: 'bot_limit_reached',
          detail: `You can only have up to ${MAX_BOTS_PER_USER} bots per account. Delete one to make room.`,
          limit: MAX_BOTS_PER_USER
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
        isPublic: true
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
    const ok = await deleteBot({ botId: req.params.id, ownerUserId: req.user.id })
    if (!ok) return res.status(404).json({ error: 'not_found' })
    res.status(204).end()
  })

  return router
}
