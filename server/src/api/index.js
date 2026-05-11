import { Router } from 'express'
import { authRoutes } from '../auth/authRoutes.js'
import { botRoutes } from '../bots/botRoutes.js'
import { uploadRoutes } from '../uploads/uploadRoutes.js'

export function apiRouter() {
  const router = Router()
  router.use('/auth', authRoutes())
  router.use('/bots', botRoutes())
  router.use('/uploads', uploadRoutes())
  return router
}
