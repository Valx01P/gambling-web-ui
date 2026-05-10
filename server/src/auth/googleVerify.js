import { OAuth2Client } from 'google-auth-library'

let client = null

// Trimmed-and-validated audience reader. Render's env-var UI happily preserves
// trailing newlines and spaces when you paste a value, which produces an
// audience-mismatch even when the string LOOKS identical to the token's
// aud claim. Trimming on read makes this class of footgun impossible.
function getAudience() {
  const raw = process.env.GOOGLE_CLIENT_ID
  if (!raw) return ''
  return raw.trim()
}

function getClient() {
  const audience = getAudience()
  if (!audience) throw new Error('GOOGLE_CLIENT_ID is not set.')
  if (!client) client = new OAuth2Client(audience)
  return client
}

// Helper: decode the unverified payload portion of a JWT just so we can log
// useful context when verification fails (audience mismatch is by far the
// most common cause and we want to surface it without making the operator
// dig through Google docs). NOT used for trust — only for diagnostics.
function peekPayload(idToken) {
  try {
    const part = idToken.split('.')[1]
    if (!part) return null
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(json)
  } catch { return null }
}

export async function verifyGoogleIdToken(idToken) {
  const audience = getAudience()
  if (!audience) {
    const err = new Error('Server GOOGLE_CLIENT_ID is not set')
    err.code = 'server_misconfigured'
    throw err
  }

  // Cheap pre-check: peek the token's claimed audience and compare against
  // our configured one. If they differ, we can give a precise error message
  // without waiting for Google's library to throw a generic one.
  const peek = peekPayload(idToken)
  if (peek?.aud && peek.aud !== audience) {
    const err = new Error(`Audience mismatch: token aud=${peek.aud} but server GOOGLE_CLIENT_ID=${audience.slice(0, 12)}…`)
    err.code = 'audience_mismatch'
    err.tokenAud = peek.aud
    err.serverAud = audience
    // Hidden-character forensics: if the strings look identical but `!==`
    // fires, the cause is almost always trailing whitespace or stray
    // control characters in the env var. Surface the lengths + the last
    // few char codes so the operator can see at a glance.
    err.tokenAudLen = peek.aud.length
    err.serverAudLen = audience.length
    err.serverAudTail = JSON.stringify(audience.slice(-4))
    err.tokenAudTail = JSON.stringify(peek.aud.slice(-4))
    throw err
  }

  let ticket
  try {
    // Pass the trimmed audience explicitly so google-auth-library compares
    // against the cleaned value, not whatever was in the original env.
    ticket = await getClient().verifyIdToken({ idToken, audience })
  } catch (err) {
    const wrapped = new Error(`Google verifyIdToken failed: ${err.message}`)
    wrapped.code = 'verify_failed'
    wrapped.cause = err
    throw wrapped
  }
  const payload = ticket.getPayload()
  if (!payload) {
    const err = new Error('Invalid Google credential payload')
    err.code = 'invalid_payload'
    throw err
  }
  if (payload.aud !== audience) {
    const err = new Error(`Audience mismatch after verify: ${payload.aud} vs ${audience}`)
    err.code = 'audience_mismatch'
    throw err
  }
  if (!payload.email_verified) {
    const err = new Error('Email not verified by Google')
    err.code = 'email_unverified'
    throw err
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || null
  }
}
