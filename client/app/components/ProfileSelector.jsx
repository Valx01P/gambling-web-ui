'use client'

import { useEffect, useRef, useState } from 'react'
import { useUpload } from '../lib/useUpload'
import { useAuth } from '../lib/useAuth'
import { colorForKey, getInitials } from '../lib/initials'
import AvatarCropper from './AvatarCropper'

export const PROFILE_AVATARS = [
  { id: 'op1', label: 'Option 1', url: 'https://i.ibb.co/Wpf6XVp0/image.png' },
  { id: 'op2', label: 'Option 2', url: 'https://i.ibb.co/XdFhJ7w/image.png' },
  { id: 'op3', label: 'Option 3', url: 'https://i.ibb.co/TD0NJ5TR/image.png' },
  { id: 'op4', label: 'Option 4', url: 'https://i.ibb.co/0jwk0qwP/image.png' },
  { id: 'op5', label: 'Option 5', url: 'https://i.ibb.co/qYM6dhcB/image.png' },
  { id: 'op6', label: 'Option 6', url: 'https://i.ibb.co/4g55Ppjs/image.png' },
  { id: 'op7', label: 'Option 7', url: 'https://i.ibb.co/WWQbgGzW/image.png' },
  { id: 'op8', label: 'Option 8', url: 'https://i.ibb.co/GfRfzcBM/image.png' },
  { id: 'op9', label: 'Option 9', url: 'https://i.ibb.co/mFr14sFv/image.png' },
  { id: 'op10', label: 'Option 10', url: 'https://i.ibb.co/8nm24QfJ/image.png' },
]

const DEFAULT_AVATAR = PROFILE_AVATARS[0]

export function getProfileAvatar(idOrUrl) {
  return PROFILE_AVATARS.find((avatar) => avatar.id === idOrUrl || avatar.url === idOrUrl) || DEFAULT_AVATAR
}

// Render order:
//   1. avatarUrl (custom upload)              → <img>
//   2. avatarId matching a preset             → <img>
//   3. neither, but `name` (or `nameKey`) set → initials circle (always renders)
//   4. nothing at all                         → '?' over a neutral zinc circle
//
// Previously this collapsed to a remote i.ibb.co preset whenever both avatar
// fields were missing — when that host blocked/blipped the user got a
// broken-image artifact. Initials fallback guarantees something always paints.
//
// `size` is the explicit pixel side-length (used to compute font-size for
// the initials variant). `className` is for ring/margin/etc — caller can
// still pass `h-x w-x` if they prefer Tailwind sizing; in that case skip
// `size` and the initials default to a readable mid-size (14px).
export function ProfileAvatar({ avatarId, avatarUrl, name, nameKey, size, className = '' }) {
  const presetMatch = !avatarUrl && avatarId
    ? PROFILE_AVATARS.find((avatar) => avatar.id === avatarId || avatar.url === avatarId)
    : null
  const url = avatarUrl || presetMatch?.url || null

  // Track failed image loads so we can fall back to initials without ever
  // showing the browser's broken-image artifact. Reset whenever the URL
  // changes so a fixed/replaced avatar gets another shot.
  const [imgFailed, setImgFailed] = useState(false)
  useEffect(() => { setImgFailed(false) }, [url])

  const sizeStyle = typeof size === 'number'
    ? { width: size, height: size }
    : undefined

  if (url && !imgFailed) {
    return (
      <span
        className={`inline-flex shrink-0 overflow-hidden rounded-full bg-zinc-900 ring-1 ring-white/15 ${className}`}
        style={sizeStyle}
      >
        <img
          src={url}
          alt=""
          width={typeof size === 'number' ? size : 108}
          height={typeof size === 'number' ? size : 108}
          className="h-full w-full object-cover object-center"
          draggable="false"
          loading="lazy"
          decoding="async"
          onError={() => setImgFailed(true)}
        />
      </span>
    )
  }

  const initials = getInitials(name || '')
  const bg = colorForKey(nameKey || name || 'anon')
  const fontSize = typeof size === 'number' ? Math.max(10, Math.floor(size * 0.4)) : 14
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-white ring-1 ring-white/15 ${className}`}
      style={{ ...sizeStyle, background: bg, fontSize }}
      aria-label={name || 'Profile'}
    >
      {initials}
    </span>
  )
}

function wrappedDistance(index, selectedIndex) {
  const total = PROFILE_AVATARS.length
  let distance = index - selectedIndex
  if (distance > total / 2) distance -= total
  if (distance < -total / 2) distance += total
  return distance
}

// `value` may be either a preset avatar id ('op1'…) or a custom URL
// (any string starting with http(s)://). The selector renders the carousel
// for presets and a single hero slot for custom uploads.
//
// Signed-in users get save-to-history on upload; anonymous users get a
// session-only upload that lives under tmp/ and is reaped after a day.
//
// Two upload modes, selected by whether the parent supplies `onPendingFile`:
//
//   * IMMEDIATE (default) — crop → PUT to S3 → emit publicUrl via onChange.
//     Used wherever the user has an explicit "save" action that's the
//     intent of the upload (bot avatar set on Save, etc.).
//
//   * DEFERRED — crop → emit Blob + a local `blob:` URL via onPendingFile.
//     The parent stashes the blob and only commits the S3 PUT later, e.g.
//     when the user actually joins a table. Skips the round-trip cost
//     entirely if the user iterates on the avatar without committing.
//
// In deferred mode the cropper closes instantly (no upload spinner) and
// the parent owns the upload lifecycle.
export default function ProfileSelector({ value = DEFAULT_AVATAR.id, onChange, onPendingFile, recentPfps = [] }) {
  // Treat both http(s) URLs and `blob:` (deferred-upload preview) URLs as
  // "custom" — anything not a preset id renders in the hero slot instead
  // of the carousel.
  const isCustom = typeof value === 'string' && (/^https?:\/\//.test(value) || value.startsWith('blob:'))
  const selectedIndex = isCustom
    ? -1
    : Math.max(0, PROFILE_AVATARS.findIndex((avatar) => avatar.id === value))
  const selected = isCustom
    ? { url: value, label: 'Custom upload' }
    : (PROFILE_AVATARS[selectedIndex] || DEFAULT_AVATAR)

  const { user } = useAuth()
  const { upload, busy: uploading, error: uploadError } = useUpload()
  const fileInputRef = useRef(null)
  const [cropFile, setCropFile] = useState(null)
  const [localError, setLocalError] = useState(null)

  function selectOffset(offset) {
    const total = PROFILE_AVATARS.length
    // If we're currently on a custom upload, the carousel "next" jumps
    // back to preset 0 — anything else feels surprising.
    const baseIndex = isCustom ? 0 : selectedIndex
    const nextIndex = (baseIndex + offset + total) % total
    onChange?.(PROFILE_AVATARS[nextIndex].id)
  }

  function pickFile() {
    fileInputRef.current?.click()
  }

  function onFileChosen(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setLocalError(null)
    if (f.size > 5 * 1024 * 1024) {
      setLocalError('Image too large — max 5MB.')
      return
    }
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) {
      setLocalError('Unsupported file type. Use PNG, JPEG, WebP, or GIF.')
      return
    }
    setCropFile(f)
  }

  async function onCropConfirm(blob) {
    // Deferred mode: hand the blob to the parent and let them upload at
    // commit time. Cropper closes instantly — the user can iterate (pick
    // another image, swap to a preset, etc.) without burning S3 PUTs.
    if (onPendingFile) {
      const localUrl = URL.createObjectURL(blob)
      onPendingFile(blob, localUrl)
      onChange?.(localUrl)
      setCropFile(null)
      return
    }
    // Immediate mode: original behavior — upload now, emit public URL.
    try {
      const { publicUrl } = await upload(blob, { saveToHistory: !!user })
      setCropFile(null)
      onChange?.(publicUrl)
    } catch {
      /* useUpload surfaces the error; cropper stays open for retry */
    }
  }

  return (
    <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/80 px-4 py-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-black text-white">Profile</div>
          <div className="text-xs font-bold text-zinc-500">{selected.label}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={pickFile}
            disabled={uploading}
            className="rounded-md border border-amber-400/60 bg-amber-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : '+ Upload'}
          </button>
          <div className="hidden sm:block text-[10px] font-black uppercase tracking-widest text-zinc-500">Character</div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={onFileChosen}
      />
      {(localError || uploadError) && (
        <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-200">
          {localError || uploadError}
        </div>
      )}

      {/* One-tap re-pick from the signed-in user's recent uploads. Each
          row is already on the CDN (no upload needed) so click → select
          is instant. Capped to 5 server-side, so we render up to that
          many. Hidden entirely when empty so it doesn't clutter the
          first-time-user view. */}
      {recentPfps.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Recent uploads</div>
            <div className="text-[10px] font-bold text-zinc-500">Tap to re-use · keeps last 5</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentPfps.slice(0, 5).map(pfp => {
              const isSelected = pfp.publicUrl === value
              return (
                <button
                  key={pfp.id}
                  type="button"
                  onClick={() => onChange?.(pfp.publicUrl)}
                  aria-label={isSelected ? 'Currently using this avatar' : 'Use this avatar'}
                  className={`h-10 w-10 overflow-hidden rounded-full ring-2 transition-all ${
                    isSelected ? 'ring-amber-300 scale-105' : 'ring-zinc-700 hover:ring-zinc-500'
                  }`}
                >
                  <img
                    src={pfp.publicUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="h-full w-full object-cover object-center"
                    loading="lazy"
                    decoding="async"
                    draggable="false"
                  />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {isCustom ? (
        // Custom hero — bigger, centered, with an X to revert to presets.
        <div className="relative mx-auto flex h-36 max-w-[500px] items-center justify-center">
          <span className="block h-28 w-28 overflow-hidden rounded-full bg-zinc-950 shadow-2xl ring-2 ring-amber-300">
            <img
              src={value}
              alt=""
              width={112}
              height={112}
              className="h-full w-full object-cover object-center"
              draggable="false"
            />
          </span>
          <button
            type="button"
            onClick={() => onChange?.(DEFAULT_AVATAR.id)}
            aria-label="Use a preset character instead"
            className="absolute -right-1 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-500/70 bg-zinc-900/90 text-xs font-black text-white shadow-md hover:bg-zinc-700 sm:right-4"
          >
            ✕
          </button>
        </div>
      ) : (
      <div className="relative mx-auto h-36 max-w-[500px] overflow-hidden px-14 sm:px-16">
        <div className="absolute inset-x-14 top-1/2 h-px -translate-y-1/2 sm:inset-x-16" aria-hidden="true" />
        <button
          type="button"
          onClick={() => selectOffset(-1)}
          className="absolute left-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:left-4"
          aria-label="Previous profile"
        >
          &lt;
        </button>
        <button
          type="button"
          onClick={() => selectOffset(1)}
          className="absolute right-2 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-zinc-600/70 bg-zinc-900/90 text-sm font-black text-white shadow-lg transition-colors hover:bg-zinc-700 sm:right-4"
          aria-label="Next profile"
        >
          &gt;
        </button>

        <div className="absolute inset-x-14 top-1/2 h-28 -translate-y-1/2 overflow-hidden sm:inset-x-16">
        {PROFILE_AVATARS.map((avatar, index) => {
          const distance = wrappedDistance(index, selectedIndex)
          if (Math.abs(distance) > 2) return null

          const isSelected = distance === 0
          const depth = Math.abs(distance)
          const translateX = distance * 86
          const size = isSelected ? 108 : depth === 1 ? 82 : 62
          const opacity = isSelected ? 1 : depth === 1 ? 0.62 : 0.28

          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onChange?.(avatar.id)}
              className={`absolute left-1/2 top-1/2 flex items-center justify-center rounded-full transition-all duration-300 ${
                isSelected ? 'z-10' : 'z-0'
              }`}
              style={{
                width: `${size}px`,
                height: `${size}px`,
                transform: `translate(calc(-50% + ${translateX}px), -50%)`,
                opacity,
                filter: isSelected ? 'none' : 'brightness(0.65)',
              }}
              aria-label={`Choose ${avatar.label}`}
            >
              <span className={`h-full w-full overflow-hidden rounded-full bg-zinc-950 shadow-2xl ring-2 ${isSelected ? 'ring-amber-300' : 'ring-zinc-700'}`}>
                <img
                  src={avatar.url}
                  alt=""
                  width={108}
                  height={108}
                  className="h-full w-full object-cover object-center"
                  draggable="false"
                  loading="lazy"
                  decoding="async"
                />
              </span>
            </button>
          )
        })}
        </div>
      </div>
      )}

      <AvatarCropper
        open={!!cropFile}
        file={cropFile}
        busy={uploading}
        onCancel={() => setCropFile(null)}
        onConfirm={onCropConfirm}
      />
    </div>
  )
}
