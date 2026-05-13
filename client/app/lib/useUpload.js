'use client'

import { useCallback, useState } from 'react'
import { api } from './api'

// Uploads a Blob directly to S3 via a server-issued presigned PUT URL.
//
// Flow:
//   1. POST /api/uploads/presign  → { uploadUrl, key, publicUrl }
//   2. PUT  uploadUrl with the blob bytes (no auth header — the signature
//      IS the auth)
//   3. Optional: POST /api/uploads/me/pfps to save it to the user's history
//      (only for signed-in users, who are the only ones with persistent
//      object keys — anon uploads live under tmp/ and get reaped by the
//      bucket lifecycle).
//
// The hook exposes a single `upload(blob, { saveToHistory })` call. Returns
// `{ publicUrl, key, pfp? }` on success. `pfp` is the saved-history record
// when `saveToHistory` is true.
export function useUpload() {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)

  const upload = useCallback(async (blob, { saveToHistory = false, kind = 'pfp' } = {}) => {
    setError(null)
    setBusy(true)
    setProgress(0)
    try {
      if (!blob || !(blob instanceof Blob)) {
        throw new Error('Invalid file')
      }
      const contentType = blob.type || 'application/octet-stream'
      const size = blob.size

      // Step 1: presign. `kind` lets callers route the upload to a
      // different S3 folder (`pfp` vs `post`) without changing the rest
      // of the flow.
      const presign = await api.presignUpload({ kind, contentType, size })

      // Step 2: PUT directly to S3 using fetch. We dropped XMLHttpRequest
      // (and the upload-progress UI it powered) because XHR's onerror is
      // opaque — the browser, by design, hides the cause to prevent
      // cross-origin probing. fetch separates "HTTP response of any kind"
      // from "request never made it", so we can surface the real status
      // and body for a 4xx/5xx, and only fall back to the vague network
      // message when the request truly didn't complete.
      //
      // Diagnostic — if the SDK on the server is still injecting CRC32
      // checksum query params, log it loudly. This is the #1 cause of
      // "request never made it" because S3 returns a CORS-less 400 that
      // the browser shows as a network error. Means the server has stale
      // code (nodemon didn't restart, etc.).
      const urlParams = new URL(presign.uploadUrl).searchParams
      if (urlParams.has('x-amz-checksum-crc32') || urlParams.has('x-amz-sdk-checksum-algorithm')) {
        console.warn('[upload] Presigned URL still contains checksum params — restart the server to pick up the AWS SDK config fix.')
      }
      setProgress(50) // No streaming progress with fetch; show "in flight" instead.
      let res
      try {
        res = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: blob,
        })
      } catch (netErr) {
        const origin = typeof window !== 'undefined' ? window.location.origin : 'unknown'
        throw new Error(
          `Upload couldn't reach S3 (from ${origin}). ` +
          'Likely a CORS block — your origin isn\'t in the bucket\'s allow-list — or your network blocks *.amazonaws.com. ' +
          'If you just changed the AWS SDK config server-side, restart the server.'
        )
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240)
        const err = new Error(`S3 upload rejected (HTTP ${res.status})${text ? ' — ' + text : ''}`)
        err.status = res.status
        throw err
      }

      // Step 3: save-to-history is only meaningful for signed-in users,
      // who own the persistent object key. Anon flows skip this — the
      // returned publicUrl is enough to use the image for the session.
      let pfp = null
      if (saveToHistory) {
        try {
          const resp = await api.savePfp({
            key: presign.key,
            publicUrl: presign.publicUrl,
            contentType,
            byteSize: size,
          })
          pfp = resp?.pfp || null
        } catch (err) {
          // If history-save fails the upload itself still succeeded —
          // surface the URL so the caller can use it, but report the
          // history error so the UI can prompt a retry.
          setError(err.detail || err.message || 'Failed to save to history')
        }
      }

      setProgress(100)
      return { publicUrl: presign.publicUrl, key: presign.key, pfp }
    } catch (err) {
      setError(err.detail || err.message || 'Upload failed')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  // Server-side fetch of a remote image URL. The browser PUT-presign path
  // doesn't work for arbitrary URLs (we'd have to download the image
  // client-side first, which most browsers block as a cross-origin read).
  // Instead the server fetches, validates, and re-uploads to S3 — and
  // returns the saved-history pfp record directly.
  const uploadFromUrl = useCallback(async (url) => {
    setError(null)
    setBusy(true)
    setProgress(0)
    try {
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error('Enter a URL.')
      }
      setProgress(50)
      const resp = await api.uploadFromUrl(url)
      setProgress(100)
      return resp
    } catch (err) {
      setError(err.detail || err.message || 'URL upload failed')
      throw err
    } finally {
      setBusy(false)
    }
  }, [])

  // Memoized so consumers can safely include it in useEffect dep arrays
  // without triggering a render cascade — a fresh inline closure would
  // be a new identity every render and re-fire dependent effects.
  const reset = useCallback(() => {
    setError(null)
    setProgress(0)
  }, [])

  return { upload, uploadFromUrl, busy, progress, error, reset }
}
