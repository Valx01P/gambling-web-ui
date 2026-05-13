'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client'
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID

// 5-minute persistence for an in-progress verify-code flow. If the user
// closes the modal accidentally, reopening it should drop them right
// back into the code-entry screen with the same email pre-filled.
const PENDING_TTL_MS = 5 * 60 * 1000
const PENDING_KEY = 'pokerxyz:auth:pending'

function loadPending() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.expiresAt) return null
    if (Date.now() > parsed.expiresAt) {
      window.localStorage.removeItem(PENDING_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

function savePending(state) {
  if (typeof window === 'undefined') return
  if (!state) {
    window.localStorage.removeItem(PENDING_KEY)
    return
  }
  window.localStorage.setItem(PENDING_KEY, JSON.stringify({
    ...state,
    expiresAt: Date.now() + PENDING_TTL_MS
  }))
}

// Google Identity Services loader — same as before. Hoisted module-level
// so a back-and-forth modal open/close doesn't refetch the script.
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

// 6-digit code input. Six 1-char inputs that auto-advance on type and
// step back on backspace. Pasting a full code fills every box. Renders
// large + monospace so the digits read well even on small screens.
function CodeInput({ value, onChange, disabled }) {
  const refs = useRef([])
  const digits = String(value || '').padEnd(6, ' ').slice(0, 6).split('')

  function setDigit(i, ch) {
    const arr = digits.slice()
    arr[i] = ch
    onChange(arr.join('').replace(/\s+/g, '').slice(0, 6))
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace' && !digits[i].trim() && i > 0) {
      refs.current[i - 1]?.focus()
      return
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus()
  }

  function onPaste(e) {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    onChange(text)
    // Move focus to the last filled cell so the user can keep typing
    // backspace etc. from where the paste left them.
    const target = Math.min(text.length, 5)
    setTimeout(() => refs.current[target]?.focus(), 0)
  }

  return (
    <div className="flex justify-center gap-2" onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          value={d.trim()}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1)
            setDigit(i, v || '')
            if (v && i < 5) refs.current[i + 1]?.focus()
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          className="h-12 w-10 rounded-md border border-zinc-600 bg-zinc-950/60 text-center text-xl font-black font-mono text-white outline-none transition-colors disabled:opacity-50"
          aria-label={`Digit ${i + 1}`}
        />
      ))}
    </div>
  )
}

export default function AuthGateModal({ open, message, onClose }) {
  const {
    user,
    signInWithGoogle, signInWithPassword,
    completeVerifyCode, completePasswordReset
  } = useAuth()

  // Mode state machine. 'verifyCode' / 'resetCode' can be entered on
  // open via the persisted pending state.
  const [mode, setMode] = useState('signin')  // 'signin' | 'signup' | 'verifyCode' | 'forgot' | 'resetCode'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)

  const googleRef = useRef(null)
  const initialized = useRef(false)

  // Restore an in-progress verify/reset flow on every modal open. The
  // 5-minute TTL is enforced inside loadPending.
  useEffect(() => {
    if (!open) return
    setError(null)
    setInfo(null)
    setBusy(false)
    const pending = loadPending()
    if (pending?.mode && pending?.email) {
      setMode(pending.mode)
      setEmail(pending.email)
      setCode('')
      return
    }
    // Fresh open with no pending state — default to signin.
    setMode('signin')
    setCode('')
  }, [open])

  // Body scroll lock + ESC-to-close.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(e) { if (e.key === 'Escape' && !busy) onClose?.() }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, busy, onClose])

  // Auto-close on successful sign-in.
  useEffect(() => { if (open && user) onClose?.() }, [open, user, onClose])

  // Mount the Google Identity button into the signin / signup tabs only.
  // verifyCode / forgot / resetCode have their own primary action and
  // Google sign-in wouldn't make sense there.
  useEffect(() => {
    if (!open) return
    if (mode !== 'signin' && mode !== 'signup') return
    if (!GOOGLE_CLIENT_ID) return
    let cancelled = false
    loadGsi().then(() => {
      if (cancelled || !googleRef.current) return
      if (!initialized.current) {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              setBusy(true); setError(null)
              await signInWithGoogle(response.credential)
              savePending(null)
              onClose?.()
            } catch (err) {
              setError(err.message || 'Google sign-in failed')
            } finally { setBusy(false) }
          }
        })
        initialized.current = true
      }
      googleRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleRef.current, {
        type: 'standard', theme: 'filled_black', size: 'large',
        text: mode === 'signup' ? 'signup_with' : 'continue_with',
        shape: 'rectangular', width: 280
      })
    }).catch(err => setError(err.message || 'Failed to load Google sign-in'))
    return () => { cancelled = true }
  }, [open, mode, signInWithGoogle, onClose])

  // ── Submit handlers ────────────────────────────────────────────────────
  const onSignin = useCallback(async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError(null); setInfo(null)
    try {
      await signInWithPassword({ email, password })
      savePending(null)
      onClose?.()
    } catch (err) {
      if (err.status === 403 && err.message === 'email_unverified') {
        // Server auto-issued a fresh code; jump straight into verify.
        setMode('verifyCode')
        savePending({ mode: 'verifyCode', email })
        setInfo('Check your inbox — we sent a fresh code.')
      } else {
        setError('Wrong email or password.')
      }
    } finally { setBusy(false) }
  }, [email, password, signInWithPassword, onClose])

  const onSignup = useCallback(async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError(null); setInfo(null)
    try {
      const r = await api.authSignup({ email, password, username })
      setMode('verifyCode')
      savePending({ mode: 'verifyCode', email })
      setInfo(r.emailSent ? 'Check your inbox for a 6-digit code.' : "We couldn't send the email — try resending in a moment.")
    } catch (err) {
      const detail = err.detail || err.message || 'Signup failed.'
      setError(detail)
    } finally { setBusy(false) }
  }, [email, password, username])

  const onVerify = useCallback(async (e) => {
    e?.preventDefault?.()
    if (code.length !== 6) return
    setBusy(true); setError(null); setInfo(null)
    try {
      await completeVerifyCode({ email, code })
      savePending(null)
      onClose?.()
    } catch (err) {
      const map = {
        code_expired: 'That code expired — request a new one.',
        code_mismatch: 'That code doesn\'t match.',
        code_locked: 'Too many wrong tries. Request a fresh code.'
      }
      setError(map[err.message] || err.detail || 'Verification failed.')
      setCode('')
    } finally { setBusy(false) }
  }, [email, code, completeVerifyCode, onClose])

  const onResend = useCallback(async (purpose) => {
    setBusy(true); setError(null); setInfo(null)
    try {
      await api.authResendCode({ email, purpose })
      setInfo('New code sent. Check your inbox.')
    } catch (err) {
      setError(err.detail || err.message || 'Couldn\'t resend.')
    } finally { setBusy(false) }
  }, [email])

  const onForgot = useCallback(async (e) => {
    e?.preventDefault?.()
    setBusy(true); setError(null); setInfo(null)
    try {
      await api.authForgot({ email })
      setMode('resetCode')
      savePending({ mode: 'resetCode', email })
      // Generic message so we don't leak whether the account exists.
      setInfo('If that email is registered, a code is on its way.')
    } catch (err) {
      setError(err.detail || err.message || 'Couldn\'t send reset email.')
    } finally { setBusy(false) }
  }, [email])

  const onReset = useCallback(async (e) => {
    e?.preventDefault?.()
    if (code.length !== 6) return
    setBusy(true); setError(null); setInfo(null)
    try {
      await completePasswordReset({ email, code, newPassword })
      savePending(null)
      onClose?.()
    } catch (err) {
      const map = {
        code_expired: 'That code expired — request a new one.',
        code_mismatch: 'That code doesn\'t match.',
        code_locked: 'Too many wrong tries. Request a fresh code.',
        invalid_password: 'Password must be 8–128 characters.'
      }
      setError(map[err.message] || err.detail || 'Reset failed.')
      setCode('')
    } finally { setBusy(false) }
  }, [email, code, newPassword, completePasswordReset, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  // ── Render ─────────────────────────────────────────────────────────────
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      onClick={() => { if (!busy) onClose?.() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-gate-title"
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-600/60 bg-zinc-900/98 p-5 shadow-2xl"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
        onClick={e => e.stopPropagation()}
      >
        <Header mode={mode} message={message} />

        {info && <Notice tone="info">{info}</Notice>}
        {error && <Notice tone="error">{error}</Notice>}

        {mode === 'signin' && (
          <form onSubmit={onSignin} className="flex flex-col gap-3">
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="username" disabled={busy} />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} />
            <button type="submit" disabled={busy || !email || !password} className={primaryBtn}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex items-center justify-between text-[11px] font-bold">
              <button type="button" onClick={() => { setMode('forgot'); setError(null); setInfo(null) }} className="text-amber-300 hover:text-amber-200">Forgot password?</button>
              <button type="button" onClick={() => { setMode('signup'); setError(null); setInfo(null) }} className="text-zinc-300 hover:text-white">Create account →</button>
            </div>
            <Divider />
            <div className="flex justify-center"><div ref={googleRef} /></div>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={onSignup} className="flex flex-col gap-3">
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" disabled={busy} />
            <Field
              label="Username"
              value={username}
              onChange={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24))}
              autoComplete="username"
              disabled={busy}
              hint="3–24 chars · lowercase, digits, _"
            />
            <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} hint="8 characters minimum" />
            <button type="submit" disabled={busy || !email || !username || password.length < 8} className={primaryBtn}>
              {busy ? 'Creating account…' : 'Create account'}
            </button>
            <div className="text-center text-[11px] font-bold">
              <button type="button" onClick={() => { setMode('signin'); setError(null); setInfo(null) }} className="text-zinc-300 hover:text-white">Already have one? Sign in</button>
            </div>
            <Divider />
            <div className="flex justify-center"><div ref={googleRef} /></div>
          </form>
        )}

        {mode === 'verifyCode' && (
          <form onSubmit={onVerify} className="flex flex-col gap-3">
            <div className="text-center text-[12px] font-bold text-zinc-300">
              Code sent to <span className="text-white">{email}</span>
            </div>
            <CodeInput value={code} onChange={setCode} disabled={busy} />
            <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
            <div className="flex items-center justify-between text-[11px] font-bold">
              <button type="button" onClick={() => onResend('signup')} disabled={busy} className="text-amber-300 hover:text-amber-200 disabled:opacity-50">Resend code</button>
              <button type="button" onClick={() => { setMode('signin'); savePending(null); setError(null); setInfo(null) }} className="text-zinc-300 hover:text-white">Use a different email</button>
            </div>
            <div className="rounded-md border border-zinc-700/70 bg-zinc-950/40 px-3 py-2 text-[10px] font-bold text-zinc-400">
              Closing this modal is fine — your code is saved for 5 minutes. Reopen to keep going.
            </div>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={onForgot} className="flex flex-col gap-3">
            <div className="text-[12px] font-bold text-zinc-300">
              Enter the email on your account. We'll send a 6-digit reset code.
            </div>
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" disabled={busy} />
            <button type="submit" disabled={busy || !email} className={primaryBtn}>
              {busy ? 'Sending…' : 'Send reset code'}
            </button>
            <div className="text-center text-[11px] font-bold">
              <button type="button" onClick={() => { setMode('signin'); setError(null); setInfo(null) }} className="text-zinc-300 hover:text-white">← Back to sign in</button>
            </div>
          </form>
        )}

        {mode === 'resetCode' && (
          <form onSubmit={onReset} className="flex flex-col gap-3">
            <div className="text-center text-[12px] font-bold text-zinc-300">
              Code sent to <span className="text-white">{email}</span>
            </div>
            <CodeInput value={code} onChange={setCode} disabled={busy} />
            <Field label="New password" type="password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" disabled={busy} hint="8 characters minimum" />
            <button type="submit" disabled={busy || code.length !== 6 || newPassword.length < 8} className={primaryBtn}>
              {busy ? 'Updating…' : 'Reset password'}
            </button>
            <div className="flex items-center justify-between text-[11px] font-bold">
              <button type="button" onClick={() => onResend('reset')} disabled={busy} className="text-amber-300 hover:text-amber-200 disabled:opacity-50">Resend code</button>
              <button type="button" onClick={() => { setMode('signin'); savePending(null); setError(null); setInfo(null) }} className="text-zinc-300 hover:text-white">Cancel</button>
            </div>
          </form>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => { if (!busy) onClose?.() }}
            disabled={busy}
            className="rounded-md border border-zinc-500/50 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-700 disabled:opacity-50"
          >
            {(mode === 'verifyCode' || mode === 'resetCode') ? 'I\'ll come back' : 'Maybe later'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────
const primaryBtn = 'w-full rounded-md border border-amber-400/70 bg-amber-500 px-3 py-2 text-sm font-black uppercase tracking-widest text-zinc-900 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50'

function Header({ mode, message }) {
  const titles = {
    signin: 'Sign in',
    signup: 'Create your account',
    verifyCode: 'Check your email',
    forgot: 'Reset your password',
    resetCode: 'Enter your reset code'
  }
  return (
    <div className="mb-4">
      <div id="auth-gate-title" className="text-base font-black text-white">{titles[mode] || 'Sign in'}</div>
      {message && mode === 'signin' && (
        <div className="mt-1 text-[11px] font-bold text-zinc-400">{message}</div>
      )}
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', autoComplete, disabled, hint }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-400">{label}</div>
      <input
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm font-bold text-white outline-none transition-colors disabled:opacity-50"
      />
      {hint && <div className="mt-1 text-[10px] font-bold text-zinc-500">{hint}</div>}
    </label>
  )
}

function Divider() {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-zinc-700/70" />
      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-600">or</div>
      <div className="h-px flex-1 bg-zinc-700/70" />
    </div>
  )
}

function Notice({ tone, children }) {
  const cls = tone === 'error'
    ? 'border-red-500/40 bg-red-500/10 text-red-200'
    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
  return (
    <div className={`mb-3 rounded-md border px-3 py-2 text-[11px] font-bold ${cls}`}>
      {children}
    </div>
  )
}
