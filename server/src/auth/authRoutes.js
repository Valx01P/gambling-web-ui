import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { verifyGoogleIdToken } from './googleVerify.js'
import { sign } from './jwt.js'
import { authRequired } from './middleware.js'
import { upsertGoogleUser, updateUserProfile, findUserById } from '../users/userRepository.js'
import { sanitizeDisplayString } from '../utils/sanitize.js'

// Hard cap on Google sign-in attempts per IP. The verify step does a paid
// cryptographic check against Google's JWKS — abusable in two ways: (1) brute
// force fishing for a valid token, (2) DDoS by burning our verify budget.
// 20 attempts per minute is generous for a real user (typically 1) and
// well below any cost concern.
const googleSignInLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited', detail: 'Too many sign-in attempts. Wait a minute and try again.' },
})

// Profile update — protect against rapid-fire account churn. authRequired
// gates these to a logged-in user, so per-user keying via JWT sub is the
// right scope (one user, many tabs ≠ separate quotas).
const profileUpdateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Slow down — try again in a moment.' },
})

export function authRoutes() {
  const router = Router()

  router.post('/google', googleSignInLimiter, async (req, res) => {
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
      // setting without redeploying. Lengths + JSON-quoted tail catch the
      // case where the strings *look* identical but the env var has stray
      // whitespace / control characters at the end.
      if (err.tokenAud || err.serverAud) {
        console.warn(`[auth]   token aud  = ${err.tokenAud}  (len=${err.tokenAudLen}, tail=${err.tokenAudTail})`)
        console.warn(`[auth]   server aud = ${err.serverAud}  (len=${err.serverAudLen}, tail=${err.serverAudTail})`)
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
      // Google's `name` field can contain anything the user set on their
      // Google profile — including bidi marks and zero-width chars that
      // would render misleadingly at the table. Sanitize before persisting.
      //
      // Important: try each fallback through the sanitizer individually.
      // A naive `profile.name || profile.email || 'Player'` would short-
      // circuit on a truthy-but-all-hostile-chars name and then sanitize
      // it to "", persisting an empty display_name. Walk the candidates
      // and take the first one that survives sanitization with content.
      const nameCandidates = [
        profile.name,
        profile.email?.split('@')[0],
        'Player',
      ]
      let cleanName = ''
      for (const candidate of nameCandidates) {
        cleanName = sanitizeDisplayString(candidate || '', { maxLength: 64 })
        if (cleanName) break
      }
      const cleanProfile = { ...profile, name: cleanName }
      const user = await upsertGoogleUser(cleanProfile)
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

  router.patch('/me', authRequired, profileUpdateLimiter, async (req, res) => {
    const { displayName, avatarUrl } = req.body || {}
    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 64)) {
      return res.status(400).json({ error: 'invalid_display_name' })
    }
    // Reject obviously-bogus avatar URLs early — must parse and be http(s).
    if (avatarUrl !== undefined && avatarUrl !== null) {
      if (typeof avatarUrl !== 'string' || avatarUrl.length > 512) {
        return res.status(400).json({ error: 'invalid_avatar_url' })
      }
      try {
        const parsed = new URL(avatarUrl)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return res.status(400).json({ error: 'invalid_avatar_url' })
        }
      } catch {
        return res.status(400).json({ error: 'invalid_avatar_url' })
      }
    }
    const cleanDisplayName = displayName !== undefined
      ? sanitizeDisplayString(displayName, { maxLength: 64 })
      : undefined
    if (cleanDisplayName !== undefined && cleanDisplayName.length === 0) {
      return res.status(400).json({ error: 'invalid_display_name' })
    }
    const updated = await updateUserProfile(req.user.id, {
      displayName: cleanDisplayName,
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
