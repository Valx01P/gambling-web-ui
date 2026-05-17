'use client'

import { memo, useEffect, useState } from 'react'
import { SKIN_PRESETS, isUnlocked, resolveSkinCss } from '../lib/skinPresets'
import { api } from '../lib/api'

// Skin picker panel. Two custom slots — id 10 is a gradient editor
// (2-3 colors + direction), id 11 is a solid color. Each custom slot's
// draft is persisted to localStorage so switching between them (or
// flipping back to a preset and returning) restores your last colors.
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

// Original app defaults for the two custom slots. Used by the Revert
// button — clicking it twice restores the editor (and the active
// custom on the server) back to these values. Kept separate from
// useState initial so revert is a fixed target.
const GRADIENT_DEFAULT_COLORS = ['#7c3aed', '#22d3ee']
const GRADIENT_DEFAULT_DIRECTION = 'to right'
const SOLID_DEFAULT_COLOR = '#0ea5e9'

// localStorage keys. Each custom slot persists its OWN last config so
// switching skinId 10 ↔ 11 doesn't lose either editor's state.
const LS_GRADIENT_KEY = 'gwu:skin:gradient'
const LS_SOLID_KEY = 'gwu:skin:solid'

function loadJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : fallback
  } catch { return fallback }
}
function saveJson(key, value) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

const SkinSelector = memo(function SkinSelector({
  currentSkinId = 0,
  currentCustomSkin = null,
  dailiesCompleted = 0,
  signedIn = false,
  onApplied,    // (skinId, customSkin) => void  — called after server save
}) {
  const [pendingId, setPendingId] = useState(currentSkinId)

  // Hydrate each custom editor's draft state from localStorage first,
  // then fall back to whatever the server has saved (currentCustomSkin
  // — which only carries ONE shape at a time, matching the active
  // skinId). This way fresh sessions see the server's last applied
  // colors, but switching slots in-session restores each editor's
  // last-touched draft from localStorage.
  const [gradientColors, setGradientColors] = useState(() => {
    const ls = loadJson(LS_GRADIENT_KEY, null)
    if (ls && Array.isArray(ls.colors) && ls.colors.length >= 2) return ls.colors
    if (currentSkinId === 10 && Array.isArray(currentCustomSkin?.colors) && currentCustomSkin.colors.length) {
      return currentCustomSkin.colors
    }
    return [...GRADIENT_DEFAULT_COLORS]
  })
  const [gradientDirection, setGradientDirection] = useState(() => {
    const ls = loadJson(LS_GRADIENT_KEY, null)
    if (ls && typeof ls.direction === 'string') return ls.direction
    if (currentSkinId === 10 && typeof currentCustomSkin?.direction === 'string') {
      return currentCustomSkin.direction
    }
    return GRADIENT_DEFAULT_DIRECTION
  })
  const [solidColor, setSolidColor] = useState(() => {
    const ls = loadJson(LS_SOLID_KEY, null)
    if (ls && typeof ls.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(ls.color)) return ls.color
    if (currentSkinId === 11 && typeof currentCustomSkin?.color === 'string') {
      return currentCustomSkin.color
    }
    return SOLID_DEFAULT_COLOR
  })

  // Persist drafts on every change. Save the slot's payload exactly as
  // the server expects it — that way "restore from localStorage" can
  // just shove the parsed JSON back into state.
  useEffect(() => {
    saveJson(LS_GRADIENT_KEY, { colors: gradientColors, direction: gradientDirection })
  }, [gradientColors, gradientDirection])
  useEffect(() => {
    saveJson(LS_SOLID_KEY, { color: solidColor })
  }, [solidColor])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  // Two-click revert: first click sets `confirmRevert` for ~2s; if a
  // second click lands in that window we actually reset + persist.
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
    setConfirmRevert(false)
    if (pendingId === 10) {
      setGradientColors([...GRADIENT_DEFAULT_COLORS])
      setGradientDirection(GRADIENT_DEFAULT_DIRECTION)
      if (signedIn) {
        applySkin(10, { colors: [...GRADIENT_DEFAULT_COLORS], direction: GRADIENT_DEFAULT_DIRECTION })
      }
    } else if (pendingId === 11) {
      setSolidColor(SOLID_DEFAULT_COLOR)
      if (signedIn) {
        applySkin(11, { color: SOLID_DEFAULT_COLOR })
      }
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
      // Build the per-slot payload shape the server's /api/me/skin
      // route expects: gradient = colors+direction, solid = color.
      let body
      if (skinId === 10) {
        body = {
          skinId,
          colors: custom?.colors || gradientColors,
          direction: custom?.direction || gradientDirection,
        }
      } else if (skinId === 11) {
        body = { skinId, color: custom?.color || solidColor }
      } else {
        body = { skinId }
      }
      const json = await api.setSkin(body)
      onApplied?.(json.skinId, json.customSkin || null)
    } catch (err) {
      setError(err?.detail || err?.message || 'Could not save skin.')
    } finally {
      setSaving(false)
    }
  }

  // Pre-built previews for the two custom slots — uses the current
  // draft, not whatever's saved on the server, so the preview updates
  // live as the user fiddles with the pickers.
  const gradientPreviewCss = `linear-gradient(${gradientDirection}, ${gradientColors.join(', ')})`
  const solidPreviewCss = solidColor

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
          const css = preset.id === 10
            ? gradientPreviewCss
            : preset.id === 11
              ? solidPreviewCss
              : preset.css
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                if (!unlocked) return
                setPendingId(preset.id)
                if (preset.id < 10) applySkin(preset.id)
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
                value={gradientColors[i] || '#000000'}
                onChange={(e) => {
                  const next = [...gradientColors]
                  next[i] = e.target.value
                  setGradientColors(next.filter(Boolean))
                }}
                className="h-8 w-10 cursor-pointer rounded border border-zinc-600 bg-transparent"
              />
            ))}
            <button
              type="button"
              onClick={() => setGradientColors(gradientColors.slice(0, Math.max(2, gradientColors.length - 1)))}
              className="ml-auto rounded border border-zinc-600 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
              disabled={gradientColors.length <= 2}
            >
              −
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {DIRECTIONS.map(d => (
              <button
                key={d.value}
                type="button"
                onClick={() => setGradientDirection(d.value)}
                className={`h-7 w-7 rounded border text-sm transition-colors ${
                  gradientDirection === d.value
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
              onClick={() => applySkin(10, { colors: gradientColors, direction: gradientDirection })}
              disabled={saving}
              className="ml-auto rounded-md bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
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

      {pendingId === 11 && isUnlocked(11, dailiesCompleted) && (
        <div className="rounded-md border border-zinc-700/60 bg-zinc-900/50 p-2.5 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">Custom solid color</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={solidColor}
              onChange={(e) => setSolidColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded border border-zinc-600 bg-transparent"
              aria-label="Pick a solid color"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold text-zinc-400">Hex</div>
              <div className="text-sm font-black text-white tabular-nums">{solidColor.toUpperCase()}</div>
            </div>
            <button
              type="button"
              onClick={() => applySkin(11, { color: solidColor })}
              disabled={saving}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-black text-white hover:bg-amber-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Apply'}
            </button>
          </div>
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
            {confirmRevert ? 'Click again to revert' : 'Revert to default color'}
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
