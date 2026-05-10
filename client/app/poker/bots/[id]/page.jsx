'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HomeBackLink from '../../../components/HomeBackLink'
import AccountMenu from '../../../components/AccountMenu'
import BotAvatar from '../../../components/BotAvatar'
import JsCodeEditor, { STARTER_CODE } from '../../../components/JsCodeEditor'
import Simulator from '../../../components/Simulator'
import { useAuth } from '../../../lib/useAuth'
import { api } from '../../../lib/api'
import { BOT_COLOR_PRESETS, isValidHex } from '../../../lib/botColors'
import { HexColorPicker, HexColorInput } from 'react-colorful'

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
  const [draftCode, setDraftCode] = useState('')

  const [tab, setTab] = useState('code')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveOk, setSaveOk] = useState(false)

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
        setDraftCode(initialCode)
        baselineRef.current = {
          name: bot.name,
          color: bot.color,
          textColor: bot.textColor || 'auto',
          code: initialCode
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, authLoading])

  const dirty = useMemo(() => {
    if (!baselineRef.current) return false
    return (
      draftName !== baselineRef.current.name ||
      draftColor !== baselineRef.current.color ||
      draftTextColor !== baselineRef.current.textColor ||
      draftCode !== baselineRef.current.code
    )
  }, [draftName, draftColor, draftTextColor, draftCode])

  const reset = useCallback(() => {
    if (!baselineRef.current) return
    setDraftName(baselineRef.current.name)
    setDraftColor(baselineRef.current.color)
    setDraftTextColor(baselineRef.current.textColor || 'auto')
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
      // Always send codeEnabled=true: bots are code-only.
      const { bot: updated } = await api.updateBot(id, {
        name: draftName.trim(),
        color: draftColor,
        textColor: draftTextColor,
        code: draftCode,
        codeEnabled: true
      })
      const initialCode = updated.code && updated.code.trim() ? updated.code : STARTER_CODE
      setBot(updated)
      baselineRef.current = {
        name: updated.name,
        color: updated.color,
        textColor: updated.textColor || 'auto',
        code: initialCode
      }
      setDraftName(updated.name)
      setDraftColor(updated.color)
      setDraftTextColor(updated.textColor || 'auto')
      setDraftCode(initialCode)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 2000)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [draftName, draftColor, draftTextColor, draftCode, id])

  async function destroy() {
    if (!bot) return
    if (!confirm(`Delete bot "${bot.name}"? This cannot be undone.`)) return
    try {
      await api.deleteBot(id)
      window.location.href = '/poker/bots'
    } catch (err) {
      setSaveError(err.message || 'Failed to delete')
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center px-4 pt-4 pb-12">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <Link
          href="/poker/bots"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          <span aria-hidden="true" className="text-base leading-none sm:text-lg">&lt;</span>
          <span className="hidden sm:inline">Bots</span>
        </Link>
        <AccountMenu />
      </div>

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
                <BotAvatar name={draftName || bot.name} color={draftColor} textColor={draftTextColor} size={56} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-xl font-black text-white">{draftName || bot.name}</div>
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
                    className={`rounded-md px-3 py-2 text-xs font-bold transition-all disabled:opacity-60 ${dirty
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

            <div className="grid w-full grid-cols-2 gap-2 bg-zinc-800/80 p-2 rounded-xl border border-zinc-600/50 shadow-md">
              {[
                { id: 'code',     label: 'Code' },
                { id: 'settings', label: 'Settings' }
              ].map(t => (
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

            {tab === 'code' && (
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

            {tab === 'settings' && (
              isMine ? (
                <div className="w-full flex flex-col gap-4">
                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">Name</div>
                    <input
                      value={draftName}
                      onChange={e => setDraftName(e.target.value)}
                      maxLength={32}
                      className="w-full rounded-md border border-zinc-600/60 bg-zinc-900 px-3 py-2 text-sm font-bold text-white outline-none focus:border-zinc-300"
                    />
                  </div>

                  <div className="rounded-xl border border-zinc-600/50 bg-zinc-800/95 p-3 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Background color</div>
                      <div className="text-[11px] font-bold text-zinc-300">{draftColor}</div>
                    </div>

                    {/* Live avatar preview reflecting the current background +
                        text choices so the user can see the contrast pick. */}
                    <div className="mb-3 flex items-center gap-3">
                      <BotAvatar name={draftName || bot.name} color={draftColor} textColor={draftTextColor} size={56} />
                      <div className="text-[11px] font-bold text-zinc-200">
                        Live preview — that's what the table seat will show.
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
                          className="w-24 rounded-md border border-zinc-600/60 bg-zinc-900 px-2 py-1 font-mono text-xs text-white uppercase outline-none focus:border-zinc-300"
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

                  <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-3 shadow-sm">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-red-200">Danger zone</div>
                    <button
                      type="button"
                      onClick={destroy}
                      className="rounded-md border border-red-500/60 bg-red-500/25 px-3 py-1.5 text-xs font-bold text-red-100 hover:bg-red-500/40"
                    >
                      Delete bot
                    </button>
                  </div>
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
    </div>
  )
}
