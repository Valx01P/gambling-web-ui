import { Router } from 'express'
import { authRoutes } from '../auth/authRoutes.js'
import { botRoutes } from '../bots/botRoutes.js'
import { uploadRoutes } from '../uploads/uploadRoutes.js'
import { userHistoryRoutes } from '../users/userHistoryRoutes.js'
import { userPublicRoutes } from '../users/userPublicRoutes.js'

export function apiRouter() {
  const router = Router()
  router.use('/auth', authRoutes())
  router.use('/bots', botRoutes())
  router.use('/uploads', uploadRoutes())
  // Order matters: /users/me/* must mount before /users/:userId/* so the
  // "me" routes win against the userId-shaped pattern.
  router.use('/users/me', userHistoryRoutes())
  router.use('/users', userPublicRoutes())
  return router
}
