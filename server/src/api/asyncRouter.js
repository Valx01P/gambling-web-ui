import { Router } from 'express'

// Express 4 routers don't forward async-handler rejections to the error
// middleware on their own. If `router.get('/x', async (req, res) => { ... })`
// throws, the response never gets sent — the connection hangs and Render's
// edge serves a 502 after timeout. That's the exact symptom users see when
// the DB is misconfigured in production.
//
// asyncRouter() returns a normal Express Router with the verb methods
// wrapped so any AsyncFunction we register gets a `.catch(next)` shim.
// Sync handlers and middleware are passed through untouched. Drop it in
// place of Router() anywhere you have async route handlers.
function asyncSafe(handler) {
  return (req, res, next) => {
    try { Promise.resolve(handler(req, res, next)).catch(next) }
    catch (err) { next(err) }
  }
}

const WRAPPED_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']

export function asyncRouter(options) {
  const r = Router(options)
  for (const method of WRAPPED_METHODS) {
    const original = r[method].bind(r)
    r[method] = (...args) => {
      const wrapped = args.map(a =>
        typeof a === 'function' && a.constructor?.name === 'AsyncFunction'
          ? asyncSafe(a)
          : a
      )
      return original(...wrapped)
    }
  }
  return r
}
