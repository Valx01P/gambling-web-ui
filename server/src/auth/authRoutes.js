import { asyncRouter as Router } from '../api/asyncRouter.js'
import { verifyGoogleIdToken } from './googleVerify.js'
import { sign } from './jwt.js'
import { authRequired } from './middleware.js'
import { upsertGoogleUser, updateUserProfile, findUserById } from '../users/userRepository.js'

export function authRoutes() {
  const router = Router()

  router.post('/google', async (req, res) => {
    const { credential } = req.body || {}
    if (typeof credential !== 'string' || credential.length < 20) {
      return res.status(400).json({ error: 'missing_credential' })
    }
    // Split the verify vs upsert paths so we can distinguish "bad token"
    // (401, client's fault) from "couldn't persist user" (5xx, our fault).
    // Both used to collapse into `invalid_credential`, which made the
    // production deploy diagnosis annoying.
    let profile
    try {
      profile = await verifyGoogleIdToken(credential)
    } catch (err) {
      const code = err.code || 'verify_failed'
      console.warn(`[auth] google verify failed (${code}):`, err.message)
      // Audience mismatch is the #1 deploy footgun — log explicit IDs so
      // the operator can compare them in Render's log against their Vercel
      // setting without redeploying.
      if (err.tokenAud || err.serverAud) {
        console.warn(`[auth]   token aud  = ${err.tokenAud}`)
        console.warn(`[auth]   server aud = ${err.serverAud}`)
      }
      return res.status(401).json({
        error: code,
        // Surface the reason in non-prod so the client can show something
        // useful. In prod we keep the message generic to avoid leaking the
        // configured client_id.
        detail: process.env.NODE_ENV === 'production' ? undefined : err.message
      })
    }

    try {
      const user = await upsertGoogleUser(profile)
      const token = sign({ sub: user.id, email: user.email, name: user.display_name })
      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          avatarUrl: user.avatar_url
        }
      })
    } catch (err) {
      console.error('[auth] upsert/sign failed:', err)
      res.status(500).json({
        error: 'user_persist_failed',
        detail: process.env.NODE_ENV === 'production' ? undefined : err.message
      })
    }
  })

  router.get('/me', authRequired, async (req, res) => {
    const user = await findUserById(req.user.id)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url
      }
    })
  })

  router.patch('/me', authRequired, async (req, res) => {
    const { displayName, avatarUrl } = req.body || {}
    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0 || displayName.length > 64)) {
      return res.status(400).json({ error: 'invalid_display_name' })
    }
    if (avatarUrl !== undefined && avatarUrl !== null && (typeof avatarUrl !== 'string' || avatarUrl.length > 512)) {
      return res.status(400).json({ error: 'invalid_avatar_url' })
    }
    const updated = await updateUserProfile(req.user.id, {
      displayName: displayName?.trim(),
      avatarUrl: avatarUrl ?? undefined
    })
    if (!updated) return res.status(404).json({ error: 'user_not_found' })
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        avatarUrl: updated.avatar_url
      }
    })
  })

  return router
}
