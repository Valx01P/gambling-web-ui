import { randomUUID } from 'node:crypto'
import { rateLimit, ipKeyGenerator } from 'express-rate-limit'
import { asyncRouter as Router } from '../api/asyncRouter.js'
import { authOptional, authRequired } from '../auth/middleware.js'
import {
  createPresignedUploadUrl,
  publicUrlForKey,
  deleteObject,
  ALLOWED_IMAGE_CONTENT_TYPES,
  extensionForContentType,
} from '../aws/s3.js'
import {
  listForUser as listPfps,
  getById as getPfpById,
  create as createPfp,
  deleteForUser as deletePfp,
  pruneToLimit as prunePfps,
} from '../users/pfpRepository.js'

// Hard cap on saved profile pictures per user. Older uploads get
// auto-evicted on every new save so the roster stays compact and the
// user can re-pick from their recent 5 without scrolling.
const PFP_HISTORY_LIMIT = 5

// Default byte cap if the env var isn't set. Kept here so a misconfigured
// deploy doesn't accidentally allow a multi-gigabyte upload — the env
// value is treated as an upper limit.
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 // 5 MiB

function maxUploadBytes() {
  const raw = parseInt(process.env.UPLOAD_MAX_BYTES || '', 10)
  if (Number.isFinite(raw) && raw > 0) return raw
  return DEFAULT_MAX_BYTES
}

// Presign endpoint is generously open to anon users (the lobby's "play
// anonymously with an uploaded image" flow uses it) but per-key-genned
// rate limit prevents a single bad actor from spamming presign requests.
// The S3 PUT itself is also rate-limited by the presigned URL's 60s expiry
// and by the IAM user's policy scope.
const presignLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { error: 'rate_limited', detail: 'Too many upload requests. Wait a minute.' },
})

export function uploadRoutes() {
  const router = Router()

  // POST /api/uploads/presign
  // Body: { kind: 'pfp', contentType, size }
  // Returns: { uploadUrl, key, publicUrl, expiresIn }
  //
  // For signed-in users the key lives under `users/<uuid>/pfp/<uuid>.<ext>`
  // and persists indefinitely. For anonymous users it lives under
  // `tmp/anon/<uuid>.<ext>` and is reaped by the bucket's lifecycle rule
  // after 24 hours — the client only ever holds the public URL in memory
  // for that session, so there's nothing to clean up server-side.
  router.post('/presign', authOptional, presignLimiter, async (req, res) => {
    if (!process.env.S3_BUCKET_NAME) {
      return res.status(503).json({ error: 'uploads_not_configured' })
    }
    const { kind, contentType, size } = req.body || {}

    if (kind !== 'pfp') {
      return res.status(400).json({ error: 'unsupported_kind', detail: 'kind must be "pfp"' })
    }
    if (typeof contentType !== 'string' || !ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      return res.status(400).json({ error: 'unsupported_content_type' })
    }
    const sz = Number(size)
    if (!Number.isFinite(sz) || sz <= 0) {
      return res.status(400).json({ error: 'invalid_size' })
    }
    const cap = maxUploadBytes()
    if (sz > cap) {
      return res.status(413).json({ error: 'too_large', detail: `Max ${cap} bytes.` })
    }

    const ext = extensionForContentType(contentType)
    const objectId = randomUUID()
    const key = req.user
      ? `users/${req.user.id}/pfp/${objectId}.${ext}`
      : `tmp/anon/${objectId}.${ext}`

    try {
      const uploadUrl = await createPresignedUploadUrl({ key, contentType, expiresIn: 60 })
      return res.json({
        uploadUrl,
        key,
        publicUrl: publicUrlForKey(key),
        expiresIn: 60,
      })
    } catch (err) {
      console.error('[uploads] presign failed:', err)
      return res.status(500).json({ error: 'presign_failed' })
    }
  })

  // POST /api/users/me/pfps
  // Called by the client after a successful PUT to S3. Records the upload
  // in the user's history so it shows up in the picker. Body must echo the
  // exact key/url returned from /presign so we can't be tricked into
  // recording a third-party URL.
  router.post('/me/pfps', authRequired, async (req, res) => {
    const { key, publicUrl, contentType, byteSize } = req.body || {}
    if (typeof key !== 'string' || !key.startsWith(`users/${req.user.id}/`)) {
      return res.status(400).json({ error: 'invalid_key' })
    }
    if (typeof publicUrl !== 'string' || publicUrl.length > 512) {
      return res.status(400).json({ error: 'invalid_public_url' })
    }
    if (publicUrl !== publicUrlForKey(key)) {
      return res.status(400).json({ error: 'public_url_mismatch' })
    }
    if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
      return res.status(400).json({ error: 'unsupported_content_type' })
    }
    const sz = Number(byteSize)
    if (!Number.isFinite(sz) || sz <= 0 || sz > maxUploadBytes()) {
      return res.status(400).json({ error: 'invalid_size' })
    }
    try {
      const pfp = await createPfp(req.user.id, {
        s3Key: key,
        publicUrl,
        contentType,
        byteSize: sz,
      })
      // Cap the history. Pruning runs in the same request so the user
      // can't briefly observe >5 PFPs through a race. S3 cleanup of the
      // evicted objects is fire-and-forget — if it fails the DB row is
      // already gone and the orphan S3 object will sit (CloudFront +
      // bucket policy keep it private, so the only cost is storage).
      try {
        const droppedKeys = await prunePfps(req.user.id, PFP_HISTORY_LIMIT)
        for (const droppedKey of droppedKeys) {
          deleteObject(droppedKey).catch(err =>
            console.warn('[uploads] prune cleanup failed for', droppedKey, '—', err.message)
          )
        }
      } catch (err) {
        // Pruning failure shouldn't roll back the save the user already made.
        console.warn('[uploads] history prune failed:', err.message)
      }
      return res.status(201).json({ pfp })
    } catch (err) {
      console.error('[uploads] pfp save failed:', err)
      return res.status(500).json({ error: 'pfp_save_failed' })
    }
  })

  router.get('/me/pfps', authRequired, async (req, res) => {
    const pfps = await listPfps(req.user.id)
    res.json({ pfps })
  })

  // Soft-delete from history. The S3 object is deleted best-effort —
  // if it fails the row is still gone and lifecycle will reap the
  // orphan eventually. Returns 204.
  router.delete('/me/pfps/:id', authRequired, async (req, res) => {
    const pfp = await getPfpById(req.params.id, req.user.id)
    if (!pfp) return res.status(404).json({ error: 'not_found' })
    await deletePfp(req.params.id, req.user.id)
    try {
      await deleteObject(pfp.s3Key)
    } catch (err) {
      console.warn('[uploads] s3 delete failed (will be reaped by lifecycle):', err.message)
    }
    res.status(204).end()
  })

  return router
}
