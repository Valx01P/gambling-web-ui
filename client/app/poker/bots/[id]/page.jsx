'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HomeBackLink from '../../../components/HomeBackLink'
import RouteNavCluster from '../../../components/RouteNavCluster'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout. This page only owns the back link.
import ConfirmPopoverButton from '../../../components/ConfirmPopoverButton'
import BotAvatar from '../../../components/BotAvatar'
import { useAuth } from '../../../lib/useAuth'
import { useUpload } from '../../../lib/useUpload'
import { api } from '../../../lib/api'
import { BOT_COLOR_PRESETS, isValidHex } from '../../../lib/botColors'
import { STARTER_CODE } from '../../../lib/starterBotCode'
import NeuralBrainPanel from './NeuralBrainPanel'
import EloChart from './EloChart'
import HeadToHeadPanel from './HeadToHeadPanel'
import SuperLineupTab from './SuperLineupTab'

// Heavy chunks deferred until the user actually engages with editing.
// JsCodeEditor pulls in the docs reference panel + linter; Simulator pulls
// in the bot-code runner. react-colorful is only used inside the Settings
// tab, so it's loaded the first time the user opens that tab.
const JsCodeEditor = dynamic(() => import('../../../components/JsCodeEditor'), { ssr: false })
const Simulator = dynamic(() => import('../../../components/Simulator'), { ssr: false })
const AvatarCropper = dynamic(() => import('../../../components/AvatarCropper'), { ssr: false })
const HexColorPicker = dynamic(() => import('react-colorful').then(m => m.HexColorPicker), { ssr: false })
const HexColorInput = dynamic(() => import('react-colorful').then(m => m.HexColorInput), { ssr: false })

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-2 text-center">
      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className="text-sm font-black text-white">{value}</div>
    </div>
  )
}

function deepEqual(a, b) {
  if (a === b) return true
  return JSON.stringify(a) === JSON.stringify(b)
}

export default function BotDetailPage({ params }) {
  const { id } = use(params)
  const { user, loading: authLoading } = useAuth()
  const [bot, setBot] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState('#3b82f6')
  const [draftTextColor, setDraftTextColor] = useState('auto')
  const [draftAvatarUrl, setDraftAvatarUrl] = useState(null)
  const [draftCode, setDraftCode] = useState('')

  const [tab, setTab] = useState('code')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveOk, setSaveOk] = useState(false)

  // Avatar upload state — wired to the same useUpload hook + AvatarCropper
  // the user-facing ProfileModal uses. The bot owner is signed-in (else
  // they can't edit), so uploads land in users/{userId}/pfp/ and are
  // saved to their PFP history; the bot just references the public URL.
  const [cropFile, setCropFile] = useState(null)
  const avatarFileInputRef = useRef(null)
  const { upload: uploadAvatar, busy: avatarUploading, error: avatarUploadError } = useUpload()

  const baselineRef = useRef(null)
  const isMine = user && bot && bot.ownerUserId === user.id

  useEffect(() => {
    if (authLoading) return
    let cancelled = false
    setLoading(true)
    api.getBot(id)
      .then(({ bot }) => {
        if (cancelled) return
        const initialCode = bot.code && bot.code.trim() ? bot.code : STARTER_CODE
        setBot(bot)
        setDraftName(bot.name)
        setDraftColor(bot.color)
        setDraftTextColor(bot.textColor || 'auto')
        setDraftAvatarUrl(bot.avatarUrl || null)
        setDraftCode(initialCode)
        baselineRef.current = {
          name: bot.name,
          color: bot.color,
          textColor: bot.textColor || 'auto',
          avatarUrl: bot.avatarUrl || null,
          code: initialCode
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, authLoading])

  // Neural bots have no Code tab — start on Brain. Done as an effect so the
  // initial useState('code') default still works for the common case.
  useEffect(() => {
    if (bot?.isNeural && tab === 'code') setTab('brain')
    if (bot?.isSuper && tab === 'code') setTab('lineup')
  }, [bot?.isNeural, bot?.isSuper, tab])

  const dirty = useMemo(() => {
    if (!baselineRef.current) return false
    return (
      draftName !== baselineRef.current.name ||
      draftColor !== baselineRef.current.color ||
      draftTextColor !== baselineRef.current.textColor ||
      draftAvatarUrl !== baselineRef.current.avatarUrl ||
      draftCode !== baselineRef.current.code
    )
  }, [draftName, draftColor, draftTextColor, draftAvatarUrl, draftCode])

  const reset = useCallback(() => {
    if (!baselineRef.current) return
    setDraftName(baselineRef.current.name)
    setDraftColor(baselineRef.current.color)
    setDraftTextColor(baselineRef.current.textColor || 'auto')
    setDraftAvatarUrl(baselineRef.current.avatarUrl || null)
    setDraftCode(baselineRef.current.code)
    setSaveError(null)
    setSaveOk(false)
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      if (!draftName.trim()) throw new Error('Name required')
      if (!isValidHex(draftColor)) throw new Error('Pick a valid color')
      // Neural bots have no user code — sending `code`/`codeEnabled` would
      // be silently dropped on the server, but we skip them client-side
      // too so the request body is clean.
      const patch = {
        name: draftName.trim(),
        color: draftColor,
        textColor: draftTextColor,
        avatarUrl: draftAvatarUrl
      }
      if (!bot?.isNeural && !bot?.isSuper) {
        patch.code = draftCode
        patch.codeEnabled = true
      }
      const { bot: updated } = await api.updateBot(id, patch)
      const initialCode = updated.code && updated.code.trim() ? updated.code : STARTER_CODE
      setBot(updated)
      baselineRef.current = {
        name: updated.name,
        color: updated.color,
        textColor: updated.textColor || 'auto',
        avatarUrl: updated.avatarUrl || null,
        code: initialCode
      }
      setDraftName(updated.name)
      setDraftColor(updated.color)
      setDraftTextColor(updated.textColor || 'auto')
      setDraftAvatarUrl(updated.avatarUrl || null)
      setDraftCode(initialCode)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [draftName, draftColor, draftTextColor, draftAvatarUrl, draftCode, id, bot?.isNeural])

  const [deleteBusy, setDeleteBusy] = useState(false)
  async function destroy() {
    if (!bot) return
    if (bot.isClone || bot.isNeural) {
      setSaveError('Permanent bot — use recalculate / reset weights instead.')
      return
    }
    setDeleteBusy(true)
    try {
      await api.deleteBot(id)
      window.location.href = '/poker/bots'
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to delete')
      setDeleteBusy(false)
    }
  }

  // Reset a rule (user-coded) bot's code back to the starter template.
  // Parallels clone recalc + neural reset — gives manual bots a "start
  // over" path that doesn't require deleting and re-creating.
  const [resetCodeBusy, setResetCodeBusy] = useState(false)
  async function resetCode() {
    if (!bot || bot.isClone || bot.isNeural) return
    setResetCodeBusy(true)
    setSaveError(null)
    try {
      const { bot: updated } = await api.resetBotCode(id)
      const initialCode = updated.code && updated.code.trim() ? updated.code : STARTER_CODE
      setBot(updated)
      setDraftCode(initialCode)
      baselineRef.current = { ...baselineRef.current, code: initialCode }
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to reset code')
    } finally {
      setResetCodeBusy(false)
    }
  }

  // Toggle public/private without leaving the page. Saves immediately —
  // visibility isn't part of the dirty-tracking flow because it's a single
  // boolean and the user expects the click to take effect.
  async function setPublic(next) {
    if (!bot) return
    try {
      const { bot: updated } = await api.updateBot(id, { isPublic: !!next })
      setBot(updated)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to update visibility')
    }
  }

  // Replace the clone's code/ELO using the user's most-recent N hands (where
  // N is locked by the clone's tier). The bot id stays stable. The
  // ConfirmPopoverButton wrapping each Recalculate trigger handles the
  // open/cancel/persist-skip flow — this is just the action that runs on
  // confirm (or directly, once the user has opted out of the prompt).
  const [recalcBusy, setRecalcBusy] = useState(false)
  async function recalculate() {
    if (!bot?.isClone) return
    setRecalcBusy(true)
    setSaveError(null)
    try {
      const { bot: updated } = await api.recalculateClone(id)
      const initialCode = updated.code && updated.code.trim() ? updated.code : STARTER_CODE
      setBot(updated)
      setDraftName(updated.name)
      setDraftColor(updated.color)
      setDraftCode(initialCode)
      baselineRef.current = {
        name: updated.name,
        color: updated.color,
        textColor: updated.textColor || 'auto',
        code: initialCode
      }
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to recalculate')
    } finally {
      setRecalcBusy(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-4 pt-4 pb-12">
      {/* Local back-link, auth-reactive offset via RouteNavCluster. */}
      <RouteNavCluster>
        <Link
          href="/poker/bots"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
          <span className="hidden sm:inline">Bots</span>
        </Link>
      </RouteNavCluster>

      <div className="mt-12 flex w-full max-w-4xl flex-col items-center gap-4">
        {loading && (
          <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-500 w-full">
            Loading…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-3 text-xs font-bold text-red-200 w-full">
            {error}
          </div>
        )}

        {bot && (
          <>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {/* Top header shows the *currently saved* bot — the Settings tab
                    already renders a live preview of the draft. Mirroring the
                    draft up here gave two simultaneous previews and made it
                    impossible to compare current vs new at a glance. */}
                <BotAvatar name={bot.name} color={bot.color} textColor={bot.textColor || 'auto'} avatarUrl={bot.avatarUrl || null} size={56} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-xl font-black text-white">{bot.name}</div>
                    {isMine && (
                      <span className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-200">
                        Editor
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
                    BY {(bot.ownerDisplayName || 'UNKNOWN').toUpperCase()} · {isMine ? 'YOUR BOT · CHANGES SAVE TO ALL TABLES' : 'PUBLIC · READ-ONLY'}
                  </div>
                </div>
              </div>
              {isMine && (
                <div className="flex items-center gap-2">
                  {dirty && (
                    <button
                      type="button"
                      onClick={reset}
                      className="rounded-md border border-zinc-500/50 bg-zinc-800/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-700/80"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={save}
                    disabled={!dirty || saving}
                    className={`min-w-[8.5rem] rounded-md px-3 py-2 text-xs font-bold text-center transition-all disabled:opacity-60 ${dirty
                      ? 'border border-emerald-400/70 bg-emerald-500 text-white shadow-md shadow-emerald-500/40 hover:bg-emerald-400 animate-pulse'
                      : 'border border-emerald-500/50 bg-emerald-500/25 text-emerald-100'}`}
                  >
                    {saving ? 'Saving…' : saveOk ? 'Saved ✓' : dirty ? '● Save changes' : 'No changes'}
                  </button>
                </div>
              )}
            </div>

            {saveError && (
              <div className="w-full rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
                {saveError}
              </div>
            )}

            <div className="grid w-full grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="ELO" value={bot.elo} />
              <StatTile label="Hands" value={bot.stats.handsPlayed} />
              <StatTile label="Wins" value={bot.stats.handsWon} />
              <StatTile label="Showdowns" value={bot.stats.showdownsPlayed} />
            </div>

            {/* ELO trajectory — refetches whenever bot.elo flips, so a hand
                that resolves in the background bumps the chart without a
                page reload. Empty/short series renders an inline hint
                instead of an empty axis box. */}
            <EloChart botId={bot.id} currentElo={bot.elo} refreshKey={bot.elo} />

            {/* Head-to-head matchups — surfaces "which bots does this bot
                actually beat?" the one diagnostic worth more than ELO when
                iterating on a bot. Same refreshKey so it updates after a
                fresh hand in the background. */}
            <HeadToHeadPanel botId={bot.id} refreshKey={bot.elo} />

            {/* Clone-only banner — surfaces "Recalculate from your last N hands"
                up top so users don't have to dig into Settings to find it. */}
            {isMine && bot.isClone && (
              <div className="w-full rounded-xl border border-amber-300/50 bg-amber-500/8 p-3 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                      Clone v{bot.cloneTier} · {bot.cloneHandsUsed}-hand window
                    </div>
                    <div className="mt-0.5 text-xs font-bold text-zinc-200">
                      Update this clone with your latest play style — re-derives code, color, and starting ELO from your most recent <span className="text-amber-200">{bot.cloneHandsUsed}</span> hands.
                    </div>
                    <div className="mt-1 text-[10px] font-bold text-zinc-400">
                      Your edits to the code will be overwritten. The bot id stays the same so any saved references keep working.
                    </div>
                  </div>
                  <ConfirmPopoverButton
                    triggerLabel={recalcBusy ? 'Recalculating…' : `Recalculate from last ${bot.cloneHandsUsed} hands`}
                    triggerClassName="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/20 px-4 py-2 text-xs font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                    description={`Re-derives this clone's code, color, and ELO from your last ${bot.cloneHandsUsed} hands. Overwrites your code edits; bot id stays the same.`}
                    confirmLabel="Recalculate"
                    align="right"
                    persistKey="pokerxyz:confirm:clone-recalculate:skip"
                    busy={recalcBusy}
                    onConfirm={recalculate}
                  />
                </div>
              </div>
            )}

            <div className="grid w-full grid-cols-2 gap-2 bg-zinc-800/80 p-2 rounded-xl border border-zinc-600/50 shadow-md">
              {(bot.isNeural
                ? [{ id: 'brain', label: 'Brain' }, { id: 'settings', label: 'Settings' }]
                : bot.isSuper
                  ? [{ id: 'lineup', label: 'Lineup' }, { id: 'settings', label: 'Settings' }]
                  : [{ id: 'code', label: 'Code' }, { id: 'settings', label: 'Settings' }]
              ).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`min-h-10 px-3 py-2 rounded-lg text-xs font-bold leading-tight transition-all ${tab === t.id ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'code' && !bot.isNeural && (
              <div className="w-full flex flex-col gap-4">
                {isMine ? (
                  <>
                    <Simulator code={draftCode} />
                    <JsCodeEditor
                      code={draftCode}
                      onCodeChange={setDraftCode}
                    />
                  </>
                ) : (
                  <pre className="w-full rounded-lg border border-zinc-700/70 bg-zinc-950/60 px-3 py-3 font-mono text-[11px] leading-relaxed text-zinc-300 overflow-auto max-h-[640px]">
{bot.code || '// (no code yet — bot folds/checks until the owner adds some)'}
                  </pre>
                )}
              </div>
            )}

            {tab === 'brain' && bot.isNeural && (
              <NeuralBrainPanel
                bot={bot}
                isMine={isMine}
                onUpdated={(updated) => {
                  setBot(updated)
                  baselineRef.current = {
                    ...baselineRef.current,
                    name: updated.name,
                    color: updated.color,
                    textColor: updated.textColor || 'auto',
                    avatarUrl: updated.avatarUrl || null
                  }
                }}
              />
            )}

            {tab === 'lineup' && bot.isSuper && (
              <SuperLineupTab
                bot={bot}
                isMine={isMine}
                onUpdated={setBot}
              />
            )}

            {tab === 'settings' && (
              isMine ? (
                <div className="w-full flex flex-col gap-4">
                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">Name</div>
                    <input
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      maxLength={32}
                      autoCorrect="off"
                      autoCapitalize="words"
                      spellCheck={false}
                      className="w-full rounded-md border border-zinc-600/60 bg-zinc-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-zinc-300"
                    />
                  </div>

                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Background color</div>
                      <div className="text-[11px] font-bold text-zinc-300">{draftColor}</div>
                    </div>

                    {/* Live avatar preview reflecting the current background +
                        text choices so the user can see the contrast pick.
                        When an uploaded image is set, the preview shows that
                        instead — colors are still saved as fallback for any
                        spot the image can't render. */}
                    <div className="mb-3 flex items-center gap-3">
                      <BotAvatar name={draftName || bot.name} color={draftColor} textColor={draftTextColor} avatarUrl={draftAvatarUrl} size={56} />
                      <div className="text-[11px] font-bold text-zinc-200">
                        {draftAvatarUrl ? 'Custom image active — color shows when no image.' : "Live preview — that's what the table seat will show."}
                      </div>
                    </div>

                    {/* Quick presets first, then custom picker below. */}
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {BOT_COLOR_PRESETS.map(c => {
                        const sel = c.hex === draftColor.toLowerCase()
                        return (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => setDraftColor(c.hex)}
                            aria-label={c.name}
                            title={c.name}
                            className={`h-7 w-7 rounded-full transition-transform ${sel ? 'ring-2 ring-white scale-110' : 'hover:scale-105'}`}
                            style={{ background: c.hex }}
                          />
                        )
                      })}
                    </div>

                    <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/45 p-3 space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Custom color</div>
                      <div className="picker-wrapper [&_.react-colorful]:w-full [&_.react-colorful]:h-32">
                        <HexColorPicker color={draftColor} onChange={setDraftColor} />
                      </div>
                      <label className="flex items-center gap-2 text-[11px] font-bold text-zinc-200">
                        Hex
                        <span className="text-zinc-400">#</span>
                        <HexColorInput
                          color={draftColor}
                          onChange={setDraftColor}
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="text"
                          className="w-28 rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 font-mono text-xs text-white uppercase outline-none focus:border-zinc-300"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">Text color</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'auto', label: 'Auto', hint: 'Pick by contrast' },
                        { id: 'white', label: 'White', hint: 'Force #FFF' },
                        { id: 'black', label: 'Black', hint: 'Force #111' }
                      ].map(opt => {
                        const sel = draftTextColor === opt.id
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setDraftTextColor(opt.id)}
                            className={`flex flex-col items-center gap-1 rounded-md border px-3 py-2 transition-colors ${
                              sel
                                ? 'border-emerald-500/50 bg-emerald-500/15'
                                : 'border-zinc-600/60 bg-zinc-900 hover:bg-zinc-800'
                            }`}
                          >
                            <span className="text-xs font-black text-white">{opt.label}</span>
                            <span className="text-[9px] font-bold text-zinc-300">{opt.hint}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Custom avatar — overrides the color+initials at the table.
                      Upload goes through the same presign + S3 flow as user
                      profile pictures; image becomes one of the user's saved
                      PFPs and can be re-used across bots if desired. */}
                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Profile picture</div>
                        <div className="text-[11px] font-bold text-zinc-400">
                          Optional. Overrides the color + initials at the table.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => avatarFileInputRef.current?.click()}
                        disabled={avatarUploading}
                        className="rounded-md border border-amber-400/60 bg-amber-500/15 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/25 disabled:opacity-50"
                      >
                        {avatarUploading ? 'Uploading…' : draftAvatarUrl ? 'Replace' : '+ Upload'}
                      </button>
                    </div>
                    <input
                      ref={avatarFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        if (!f) return
                        if (f.size > 5 * 1024 * 1024) { setSaveError('Image too large — max 5MB.'); return }
                        if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { setSaveError('Use PNG, JPEG, WebP, or GIF.'); return }
                        setCropFile(f)
                      }}
                    />
                    {draftAvatarUrl ? (
                      <div className="flex items-center gap-3">
                        <BotAvatar name={draftName || bot.name} color={draftColor} textColor={draftTextColor} avatarUrl={draftAvatarUrl} size={56} />
                        <button
                          type="button"
                          onClick={() => setDraftAvatarUrl(null)}
                          className="rounded-md border border-zinc-500/50 bg-zinc-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-zinc-700"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-md border border-zinc-700/70 bg-zinc-900/40 px-3 py-3 text-[11px] font-bold text-zinc-500">
                        No image — bot shows its color + initials at the table.
                      </div>
                    )}
                    {avatarUploadError && (
                      <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-bold text-red-200">
                        {avatarUploadError}
                      </div>
                    )}
                  </div>

                  {/* Visibility toggle — clones default private, manual bots
                      default public. Either can be flipped freely. */}
                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Visibility</div>
                        <div className="text-[11px] font-bold text-zinc-400">
                          {bot.isPublic
                            ? 'Public — listed in the public roster, anyone can sit it.'
                            : 'Private — only you can see this bot or seat it.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPublic(!bot.isPublic)}
                        className={`shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                          bot.isPublic
                            ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
                            : 'border-zinc-500/60 bg-zinc-700 text-white hover:bg-zinc-600'
                        }`}
                      >
                        {bot.isPublic ? 'Public ✓' : 'Make Public'}
                      </button>
                    </div>
                    {bot.isPublic && (
                      <button
                        type="button"
                        onClick={() => setPublic(false)}
                        className="text-[10px] font-bold text-zinc-400 hover:text-white"
                      >
                        Make private
                      </button>
                    )}
                  </div>

                  {/* Clones: recalculate from last N hands. Tier-locked sample
                      size — recalc just runs the generator again with fresh
                      data. The bot id stays stable so any saved references
                      keep pointing at the same bot. */}
                  {bot.isClone && (
                    <div className="rounded-xl border border-amber-300/50 bg-amber-500/5 p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">
                            Clone v{bot.cloneTier} · {bot.cloneHandsUsed} hands
                          </div>
                          <div className="text-[11px] font-bold text-zinc-300">
                            Re-derives the code, color, and starting ELO from your most recent {bot.cloneHandsUsed} hands. Your edits will be overwritten.
                          </div>
                        </div>
                        <ConfirmPopoverButton
                          triggerLabel={recalcBusy ? 'Recalculating…' : 'Recalculate'}
                          triggerClassName="shrink-0 rounded-md border border-amber-400/60 bg-amber-500/20 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
                          description={`Re-derives this clone's code, color, and ELO from your last ${bot.cloneHandsUsed} hands. Overwrites your code edits; bot id stays the same.`}
                          confirmLabel="Recalculate"
                          align="right"
                          persistKey="pokerxyz:confirm:clone-recalculate:skip"
                          busy={recalcBusy}
                          onConfirm={recalculate}
                        />
                      </div>
                      <div className="mt-2 rounded-md border border-zinc-700/70 bg-zinc-950/40 px-2 py-1 text-[10px] font-bold text-zinc-400">
                        Clones can't be deleted — they're permanent slots tied to your play data.
                      </div>
                    </div>
                  )}

                  {/* Reset to starter code — only for rule bots. Mirrors the
                      "Recalculate" affordance clones have and "Reset weights"
                      neural bots have, so all three permanent-or-revertable
                      bot types offer the same start-over option. */}
                  {!bot.isClone && !bot.isNeural && !bot.isSuper && (
                    <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Reset code</div>
                          <div className="text-[11px] font-bold text-zinc-400">
                            Replaces this bot's code with the starter template. Stats and ELO stay.
                          </div>
                        </div>
                        <ConfirmPopoverButton
                          triggerLabel={resetCodeBusy ? 'Resetting…' : 'Reset code'}
                          triggerClassName="shrink-0 rounded-md border border-zinc-500/60 bg-zinc-700 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-white hover:bg-zinc-600 disabled:opacity-50"
                          description="Overwrites your current code with the starter template. Your edits will be lost."
                          confirmLabel="Reset"
                          align="right"
                          persistKey="pokerxyz:confirm:reset-code:skip"
                          busy={resetCodeBusy}
                          onConfirm={resetCode}
                        />
                      </div>
                    </div>
                  )}

                  {/* Danger zone — only renders for non-clone, non-neural
                      bots. Clones and NN bots are gated server-side too, but
                      hiding the button keeps the UI honest. Uses the same
                      confirm popover as everywhere else for consistency
                      with reset/recalc rather than a window.confirm(). */}
                  {!bot.isClone && !bot.isNeural && (
                    <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="text-[10px] font-black uppercase tracking-widest text-red-200">Danger zone</div>
                          <div className="text-[11px] font-bold text-zinc-300">
                            Permanently delete this bot.
                          </div>
                        </div>
                        <ConfirmPopoverButton
                          triggerLabel={deleteBusy ? 'Deleting…' : 'Delete bot'}
                          triggerClassName="shrink-0 rounded-md border border-red-500/60 bg-red-500/25 px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-red-100 hover:bg-red-500/40 disabled:opacity-50"
                          description={`Delete bot "${bot.name}"? This can't be undone.`}
                          confirmLabel="Delete"
                          align="right"
                          busy={deleteBusy}
                          onConfirm={destroy}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-500">
                  Read-only — only the owner can edit settings.
                </div>
              )
            )}
          </>
        )}
      </div>

      <AvatarCropper
        open={!!cropFile}
        file={cropFile}
        busy={avatarUploading}
        onCancel={() => setCropFile(null)}
        onConfirm={async (blob) => {
          try {
            // saveToHistory:true → the cropped image lands in the owner's
            // PFP history too, so they can pick the same image for a
            // different bot or for themselves without re-uploading.
            const { publicUrl } = await uploadAvatar(blob, { saveToHistory: true })
            setDraftAvatarUrl(publicUrl)
            setCropFile(null)
          } catch {
            /* useUpload reports the error; cropper stays open for retry */
          }
        }}
      />
    </div>
  )
}
