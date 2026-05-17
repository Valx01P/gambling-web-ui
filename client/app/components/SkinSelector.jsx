'use client'

import { memo, useEffect, useState } from 'react'
import { SKIN_PRESETS, isUnlocked, resolveSkinCss } from '../lib/skinPresets'
import { api } from '../lib/api'

// Skin picker panel. Lifetime daily count gates which presets are
// unlockable; slot 10 ("Custom") is the gradient editor — exposes 2-3
// color slots + a direction picker so the player can build their own.
//
// Selection is server-authoritative: client POSTs to /api/dailies/me/skin,
// server validates the unlock tier + payload shape, response updates the
// optimistic UI. A spectator with no signed-in account can preview but
// can't save.

const DIRECTIONS = [
  { value: 'to right',  label: '→' },
  { value: 'to bottom', label: '↓' },
  { value: '135deg',    label: '↘' },
  { value: '45deg',     label: '↗' },
  { value: 'to left',   label: '←' },
  { value: 'to top',    label: '↑' },
]

// Original app defaults for the custom slot. Used by the Revert button
// — clicking it twice restores the user's custom gradient editor back
// to these values + persists that to the server. Kept separate from
// the useState initial so the revert is a fixed target, not "whatever
// was loaded when the picker first mounted."
const CUSTOM_DEFAULT_COLORS = ['#7c3aed', '#22d3ee']
const CUSTOM_DEFAULT_DIRECTION = 'to right'

const SkinSelector = memo(function SkinSelector({
  currentSkinId = 0,
  currentCustomSkin = null,
  dailiesCompleted = 0,
  signedIn = false,
  onApplied,    // (skinId, customSkin) => void  — called after server save
}) {
  const [pendingId, setPendingId] = useState(currentSkinId)
  const [customColors, setCustomColors] = useState(
    Array.isArray(currentCustomSkin?.colors) && currentCustomSkin.colors.length
      ? currentCustomSkin.colors
      : [...CUSTOM_DEFAULT_COLORS]
  )
  const [customDirection, setCustomDirection] = useState(currentCustomSkin?.direction || CUSTOM_DEFAULT_DIRECTION)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Two-click revert: first click sets `confirmRevert` for ~2s; if a
  // second click lands in that window we actually reset + persist.
  // Single click outside the window is a no-op (cancels the arming).
  const [confirmRevert, setConfirmRevert] = useState(false)
  useEffect(() => {
    if (!confirmRevert) return
    const t = setTimeout(() => setConfirmRevert(false), 2200)
    return () => clearTimeout(t)
  }, [confirmRevert])

  useEffect(() => { setPendingId(currentSkinId) }, [currentSkinId])

  function handleRevertClick() {
    if (!confirmRevert) {
      setConfirmRevert(true)
      return
    }
    // Confirmed — reset the editor + persist defaults to the server.
    setConfirmRevert(false)
    setCustomColors([...CUSTOM_DEFAULT_COLORS])
    setCustomDirection(CUSTOM_DEFAULT_DIRECTION)
    if (signedIn && pendingId === 10) {
      applySkin(10, {
        colors: [...CUSTOM_DEFAULT_COLORS],
        direction: CUSTOM_DEFAULT_DIRECTION,
      })
    }
  }

  async function applySkin(skinId, custom) {
    if (!signedIn) {
      setError('Sign in to save your skin choice.')
      return
    }
    if (!isUnlocked(skinId, dailiesCompleted)) {
      setError(`Locked. Complete more dailies first.`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = skinId === 10
        ? { skinId, colors: custom?.colors || customColors, direction: custom?.direction || customDirection }
        : { skinId }
      const json = await api.setSkin(body)
      onApplied?.(json.skinId, json.customSkin || null)
    } catch (err) {
      // apiFetch surfaces server errors as { detail, message } objects.
      setError(err?.detail || err?.message || 'Could not save skin.')
    } finally {
      setSaving(false)
    }
  }

  // Pre-built preview for the custom slot — uses the current draft colors,
  // not whatever's saved on the server, so the preview updates live as the
  // user fiddles with the pickers.
  const customCss = `linear-gradient(${customDirection}, ${customColors.join(', ')})`

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Player skin</div>
        <div className="mt-0.5 text-[11px] text-zinc-400">
          Every skin is free — pick whichever you like. Dailies stay for achievements.
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {SKIN_PRESETS.map(preset => {
          const unlocked = isUnlocked(preset.id, dailiesCompleted)
          const active = pendingId === preset.id
          const css = preset.id === 10 ? customCss : preset.css
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                if (!unlocked) return
                setPendingId(preset.id)
                if (preset.id !== 10) applySkin(preset.id)
              }}
              disabled={!unlocked || saving}
              title={unlocked ? preset.label : `Unlocks at ${preset.unlocksAt} dailies`}
              className={`relative h-14 rounded-md border text-[10px] font-bold transition-all overflow-hidden active:scale-95 ${
                active ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-zinc-700/60'
              } ${!unlocked ? 'opacity-40 cursor-not-allowed' : ''}`}
              style={{ background: css }}
            >
              <span className="absolute inset-x-0 bottom-0 bg-zinc-950/70 py-0.5 text-white">
                {unlocked ? preset.label : `Lv ${preset.unlocksAt}`}
              </span>
            </button>
          )
        })}
      </div>

      {pendingId === 10 && isUnlocked(10, dailiesCompleted) && (
        <div className="rounded-md border border-zinc-700/60 bg-zinc-900/50 p-2.5 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Custom gradient</div>
          <div className="flex items-center gap-2">
            {[0, 1, 2].map(i => (
              <input
                key={i}
                type="color"
                value={customColors[i] || '#000000'}
                onChange={(e) => {
                  const next = [...customColors]
                  next[i] = e.target.value
                  setCustomColors(next.filter(Boolean))
                }}
                className="h-8 w-10 cursor-pointer rounded border border-zinc-600 bg-transparent"
              />
            ))}
            <button
              type="button"
              onClick={() => setCustomColors(customColors.slice(0, Math.max(2, customColors.length - 1)))}
              className="ml-auto rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              disabled={customColors.length <= 2}
            >
              −
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {DIRECTIONS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => setCustomDirection(d.value)}
                className={`h-7 w-7 rounded border text-sm transition-colors ${
                  customDirection === d.value
                    ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                    : 'border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700'
                }`}
                aria-label={d.value}
              >
                {d.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => applySkin(10, { colors: customColors, direction: customDirection })}
              disabled={saving}
              className="ml-auto rounded-md bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
          {/* Revert — two-click confirm so a misclick doesn't wipe a
              gradient the user spent time tuning. First click arms;
              the button morphs into "Click again to revert" for ~2s.
              Second click within the window resets editor state AND
              persists defaults to the server (so the live nameplate
              swaps back too). */}
          <button
            type="button"
            onClick={handleRevertClick}
            disabled={saving}
            className={`w-full rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
              confirmRevert
                ? 'border-red-400/70 bg-red-500/20 text-red-100 hover:bg-red-500/30'
                : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
            }`}
          >
            {confirmRevert ? 'Click again to revert' : 'Revert to default gradient'}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          {error}
        </div>
      )}
    </div>
  )
})

export default SkinSelector
