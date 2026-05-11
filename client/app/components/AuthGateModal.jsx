'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../lib/useAuth'

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

let scriptPromise = null
function loadGsi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.google?.accounts?.id) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = reject
    document.head.appendChild(s)
  })
  return scriptPromise
}

// Used as a soft paywall for account-only features (Bot Arena, Bot creation).
// Anonymous users can still see the CTA — clicking it opens this modal so
// they can sign in inline without bouncing to /poker.
export default function AuthGateModal({ open, message, onClose }) {
  const { user, signInWithGoogle } = useAuth()
  const hostRef = useRef(null)
  const [error, setError] = useState(null)
  const initialized = useRef(false)

  // Body scroll lock + ESC-to-close while the modal is open. Without the
  // lock, iOS lets a touch-drag on the backdrop scroll the page behind
  // the modal, which reflows the fixed-position card because 100vh in
  // iOS Safari includes the URL bar's reclaimable area.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    if (user) { onClose?.(); return }
    if (!GOOGLE_CLIENT_ID) { setError('Google client ID not configured'); return }
    let cancelled = false
    loadGsi()
      .then(() => {
        if (cancelled || !hostRef.current) return
        if (!initialized.current) {
          window.google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: async (response) => {
              try {
                await signInWithGoogle(response.credential)
                onClose?.()
              } catch (err) {
                setError(err.message || 'Sign-in failed')
              }
            }
          })
          initialized.current = true
        }
        hostRef.current.innerHTML = ''
        window.google.accounts.id.renderButton(hostRef.current, {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 240
        })
      })
      .catch(err => setError(err.message || 'Failed to load Google sign-in'))
    return () => { cancelled = true }
  }, [open, user, signInWithGoogle, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  // Portal to body so z-[300] isn't trapped by an ancestor's stacking context.
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-gate-title"
    >
      <div
        className="w-full max-w-sm rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-5 shadow-2xl"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <div id="auth-gate-title" className="mb-2 text-sm font-black text-white">Sign in required</div>
        <div className="mb-4 text-xs font-bold text-zinc-300">
          {message || 'Sign in to use this feature.'}
        </div>
        <div className="mb-3 rounded-md border border-zinc-700/70 bg-zinc-950/40 px-3 py-2 text-[11px] font-bold text-zinc-400">
          Accounts let us cap who can spawn bots and arenas, which keeps the lobby spam-free.
          You can still play poker, join private rooms, and use other people's bots without one.
        </div>
        <div className="flex justify-center pt-1">
          <div ref={hostRef} />
        </div>
        {error && <div className="mt-3 text-xs font-bold text-red-300">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-500/50 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-700"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
