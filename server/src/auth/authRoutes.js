import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { verifyGoogleIdToken } from './googleVerify.js'
import { sign } from './jwt.js'
import { authRequired } from './middleware.js'
import {
  upsertGoogleUser, updateUserProfile, findUserById,
  createNativeUser, findUserByEmail, findUserByUsername,
  markEmailVerified, setPasswordHash
} from '../users/userRepository.js'
import { sanitizeDisplayString } from '../utils/sanitize.js'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from './password.js'
import { query } from '../db/pool.js'
import {
  issueCode, findActiveCode, recordFailedAttempt, consumeCode,
  EMAIL_CODE_TTL_MINUTES
} from './verificationRepository.js'
import { sendEmail, renderSignupVerifyEmail, renderPasswordResetEmail } from './email.js'

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
          avatarUrl: user.avatar_url,
          elo: user.elo ?? null,
          handsPlayed: user.hands_played ?? 0,
          handsWon: user.hands_won ?? 0
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
        avatarUrl: user.avatar_url,
        description: user.description ?? null,
        elo: user.elo ?? null,
        handsPlayed: user.hands_played ?? 0,
        handsWon: user.hands_won ?? 0,
        // Felt color — site-wide background tint preference (see
        // client/app/lib/feltColor.js). Surfaced here so every page
        // that already reads /auth/me on mount gets the user's pick
        // without an extra round-trip.
        feltColorId: user.felt_color_id ?? null,
        feltCustomColors: Array.isArray(user.felt_custom_colors)
          ? user.felt_custom_colors
          : (user.felt_custom_colors ?? null)
      }
    })
  })

  // Cap chosen to fit roughly one short Twitter-style bio. Plenty for a
  // tagline; not so much that a profile becomes a wall of text.
  const MAX_DESCRIPTION_LENGTH = 280

  router.patch('/me', authRequired, profileUpdateLimiter, async (req, res) => {
    const { displayName, avatarUrl, description } = req.body || {}
    if (displayName !== undefined && (typeof displayName !== 'string' || displayName.length > 64)) {
      return res.status(400).json({ error: 'invalid_display_name' })
    }
    // description: undefined = unchanged, '' = clear, string = set.
    // null is treated as clear so PATCH-with-null also works.
    if (description !== undefined && description !== null && typeof description !== 'string') {
      return res.status(400).json({ error: 'invalid_description' })
    }
    if (typeof description === 'string' && description.length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({
        error: 'invalid_description',
        detail: `Description is too long (max ${MAX_DESCRIPTION_LENGTH} characters).`
      })
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
    // Sanitize bio the same way we sanitize names (strips control chars,
    // collapses whitespace). Empty string is preserved — that's the
    // "clear my bio" signal.
    const cleanDescription = description === undefined
      ? undefined
      : description === null
        ? ''
        : sanitizeDisplayString(description, { maxLength: MAX_DESCRIPTION_LENGTH })
    const updated = await updateUserProfile(req.user.id, {
      displayName: cleanDisplayName,
      avatarUrl: avatarUrl ?? undefined,
      description: cleanDescription
    })
    if (!updated) return res.status(404).json({ error: 'user_not_found' })
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        displayName: updated.display_name,
        avatarUrl: updated.avatar_url,
        description: updated.description ?? null
      }
    })
  })

  // POST /api/auth/me/felt — persist the user's site-wide felt color
  // preference. Accepts `{ colorId, customColors }`. colorId can be:
  //   * one of the built-in TABLE_COLOR_PALETTES ids (e.g. 'emerald')
  //   * a custom slot id 'custom-0' … 'custom-4'
  //   * null to clear the saved choice (revert to default on next load)
  // customColors is an array of up to 5 `{ hex, label }` entries; any
  // entry without a valid 6-digit hex is silently dropped. Validated
  // here against the same shape the client persists in localStorage so
  // a tampered request can't smuggle in unusable rows.
  router.post('/me/felt', authRequired, profileUpdateLimiter, async (req, res) => {
    const HEX = /^#[0-9a-fA-F]{6}$/
    const VALID_BUILTIN = new Set(['emerald', 'forest', 'sapphire', 'crimson', 'royal'])
    const rawId = req.body?.colorId
    let colorId = null
    if (typeof rawId === 'string') {
      if (VALID_BUILTIN.has(rawId)) colorId = rawId
      else if (/^custom-[0-4]$/.test(rawId)) colorId = rawId
    } else if (rawId === null) {
      colorId = null
    } else if (rawId !== undefined) {
      return res.status(400).json({ error: 'invalid_color_id' })
    }
    let customColors = null
    if (Array.isArray(req.body?.customColors)) {
      customColors = req.body.customColors
        .slice(0, 5)
        .map(entry => {
          if (!entry || typeof entry.hex !== 'string') return null
          const hex = entry.hex.startsWith('#') ? entry.hex : `#${entry.hex}`
          if (!HEX.test(hex)) return null
          const label = typeof entry.label === 'string' && entry.label.length <= 24
            ? entry.label
            : 'Custom'
          return { hex, label }
        })
        .filter(Boolean)
    }
    await query(
      `UPDATE users
          SET felt_color_id = $2,
              felt_custom_colors = $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [req.user.id, colorId, customColors ? JSON.stringify(customColors) : null]
    )
    res.json({ feltColorId: colorId, feltCustomColors: customColors })
  })

  // === Native email/password auth ========================================
  // Three flows: signup → verify → login. Plus password reset (forgot
  // password) and authenticated password change. Anti-abuse rate limits
  // are tight: cheap requests with code-emailing are gated harder than
  // pure read paths.

  // Per-email signup rate-limit. Loose enough for a real user retry,
  // tight enough that you can't enumerate the email column.
  const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 5,
    standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${(req.body?.email || '').toLowerCase()}`,
    message: { error: 'rate_limited', detail: 'Too many signup attempts. Try again in a bit.' }
  })
  // Verify is hit by anyone with the email — keep it per-IP only so a
  // shared NAT can still verify, but a single attacker can't brute force.
  const verifyLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 12,
    standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: { error: 'rate_limited', detail: 'Too many code attempts. Wait a moment.' }
  })
  // Resend pings should be more expensive than a verify attempt — every
  // resend triggers an actual outbound email.
  const resendLimiter = rateLimit({
    windowMs: 60 * 1000, limit: 3,
    standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${(req.body?.email || '').toLowerCase()}`,
    message: { error: 'rate_limited', detail: 'Slow down — codes are throttled to avoid spam.' }
  })

  // Username + email validators — defensive, app-layer matches the SQL
  // constraints. Mirror the DB's case-insensitive unique by lowercasing
  // before comparison.
  const USERNAME_RE = /^[a-z0-9_]{3,24}$/
  function isValidEmail(s) {
    if (typeof s !== 'string') return false
    if (s.length > 254 || s.length < 5) return false
    // RFC-lite. Don't over-validate — Resend will reject anything that's
    // truly malformed. We just need to keep obvious junk out of the DB.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
  }
  function normalizeEmail(s) { return String(s).trim().toLowerCase() }

  // -----------------------------------------------------------------------
  // POST /api/auth/signup
  // Body: { email, password, username }
  // Creates an UNVERIFIED user + issues a 6-digit code emailed to them.
  // Doesn't return a JWT — the caller has to verify first. Idempotent
  // on email collision: if the email already exists AND is unverified,
  // we re-issue a code instead of erroring (so abandoning the modal and
  // restarting works).
  // -----------------------------------------------------------------------
  router.post('/signup', signupLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    const password = req.body?.password
    const rawUsername = req.body?.username
    if (!isValidEmail(rawEmail)) return res.status(400).json({ error: 'invalid_email' })
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'invalid_password', detail: `Use ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.` })
    }
    if (typeof rawUsername !== 'string' || !USERNAME_RE.test(rawUsername.toLowerCase())) {
      return res.status(400).json({ error: 'invalid_username', detail: '3–24 chars, lowercase letters / digits / underscore only.' })
    }
    const email = normalizeEmail(rawEmail)
    const username = rawUsername.toLowerCase()

    try {
      const existing = await findUserByEmail(email)
      let user
      if (existing) {
        if (existing.email_verified_at) {
          // Verified account — actual collision, don't leak whether the
          // password is right by attempting to log them in here.
          return res.status(409).json({ error: 'email_in_use', detail: 'That email is already registered. Try signing in instead.' })
        }
        // Unverified — let them restart the flow (e.g. they refreshed).
        user = existing
        // Update password + username in case they're trying different values.
        const pwHash = await hashPassword(password)
        await setPasswordHash(user.id, pwHash)
      } else {
        // New row. Check the username uniqueness before the INSERT to
        // give a tidy error; the DB constraint catches races too.
        const usernameTaken = await findUserByUsername(username)
        if (usernameTaken) return res.status(409).json({ error: 'username_in_use' })
        const pwHash = await hashPassword(password)
        const displayName = sanitizeDisplayString(username, { maxLength: 32 }) || username
        user = await createNativeUser({ email, passwordHash: pwHash, username, displayName })
      }

      // Issue + send code. If the email subsystem is down we still
      // succeed at the API level so the user isn't locked out of
      // retrying — but the response signals it so the client can
      // surface a "couldn't send email" message.
      const codeRow = await issueCode(user.id, 'signup')
      const tpl = renderSignupVerifyEmail({
        code: codeRow.code,
        ttlMinutes: EMAIL_CODE_TTL_MINUTES,
        displayName: user.display_name || user.username
      })
      const sent = await sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text })

      res.status(201).json({
        ok: true,
        email,
        ttlMinutes: EMAIL_CODE_TTL_MINUTES,
        emailSent: sent.ok,
        emailError: sent.ok ? undefined : sent.error
      })
    } catch (err) {
      console.error('[auth] signup failed:', err)
      res.status(500).json({ error: 'internal_error' })
    }
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/verify
  // Body: { email, code }
  // Validates the 6-digit signup code and, on success, marks the email
  // verified + returns the JWT + user payload. The modal flow ends here.
  // -----------------------------------------------------------------------
  router.post('/verify', verifyLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    const code = String(req.body?.code || '').trim()
    if (!isValidEmail(rawEmail)) return res.status(400).json({ error: 'invalid_email' })
    if (!/^[0-9]{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' })
    const email = normalizeEmail(rawEmail)
    const user = await findUserByEmail(email)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    if (user.email_verified_at) {
      // Already verified — treat as success so a retry after a slow
      // network doesn't strand the user.
      const token = sign({ sub: user.id, email: user.email, name: user.display_name })
      return res.json({ token, user: serializeUser(user) })
    }
    const row = await findActiveCode(user.id, 'signup')
    if (!row) return res.status(400).json({ error: 'code_expired' })
    if (row.code !== code) {
      const after = await recordFailedAttempt(row.id)
      const burned = !!after?.consumed_at
      return res.status(400).json({
        error: burned ? 'code_locked' : 'code_mismatch',
        detail: burned ? 'Too many wrong tries. Request a fresh code.' : 'That code doesn\'t match.'
      })
    }
    await consumeCode(row.id)
    await markEmailVerified(user.id)
    const token = sign({ sub: user.id, email: user.email, name: user.display_name })
    res.json({ token, user: serializeUser(user) })
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/resend-code
  // Body: { email, purpose? }  purpose defaults to 'signup'.
  // Issues a fresh code + emails it. Anti-spam via resendLimiter.
  // -----------------------------------------------------------------------
  router.post('/resend-code', resendLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    const purpose = req.body?.purpose === 'reset' ? 'reset' : 'signup'
    if (!isValidEmail(rawEmail)) return res.status(400).json({ error: 'invalid_email' })
    const email = normalizeEmail(rawEmail)
    const user = await findUserByEmail(email)
    // Don't reveal whether the email exists. Either way the client
    // sees the same "ok, check your email" message; only actually
    // existing accounts get the email.
    if (user) {
      // Signup resend only valid if not yet verified. Reset is valid
      // anytime — pre-verified accounts can still request a reset.
      if (purpose === 'signup' && user.email_verified_at) {
        return res.json({ ok: true, ttlMinutes: EMAIL_CODE_TTL_MINUTES })
      }
      const codeRow = await issueCode(user.id, purpose)
      const tpl = purpose === 'reset'
        ? renderPasswordResetEmail({ code: codeRow.code, ttlMinutes: EMAIL_CODE_TTL_MINUTES, displayName: user.display_name })
        : renderSignupVerifyEmail({ code: codeRow.code, ttlMinutes: EMAIL_CODE_TTL_MINUTES, displayName: user.display_name })
      sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(err =>
        console.warn('[auth] resend email failed:', err.message)
      )
    }
    res.json({ ok: true, ttlMinutes: EMAIL_CODE_TTL_MINUTES })
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/login
  // Body: { email, password }
  // Native sign-in. Unverified accounts get a special error so the client
  // can re-open the verify-code modal seamlessly instead of telling the
  // user "wrong password."
  // -----------------------------------------------------------------------
  router.post('/login', signupLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    const password = req.body?.password
    if (!isValidEmail(rawEmail) || typeof password !== 'string') {
      return res.status(400).json({ error: 'invalid_credentials' })
    }
    const email = normalizeEmail(rawEmail)
    const user = await findUserByEmail(email)
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'invalid_credentials' })
    }
    const ok = await verifyPassword(password, user.password_hash)
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' })
    if (!user.email_verified_at) {
      // Re-issue a code so the modal can pop into verify mode without
      // the user having to click "resend".
      const codeRow = await issueCode(user.id, 'signup')
      const tpl = renderSignupVerifyEmail({ code: codeRow.code, ttlMinutes: EMAIL_CODE_TTL_MINUTES, displayName: user.display_name })
      sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(err =>
        console.warn('[auth] auto-resend on login failed:', err.message)
      )
      return res.status(403).json({ error: 'email_unverified', detail: 'Check your email for a fresh code.' })
    }
    const token = sign({ sub: user.id, email: user.email, name: user.display_name })
    res.json({ token, user: serializeUser(user) })
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/forgot
  // Body: { email }
  // Always returns ok; sends a reset code if the email exists. Caller
  // moves into the reset-code UI regardless so we don't leak account
  // existence.
  // -----------------------------------------------------------------------
  router.post('/forgot', resendLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    if (!isValidEmail(rawEmail)) return res.status(400).json({ error: 'invalid_email' })
    const email = normalizeEmail(rawEmail)
    const user = await findUserByEmail(email)
    if (user) {
      const codeRow = await issueCode(user.id, 'reset')
      const tpl = renderPasswordResetEmail({ code: codeRow.code, ttlMinutes: EMAIL_CODE_TTL_MINUTES, displayName: user.display_name })
      sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text }).catch(err =>
        console.warn('[auth] forgot email failed:', err.message)
      )
    }
    res.json({ ok: true, ttlMinutes: EMAIL_CODE_TTL_MINUTES })
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/reset
  // Body: { email, code, newPassword }
  // Validates the reset code and sets a new password. Returns a JWT so
  // the user is signed-in immediately after.
  // -----------------------------------------------------------------------
  router.post('/reset', verifyLimiter, async (req, res) => {
    const rawEmail = req.body?.email
    const code = String(req.body?.code || '').trim()
    const newPassword = req.body?.newPassword
    if (!isValidEmail(rawEmail)) return res.status(400).json({ error: 'invalid_email' })
    if (!/^[0-9]{6}$/.test(code)) return res.status(400).json({ error: 'invalid_code' })
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'invalid_password' })
    }
    const email = normalizeEmail(rawEmail)
    const user = await findUserByEmail(email)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    const row = await findActiveCode(user.id, 'reset')
    if (!row) return res.status(400).json({ error: 'code_expired' })
    if (row.code !== code) {
      const after = await recordFailedAttempt(row.id)
      return res.status(400).json({
        error: after?.consumed_at ? 'code_locked' : 'code_mismatch'
      })
    }
    const pwHash = await hashPassword(newPassword)
    await setPasswordHash(user.id, pwHash)
    await markEmailVerified(user.id) // resetting implies the email is in their control
    await consumeCode(row.id)
    const token = sign({ sub: user.id, email: user.email, name: user.display_name })
    res.json({ token, user: serializeUser(user) })
  })

  // -----------------------------------------------------------------------
  // POST /api/auth/change-password
  // Body: { currentPassword, newPassword }  Auth required.
  // Changing while signed-in doesn't need an email round-trip — we just
  // verify the current password and update. Useful for users who linked
  // a password to an originally-Google account too.
  // -----------------------------------------------------------------------
  router.post('/change-password', authRequired, profileUpdateLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body || {}
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'invalid_password' })
    }
    const user = await findUserByEmail(req.user.email)
    if (!user) return res.status(404).json({ error: 'user_not_found' })
    // If they already have a password, require the old one. If they
    // don't (Google-only account adding a password for the first time),
    // skip the current-password check.
    if (user.password_hash) {
      if (typeof currentPassword !== 'string' || !(await verifyPassword(currentPassword, user.password_hash))) {
        return res.status(401).json({ error: 'invalid_credentials' })
      }
    }
    const pwHash = await hashPassword(newPassword)
    await setPasswordHash(user.id, pwHash)
    res.json({ ok: true })
  })

  return router
}

// Shared serializer for any path that ends with "give me back the user".
// Mirrors the shape /me uses so the client's hydrate path doesn't have
// to branch on which auth flow produced the payload.
function serializeUser(u) {
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    username: u.username || null,
    avatarUrl: u.avatar_url ?? null,
    elo: u.elo ?? null,
    handsPlayed: u.hands_played ?? 0,
    handsWon: u.hands_won ?? 0
  }
}
