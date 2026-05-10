import { Router } from 'express'
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
    try {
      const profile = await verifyGoogleIdToken(credential)
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
      console.warn('[auth] google verify failed:', err.message)
      res.status(401).json({ error: 'invalid_credential' })
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
