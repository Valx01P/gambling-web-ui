import { Router } from 'express'
import { authRoutes } from '../auth/authRoutes.js'
import { botRoutes } from '../bots/botRoutes.js'
import { uploadRoutes } from '../uploads/uploadRoutes.js'
import { userHistoryRoutes } from '../users/userHistoryRoutes.js'
import { userPublicRoutes } from '../users/userPublicRoutes.js'
import { dailiesRoutes } from '../dailies/routes.js'

export function apiRouter() {
  const router = Router()
  router.use('/auth', authRoutes())
  router.use('/bots', botRoutes())
  router.use('/uploads', uploadRoutes())
  // Order matters: /users/me/* must mount before /users/:userId/* so the
  // "me" routes win against the userId-shaped pattern.
  router.use('/users/me', userHistoryRoutes())
  router.use('/users', userPublicRoutes())
  // /api/dailies/today, /api/dailies/achievements, /api/dailies/me/skin.
  // (The skin route is technically a /me endpoint but lives here to keep
  //  the daily/skin progression in one place.)
  router.use('/dailies', dailiesRoutes())
  return router
}
