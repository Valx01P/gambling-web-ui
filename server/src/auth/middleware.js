import { verify } from './jwt.js'

function readToken(req) {
  const header = req.headers.authorization
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim()
  if (req.cookies?.session) return req.cookies.session
  return null
}

export function authOptional(req, _res, next) {
  const token = readToken(req)
  if (!token) return next()
  try {
    const payload = verify(token)
    req.user = { id: payload.sub, ...payload }
  } catch {
    // Ignore — invalid token means anonymous request, not 401, for optional middleware.
  }
  next()
}

export function authRequired(req, res, next) {
  const token = readToken(req)
  if (!token) return res.status(401).json({ error: 'auth_required' })
  try {
    const payload = verify(token)
    req.user = { id: payload.sub, ...payload }
    next()
  } catch {
    res.status(401).json({ error: 'invalid_token' })
  }
}
