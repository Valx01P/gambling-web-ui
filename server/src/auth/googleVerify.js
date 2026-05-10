import { OAuth2Client } from 'google-auth-library'

let client = null

function getClient() {
  const audience = process.env.GOOGLE_CLIENT_ID
  if (!audience) throw new Error('GOOGLE_CLIENT_ID is not set.')
  if (!client) client = new OAuth2Client(audience)
  return client
}

export async function verifyGoogleIdToken(idToken) {
  const audience = process.env.GOOGLE_CLIENT_ID
  const ticket = await getClient().verifyIdToken({ idToken, audience })
  const payload = ticket.getPayload()
  if (!payload) throw new Error('Invalid Google credential')

  if (payload.aud !== audience) throw new Error('Audience mismatch')
  if (!payload.email_verified) throw new Error('Email not verified by Google')

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || null
  }
}
