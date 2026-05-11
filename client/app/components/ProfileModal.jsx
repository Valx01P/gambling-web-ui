'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { useUpload } from '../lib/useUpload'
import { ProfileAvatar } from './ProfileSelector'
import AvatarCropper from './AvatarCropper'

// Profile management for signed-in users. Shows the Google-supplied
// display_name + email, lets the user edit their game-facing username,
// upload + crop a new profile picture (saved to S3 + the user_pfps
// history), and pick from any past upload as the active avatar.
//
// Anonymous users get a stripped-down version through the lobby's
// ProfileSelector directly — they don't have a history and can't edit a
// persisted profile. This modal isn't shown to them.
export default function ProfileModal({ open, onClose, onProfileChange }) {
  const { user, refreshUser } = useAuth()
  const { upload, busy: uploading, error: uploadError, reset: resetUpload } = useUpload()

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [pfps, setPfps] = useState([])
  const [pfpsLoading, setPfpsLoading] = useState(false)
  const [pfpsError, setPfpsError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [cropFile, setCropFile] = useState(null)
  const fileInputRef = useRef(null)

  // Hydrate local state from the authed user whenever the modal opens.
  useEffect(() => {
    if (!open || !user) return
    setUsername(user.displayName || '')
    setAvatarUrl(user.avatarUrl || null)
    setSaveOk(false)
    setSaveError(null)
    resetUpload()
  }, [open, user, resetUpload])

  // Body scroll-lock + ESC, same recipe as the other modals.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e) { if (e.key === 'Escape' && !saving && !uploading) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [open, saving, uploading, onClose])

  // Lazy-load history when the modal opens. Refresh after every upload so
  // the newly-saved image shows up immediately.
  const refreshPfps = useCallback(async () => {
    setPfpsLoading(true)
    setPfpsError(null)
    try {
      const { pfps } = await api.listPfps()
      setPfps(pfps || [])
    } catch (err) {
      setPfpsError(err.detail || err.message || 'Failed to load history')
    } finally {
      setPfpsLoading(false)
    }
  }, [])

  useEffect(() => { if (open && user) refreshPfps() }, [open, user, refreshPfps])

  if (!open || !user) return null
  if (typeof document === 'undefined') return null

  function pickFile() {
    fileInputRef.current?.click()
  }

  function onFileChosen(e) {
    const f = e.target.files?.[0]
    e.target.value = '' // Clear so picking the same file again re-fires.
    if (!f) return
    if (f.size > 5 * 1024 * 1024) {
      setSaveError('Image too large — max 5MB.')
      return
    }
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) {
      setSaveError('Unsupported file type. Use PNG, JPEG, WebP, or GIF.')
      return
    }
    setCropFile(f)
  }

  async function handleCropConfirm(blob) {
    setSaveError(null)
    try {
      const { publicUrl, pfp } = await upload(blob, { saveToHistory: true })
      setAvatarUrl(publicUrl)
      setCropFile(null)
      if (pfp) setPfps(prev => [pfp, ...prev])
    } catch {
      // useUpload already surfaces the error; keep the cropper open so
      // the user can retry without re-picking the file.
    }
  }

  async function deletePfp(id) {
    const target = pfps.find(p => p.id === id)
    if (!target) return
    if (!confirm('Delete this image from your history? This cannot be undone.')) return
    try {
      await api.deletePfp(id)
      setPfps(prev => prev.filter(p => p.id !== id))
      // If the deleted PFP was the active avatar, fall back to no custom
      // avatar (a future render will show the preset placeholder).
      if (avatarUrl === target.publicUrl) setAvatarUrl(null)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to delete')
    }
  }

  function pickFromHistory(pfp) {
    setAvatarUrl(pfp.publicUrl)
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const patch = {}
      const trimmed = username.trim()
      if (trimmed && trimmed !== user.displayName) patch.displayName = trimmed
      if (avatarUrl !== user.avatarUrl) patch.avatarUrl = avatarUrl
      if (Object.keys(patch).length === 0) {
        setSaveOk(true)
        setTimeout(() => setSaveOk(false), 1500)
        return
      }
      await api.updateMe(patch)
      await refreshUser?.()
      onProfileChange?.({ displayName: trimmed || user.displayName, avatarUrl })
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 1500)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const dirty = (username.trim() && username.trim() !== user.displayName) || (avatarUrl !== user.avatarUrl)

  // Portal to body — same reasoning as AvatarCropper. Without this the
  // modal renders inside AccountMenu (which is inside LobbyView's z-10
  // chrome) and z-[300] would be trapped under z-10's stacking ceiling,
  // ending up *below* sibling modals at the root.
  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        className="fixed inset-0 z-[300] flex items-center justify-center bg-black/65 p-4"
        onClick={() => !saving && !uploading && onClose?.()}
      >
        <div
          className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-zinc-600/60 bg-zinc-900/98 shadow-2xl"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div id="profile-title" className="text-sm font-black text-white">Your profile</div>
              <button
                type="button"
                onClick={() => onClose?.()}
                disabled={saving || uploading}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            {/* Identity row — read-only Google account info */}
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
              <ProfileAvatar
                avatarUrl={avatarUrl}
                avatarId={null}
                name={user.displayName}
                nameKey={user.id || user.email}
                size={56}
                className="ring-2 ring-emerald-400/40"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-white">{user.displayName}</div>
                <div className="truncate text-[11px] font-bold text-zinc-400">{user.email}</div>
              </div>
            </div>

            {/* Editable game username — what other players see at the table */}
            <label className="block">
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-zinc-300">Username</div>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                maxLength={32}
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                placeholder="What other players see at the table"
                className="w-full rounded-md border border-zinc-600/60 bg-zinc-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-zinc-300"
              />
              <div className="mt-1 text-[10px] font-bold text-zinc-500">
                Shown above your seat. Initials in chat. Visible to everyone at the table.
              </div>
            </label>

            {/* PFP picker + history */}
            <div className="mt-4 rounded-lg border border-zinc-700/70 bg-zinc-950/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Profile picture</div>
                  <div className="text-[11px] font-bold text-zinc-500">Upload a new one or pick from saved.</div>
                </div>
                <button
                  type="button"
                  onClick={pickFile}
                  disabled={uploading}
                  className="rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  + Upload
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onFileChosen}
              />

              {pfpsLoading && <div className="text-xs font-bold text-zinc-500">Loading…</div>}
              {pfpsError && <div className="text-xs font-bold text-red-300">{pfpsError}</div>}

              {pfps.length === 0 && !pfpsLoading && (
                <div className="rounded-md border border-zinc-700/70 bg-zinc-900/40 px-3 py-4 text-center text-[11px] font-bold text-zinc-500">
                  No uploads yet — your first will be saved here forever.
                </div>
              )}

              {pfps.length > 0 && (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {pfps.map(pfp => {
                    const isSelected = pfp.publicUrl === avatarUrl
                    return (
                      <div key={pfp.id} className="relative">
                        <button
                          type="button"
                          onClick={() => pickFromHistory(pfp)}
                          className={`block w-full overflow-hidden rounded-md ring-2 transition-all ${
                            isSelected ? 'ring-amber-300' : 'ring-zinc-700 hover:ring-zinc-500'
                          }`}
                          aria-label={isSelected ? 'Current avatar' : 'Use this avatar'}
                        >
                          <img
                            src={pfp.publicUrl}
                            alt=""
                            className="block aspect-square w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePfp(pfp.id)}
                          aria-label="Delete this image"
                          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-red-400/60 bg-red-500/90 text-[10px] font-black text-white shadow-md hover:bg-red-400"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {uploadError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
                {uploadError}
              </div>
            )}
            {saveError && (
              <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
                {saveError}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onClose?.()}
                disabled={saving || uploading}
                className="rounded-md border border-zinc-500/50 bg-zinc-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                Done
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || uploading || !dirty}
                className={`min-w-[7rem] rounded-md px-3 py-1.5 text-xs font-black text-center transition-all ${
                  dirty
                    ? 'border border-emerald-400/60 bg-emerald-500 text-white hover:bg-emerald-400'
                    : 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-100 cursor-not-allowed'
                }`}
              >
                {saving ? 'Saving…' : saveOk ? 'Saved ✓' : dirty ? 'Save changes' : 'No changes'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <AvatarCropper
        open={!!cropFile}
        file={cropFile}
        busy={uploading}
        onCancel={() => setCropFile(null)}
        onConfirm={handleCropConfirm}
      />
    </>,
    document.body
  )
}
