import jwt from 'jsonwebtoken'

const ISSUER = 'gambling-web-ui'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET is missing or too short (need >= 32 chars). See server/.env.example.')
  }
  return secret
}

export function sign(payload) {
  const ttl = Number(process.env.JWT_TTL_SECONDS || 60 * 60 * 24 * 30)
  return jwt.sign(payload, getSecret(), { expiresIn: ttl, issuer: ISSUER })
}

export function verify(token) {
  return jwt.verify(token, getSecret(), { issuer: ISSUER })
}
