'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, getStoredToken } from '../lib/api'
import { useAuth } from '../lib/useAuth'
import { useUpload } from '../lib/useUpload'
import { ProfileAvatar } from './ProfileSelector'
import AvatarCropper from './AvatarCropper'
import BotAvatar from './BotAvatar'

// Unified profile modal. One flowing surface:
//   identity strip → meta row → calendar + day list → follows row → edit.
// No tabs, no nested boxed sections — chrome stays out of the way and lets
// the calendar carry the visual weight.

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

// UTC because user_hand_archive.played_day is computed in UTC. A 23:00-local
// hand otherwise paints on a different calendar cell than the DB lookup.
function ymd(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildCalendar(year, month) {
  const first = new Date(Date.UTC(year, month, 1))
  const firstWeekday = first.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(Date.UTC(year, month, d)))
  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 42) cells.push(null)
  return cells
}

// GitHub-style year strip. Returns:
//   - cells: 53-week × 7-day array in column-major order (each column is
//            one week, rows 0..6 = Sun..Sat). Cells before the start date
//            or after today are null.
//   - monthMarkers: [{ col, label }] for month-name labels above the grid
// Anchors to today (UTC) so the rightmost column is the current week.
function buildYearStrip(today) {
  const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const TOTAL_WEEKS = 53
  const totalDays = TOTAL_WEEKS * 7
  // Walk back so the last column ends at today's weekday — leaves a
  // jagged "future" tail in the current week (rendered as nulls).
  const todayDow = todayUTC.getUTCDay()
  const lastColStart = new Date(todayUTC)
  lastColStart.setUTCDate(lastColStart.getUTCDate() - todayDow)
  const startDate = new Date(lastColStart)
  startDate.setUTCDate(startDate.getUTCDate() - (TOTAL_WEEKS - 1) * 7)

  const cells = new Array(totalDays).fill(null)
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startDate)
    d.setUTCDate(d.getUTCDate() + i)
    if (d > todayUTC) continue // future-of-current-week stays null
    const col = Math.floor(i / 7)
    const row = i % 7
    cells[col * 7 + row] = d // column-major: 7 rows per column
  }

  // Month markers: place a label at the column where each new month
  // first appears in row 0 (the Sunday). Skip the first column if it
  // would crowd the prior month's label.
  const monthMarkers = []
  let lastMonth = -1
  for (let col = 0; col < TOTAL_WEEKS; col++) {
    const cell = cells[col * 7] // Sunday of this column
    if (!cell) continue
    const m = cell.getUTCMonth()
    if (m !== lastMonth) {
      monthMarkers.push({
        col,
        label: cell.toLocaleString(undefined, { month: 'short' })
      })
      lastMonth = m
    }
  }
  return { cells, monthMarkers, totalWeeks: TOTAL_WEEKS }
}

function fmtChips(n) {
  const v = Number(n) || 0
  const sign = v >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(v).toLocaleString()}`
}

function formatRelative(ts) {
  if (!ts) return null
  const diff = Date.now() - new Date(ts).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString()
}

function fmtDateShort(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric'
  })
}

// "Today" / "Yesterday" / "May 11" — friendlier than a raw YYYY-MM-DD.
// Anchored to UTC for the same reason `ymd` is — the archive's played_day
// column is UTC, so a 23:00-local hand otherwise reads as "yesterday".
function fmtDayLabel(s) {
  if (!s) return ''
  const todayKey = ymd(new Date())
  if (s === todayKey) return 'Today'
  const y = new Date()
  y.setUTCDate(y.getUTCDate() - 1)
  if (s === ymd(y)) return 'Yesterday'
  return fmtDateShort(s)
}

const PAGE_SIZE = 40

export default function ProfileModal({ open, onClose, onProfileChange }) {
  const { user, refreshUser } = useAuth()
  const { upload, uploadFromUrl, busy: uploading, error: uploadError, reset: resetUpload } = useUpload()

  // --- Edit state -------------------------------------------------------
  // Edit section is collapsed by default — viewing is the common case.
  const [editOpen, setEditOpen] = useState(false)
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [description, setDescription] = useState('')
  // Cap chosen to match the server's MAX_DESCRIPTION_LENGTH. The textarea
  // shows the count live so the user knows when they're near the limit.
  const DESCRIPTION_MAX = 280
  const [pfps, setPfps] = useState([])
  const [pfpsLoading, setPfpsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveOk, setSaveOk] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [cropFile, setCropFile] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [urlBusy, setUrlBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  // --- Activity state ---------------------------------------------------
  const [summary, setSummary] = useState(null)
  const [days, setDays] = useState([])
  const [daysLoading, setDaysLoading] = useState(false)
  const nowRef = useRef(new Date())
  const [viewYear, setViewYear] = useState(nowRef.current.getUTCFullYear())
  const [viewMonth, setViewMonth] = useState(nowRef.current.getUTCMonth())
  const [selectedDay, setSelectedDay] = useState(null)
  const [hands, setHands] = useState([])
  const [handsTotal, setHandsTotal] = useState(0)
  const [handsOffset, setHandsOffset] = useState(0)
  const [handsLoading, setHandsLoading] = useState(false)
  const [handsLoadingMore, setHandsLoadingMore] = useState(false)
  const [handsError, setHandsError] = useState(null)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportError, setExportError] = useState(null)

  // Follows popup — opened by clicking the count in the meta row. Loads
  // the list lazily so the modal's initial render stays cheap.
  const [followsPopup, setFollowsPopup] = useState(null)  // 'followers' | 'following' | null
  const [followsList, setFollowsList] = useState([])
  const [followsLoading, setFollowsLoading] = useState(false)

  // Hydrate edit state from authed user on every open.
  useEffect(() => {
    if (!open || !user) return
    setUsername(user.displayName || '')
    setAvatarUrl(user.avatarUrl || null)
    setDescription(user.description || '')
    setSaveOk(false)
    setSaveError(null)
    setEditOpen(false)
    resetUpload()
    // Default the hands panel to today so the right side renders content
    // immediately instead of asking the user to click anywhere.
    setSelectedDay(ymd(new Date()))
  }, [open, user, resetUpload])

  // Public bots — load lazily when the modal opens. Mirrors the activity
  // fetch pattern; a profile without any public bots just hides the section.
  const [publicBots, setPublicBots] = useState([])
  const [publicBotsLoading, setPublicBotsLoading] = useState(false)
  useEffect(() => {
    if (!open || !user?.id) return
    setPublicBotsLoading(true)
    api.publicBotsByUser(user.id)
      .then(r => setPublicBots(r.bots || []))
      .catch(() => setPublicBots([]))
      .finally(() => setPublicBotsLoading(false))
  }, [open, user?.id])

  // Body scroll-lock + ESC.
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

  // Summary + activity load on open.
  useEffect(() => {
    if (!open || !user) return
    api.mySummary().then(setSummary).catch(() => setSummary(null))
    setDaysLoading(true)
    const to = ymd(new Date())
    const fromDate = new Date()
    fromDate.setUTCDate(fromDate.getUTCDate() - 364)
    api.myActivity({ from: ymd(fromDate), to })
      .then(r => setDays(r.days || []))
      .catch(() => setDays([]))
      .finally(() => setDaysLoading(false))
  }, [open, user?.id])

  // Follows list fetch — runs each time the popup direction changes.
  // Cleared when the popup closes so a different direction doesn't briefly
  // show stale rows before its own fetch lands.
  useEffect(() => {
    if (!followsPopup || !user) {
      setFollowsList([])
      return
    }
    let cancelled = false
    setFollowsLoading(true)
    api.myFollows({ direction: followsPopup, limit: 50 })
      .then(r => { if (!cancelled) setFollowsList(r.follows || []) })
      .catch(() => { if (!cancelled) setFollowsList([]) })
      .finally(() => { if (!cancelled) setFollowsLoading(false) })
    return () => { cancelled = true }
  }, [followsPopup, user?.id])

  // PFP history (lazy — only when the edit section is open).
  useEffect(() => {
    if (!open || !user || !editOpen) return
    let cancelled = false
    setPfpsLoading(true)
    api.listPfps()
      .then(r => { if (!cancelled) setPfps(r.pfps || []) })
      .catch(() => { if (!cancelled) setPfps([]) })
      .finally(() => { if (!cancelled) setPfpsLoading(false) })
    return () => { cancelled = true }
  }, [open, user?.id, editOpen])

  // Day drill-down.
  useEffect(() => {
    if (!selectedDay) {
      setHands([]); setHandsTotal(0); setHandsOffset(0); return
    }
    setHandsLoading(true); setHandsError(null); setHandsOffset(0)
    api.myHands({ day: selectedDay, offset: 0, limit: PAGE_SIZE })
      .then(r => {
        setHands(r.hands || [])
        setHandsTotal(r.total ?? (r.hands?.length || 0))
        setHandsOffset(r.hands?.length || 0)
      })
      .catch(err => setHandsError(err.detail || err.message || 'Failed to load hands'))
      .finally(() => setHandsLoading(false))
  }, [selectedDay])

  const loadMoreHands = useCallback(async () => {
    if (!selectedDay || handsLoadingMore || hands.length >= handsTotal) return
    setHandsLoadingMore(true); setHandsError(null)
    try {
      const r = await api.myHands({ day: selectedDay, offset: handsOffset, limit: PAGE_SIZE })
      setHands(prev => [...prev, ...(r.hands || [])])
      setHandsOffset(prev => prev + (r.hands?.length || 0))
      if (r.total != null) setHandsTotal(r.total)
    } catch (err) {
      setHandsError(err.detail || err.message || 'Failed to load more')
    } finally {
      setHandsLoadingMore(false)
    }
  }, [selectedDay, handsOffset, handsLoadingMore, handsTotal, hands.length])

  const daysByKey = useMemo(() => {
    const map = new Map()
    for (const d of days) map.set(d.day, d)
    return map
  }, [days])
  // GitHub-style year strip. We rebuild whenever the modal opens (nowRef
  // updates) so a session that stays open over midnight slides the strip
  // forward correctly.
  const { cells, monthMarkers, totalWeeks } = useMemo(
    () => buildYearStrip(nowRef.current),
    [nowRef.current]
  )

  // Visible-range export. Uses authed fetch + saveAs because the endpoint
  // is auth-walled and a bare <a download> can't carry a Bearer token.
  const exportRange = useCallback(async (format) => {
    if (!days.length) return
    setExportBusy(true); setExportError(null)
    try {
      const sortedDays = [...days].sort((a, b) => a.day.localeCompare(b.day))
      const from = sortedDays[0].day
      const to = sortedDays[sortedDays.length - 1].day
      const url = api.exportHandsUrl({ from, to, format })
      const token = getStoredToken()
      const resp = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`Export failed (HTTP ${resp.status}) ${text.slice(0, 120)}`)
      }
      const blob = await resp.blob()
      const dlUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dlUrl
      a.download = `pokerxyz-hands-${from}-to-${to}.${format}`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(dlUrl), 1000)
    } catch (err) {
      setExportError(err.message || 'Export failed')
    } finally {
      setExportBusy(false)
    }
  }, [days])

  // Clipboard paste anywhere in the modal — only outside inputs.
  useEffect(() => {
    if (!open || !user) return
    function onPaste(e) {
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.kind !== 'file') continue
        if (!/^image\/(png|jpe?g|webp|gif)$/.test(item.type)) continue
        const blob = item.getAsFile()
        if (!blob) continue
        if (blob.size > 5 * 1024 * 1024) { setSaveError('Pasted image too large — max 5MB.'); return }
        e.preventDefault()
        // Auto-expand edit on paste so the user sees the cropper context.
        setEditOpen(true)
        setCropFile(blob)
        return
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open, user])

  if (!open || !user) return null
  if (typeof document === 'undefined') return null

  function pickFile() { fileInputRef.current?.click() }
  function acceptFile(f) {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { setSaveError('Image too large — max 5MB.'); return }
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(f.type)) { setSaveError('Use PNG, JPEG, WebP, or GIF.'); return }
    setSaveError(null)
    setCropFile(f)
  }
  function onFileChosen(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    acceptFile(f)
  }
  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    acceptFile(f)
  }

  async function handleCropConfirm(blob) {
    setSaveError(null)
    try {
      const { publicUrl, pfp } = await upload(blob, { saveToHistory: true })
      setAvatarUrl(publicUrl)
      setCropFile(null)
      if (pfp) setPfps(prev => [pfp, ...prev])
    } catch {}
  }

  async function deletePfp(id) {
    const target = pfps.find(p => p.id === id)
    if (!target) return
    if (!confirm('Delete this image from your history?')) return
    try {
      await api.deletePfp(id)
      setPfps(prev => prev.filter(p => p.id !== id))
      if (avatarUrl === target.publicUrl) setAvatarUrl(null)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Failed to delete')
    }
  }

  async function submitUrl() {
    setSaveError(null); setUrlBusy(true)
    try {
      const resp = await uploadFromUrl(urlInput.trim())
      if (resp?.publicUrl) {
        setAvatarUrl(resp.publicUrl)
        if (resp?.pfp) setPfps(prev => [resp.pfp, ...prev.filter(p => p.id !== resp.pfp.id)])
        setUrlInput('')
      }
    } catch {} finally { setUrlBusy(false) }
  }

  async function save() {
    setSaving(true); setSaveError(null); setSaveOk(false)
    try {
      const patch = {}
      const trimmed = username.trim()
      if (trimmed && trimmed !== user.displayName) patch.displayName = trimmed
      if (avatarUrl !== user.avatarUrl) patch.avatarUrl = avatarUrl
      // Bio: send the trimmed value when it differs from the current one.
      // Empty string is a valid value (clears the bio); send it explicitly
      // so the server knows the user intended to clear it.
      const trimmedDescription = description.trim()
      const currentDescription = user.description || ''
      if (trimmedDescription !== currentDescription) patch.description = trimmedDescription
      if (Object.keys(patch).length === 0) {
        setSaveOk(true); setTimeout(() => setSaveOk(false), 1500); return
      }
      await api.updateMe(patch)
      await refreshUser?.()
      onProfileChange?.({ displayName: trimmed || user.displayName, avatarUrl })
      setSaveOk(true); setTimeout(() => setSaveOk(false), 1500)
    } catch (err) {
      setSaveError(err.detail || err.message || 'Save failed')
    } finally { setSaving(false) }
  }

  const dirty = (username.trim() && username.trim() !== user.displayName)
    || (avatarUrl !== user.avatarUrl)
    || (description.trim() !== (user.description || ''))
  const sm = summary?.user || user
  const rival = summary?.rival
  const totalHands = days.reduce((acc, d) => acc + d.handsPlayed, 0)
  const totalAnonHands = days.reduce((acc, d) => acc + (d.anonHands || 0), 0)
  const winRate = (sm.handsPlayed ?? 0) > 0 ? Math.round(100 * (sm.handsWon ?? 0) / sm.handsPlayed) : null
  const lastSeenRel = sm.lastActiveAt ? formatRelative(sm.lastActiveAt) : null

  return createPortal(
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        className="fixed inset-0 z-[300] flex items-start justify-center bg-black/65 p-3 sm:items-center"
        onClick={() => !saving && !uploading && onClose?.()}
      >
        <div
          className="w-full max-w-3xl max-h-[92dvh] overflow-y-auto rounded-2xl border border-zinc-700/70 bg-zinc-900/98 shadow-2xl"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Identity strip — avatar, name, ELO chip, status dot, close.
              No nested panel; this is the modal's own top edge. */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-3">
            <div className="relative shrink-0">
              <ProfileAvatar
                avatarUrl={avatarUrl}
                avatarId={null}
                name={user.displayName}
                nameKey={user.id || user.email}
                size={52}
                className="ring-2 ring-zinc-700"
              />
              <span
                className="absolute -right-0.5 -bottom-0.5 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-900"
                aria-label="Online"
                title="You're online"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div id="profile-title" className="truncate text-base font-black text-white">{user.displayName}</div>
              <div className="truncate text-[11px] font-bold text-zinc-500">{user.email}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-1 text-[11px] font-black uppercase tracking-widest text-amber-200">
                {sm.elo ?? 500} elo
              </span>
              <button
                type="button"
                onClick={() => onClose?.()}
                disabled={saving || uploading}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
              >✕</button>
            </div>
          </div>

          {/* Meta row — one line of supporting numbers + rival mention.
              Followers / following are buttons → open the list popup.
              Hover affordances make the click-target obvious. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-800/80 px-4 pb-3 text-[11px] font-bold text-zinc-400">
            <span>{sm.handsPlayed ?? 0} hands</span>
            {winRate != null && <span>· {winRate}% wins</span>}
            <span>·</span>
            <button
              type="button"
              onClick={() => setFollowsPopup('followers')}
              className="cursor-pointer rounded px-1 -mx-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              aria-label="View followers"
            >
              <span className="font-black text-white">{sm.followersCount ?? 0}</span> followers
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setFollowsPopup('following')}
              className="cursor-pointer rounded px-1 -mx-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
              aria-label="View following"
            >
              <span className="font-black text-white">{sm.followingCount ?? 0}</span> following
            </button>
            {rival ? (
              <span>· rival <span className="font-black text-amber-200">{rival.opponentName}</span> ({fmtChips(rival.chipsNet)})</span>
            ) : (
              <span>· no rival yet</span>
            )}
            {lastSeenRel && <span className="ml-auto text-zinc-500">last active {lastSeenRel}</span>}
          </div>

          {/* Bio strip — shows the user's description in read mode. The
              edit affordance lives inside the "Edit" disclosure below;
              clicking the bio here jumps straight into edit mode so the
              user doesn't have to scroll. Empty state nudges users to
              add one. */}
          <div className="border-b border-zinc-800/80 px-4 py-3">
            {user.description ? (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="block w-full text-left text-[12px] leading-snug text-zinc-200 hover:text-white"
                title="Click to edit"
              >
                {user.description}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="block w-full text-left text-[11px] italic text-zinc-500 hover:text-zinc-300"
              >
                + Add a short bio — what's your poker style?
              </button>
            )}
          </div>

          {/* Public bots — what this user is currently sharing. Hidden
              when the user has none (keeps the modal short). Each row
              links to the bot detail page so a viewer can sit one at
              their table. */}
          {(publicBots.length > 0 || publicBotsLoading) && (
            <div className="border-b border-zinc-800/80 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
                  Public bots
                </div>
                <div className="text-[10px] font-bold text-zinc-500">
                  {publicBotsLoading ? 'Loading…' : `${publicBots.length} shared`}
                </div>
              </div>
              {publicBots.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {publicBots.slice(0, 6).map(b => (
                    <a
                      key={b.id}
                      href={`/poker/bots/${b.id}`}
                      className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
                    >
                      <BotAvatar
                        name={b.name}
                        color={b.color || '#3b82f6'}
                        textColor={b.textColor || 'auto'}
                        avatarUrl={b.avatarUrl}
                        size={24}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-black text-white">{b.name}</div>
                        <div className="truncate text-[9px] font-bold text-zinc-400">
                          ELO {b.elo} · {b.stats?.handsPlayed ?? 0} hands
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {publicBots.length > 6 && (
                <div className="mt-1 text-right text-[10px] font-bold text-zinc-500">+ {publicBots.length - 6} more</div>
              )}
            </div>
          )}

          {/* Calendar + day list — GitHub-style year strip on top, day
              drill-down panel below. The strip stretches across the full
              modal width; on smaller screens it scrolls horizontally so
              cells stay readable instead of being squeezed flat. */}
          <div className="border-b border-zinc-800/80 px-4 py-3">
            {/* Headline total + (lightly) the Less/More color ramp. The
                headline mirrors GitHub's "264 contributions in the last
                year" copy — gives the strip a single anchor sentence. */}
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="text-[12px] font-bold text-zinc-200">
                {daysLoading ? 'Loading…' : (
                  <>
                    <span className="text-amber-200">{totalHands + totalAnonHands}</span>
                    {' '}hands played in the last year
                  </>
                )}
              </div>
            </div>
            {/* Scrollable container at narrow widths. The grid sits in a
                fixed-cell layout (10px squares) so the heatmap pattern
                stays stable regardless of viewport width. */}
            <div className="overflow-x-auto">
              <div className="inline-block">
                {/* Month labels along the top. Each marker is absolutely
                    placed via its grid column so the labels track the
                    cells underneath even if the user scrolls. */}
                <div
                  className="relative ml-6 mb-1"
                  style={{ width: `${totalWeeks * 13}px`, height: '12px' }}
                >
                  {monthMarkers.map(m => (
                    <span
                      key={`${m.col}-${m.label}`}
                      className="absolute top-0 text-[9px] font-bold uppercase tracking-widest text-zinc-500"
                      style={{ left: `${m.col * 13}px` }}
                    >
                      {m.label}
                    </span>
                  ))}
                </div>

                {/* Strip itself: a 6px-wide day-of-week column on the
                    left (M / W / F labels) + a column-major grid of
                    cells. CSS grid with grid-auto-flow:column lets us
                    drop the cells in column-by-column without manually
                    transposing the array. */}
                <div className="flex items-start gap-1">
                  <div className="flex flex-col gap-[3px] pr-1 pt-[2px] text-[8px] font-bold uppercase tracking-widest text-zinc-600">
                    {/* Match GitHub: only label Mon / Wed / Fri so the
                        column stays narrow. Rows 0/2/4/6 stay blank. */}
                    {['', 'M', '', 'W', '', 'F', ''].map((d, i) => (
                      <div key={i} className="h-[10px] leading-[10px]">{d}</div>
                    ))}
                  </div>
                  <div
                    className="grid gap-[3px]"
                    style={{
                      gridTemplateRows: 'repeat(7, 10px)',
                      gridAutoFlow: 'column',
                      gridAutoColumns: '10px'
                    }}
                  >
                    {cells.map((cell, i) => {
                      if (!cell) return <div key={i} className="h-[10px] w-[10px] rounded-sm bg-transparent" />
                      const key = ymd(cell)
                      const info = daysByKey.get(key)
                      const isSelected = selectedDay === key
                      const publicHands = info?.handsPlayed ?? 0
                      const privateHands = info?.anonHands ?? 0
                      const total = publicHands + privateHands
                      // Single amber heatmap — any day you played gets
                      // the same light-yellow treatment, intensity scales
                      // with total hands. Whether play was public or
                      // private surfaces only on hover/click.
                      let bgClass = 'bg-zinc-800/70'
                      if (total > 0) {
                        const intensity = total < 5 ? 1
                          : total < 15 ? 2
                          : total < 40 ? 3 : 4
                        bgClass = ['bg-zinc-800/70','bg-amber-200/20','bg-amber-300/40','bg-amber-300/60','bg-amber-300/85'][intensity]
                      }
                      // GitHub-style tooltip phrasing. Inactive days
                      // explicitly say "No hands played" so the click
                      // still surfaces useful context instead of being
                      // a dead cell.
                      const dateLabel = cell.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
                      const title = total > 0
                        ? `${total} hand${total === 1 ? '' : 's'} played on ${dateLabel}${info?.dailyCompleted ? ' · daily ✓' : ''}`
                        : `No hands played on ${dateLabel}`
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setSelectedDay(key)}
                          className={`relative h-[10px] w-[10px] cursor-pointer rounded-sm transition-all hover:ring-1 hover:ring-amber-200 ${isSelected ? 'ring-2 ring-amber-300' : ''} ${bgClass}`}
                          title={title}
                        >
                          {/* Star marks a completed daily for that day.
                              Sits inside the 10px cell, centered. */}
                          {info?.dailyCompleted && (
                            <span
                              className="absolute inset-0 flex items-center justify-center text-[7px] leading-none text-amber-100"
                              aria-label="daily completed"
                            >★</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

              {/* GitHub-style "Less ▢▢▣▣▤ More" legend on the right,
                  Export buttons on the left. Both sit below the grid so
                  the cells get top billing. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] font-bold text-zinc-500">
                <div className="flex items-center gap-1">
                  <span>Export</span>
                  <button
                    type="button"
                    onClick={() => exportRange('jsonl')}
                    disabled={exportBusy || days.length === 0}
                    className="cursor-pointer rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/15 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >jsonl</button>
                  <button
                    type="button"
                    onClick={() => exportRange('csv')}
                    disabled={exportBusy || days.length === 0}
                    className="cursor-pointer rounded border border-zinc-700 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/15 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >csv</button>
                  {exportBusy && <span className="ml-1">…</span>}
                  {exportError && <span className="ml-1 text-red-300">{exportError}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <span>Less</span>
                  {['bg-zinc-800/70','bg-amber-200/20','bg-amber-300/40','bg-amber-300/60','bg-amber-300/85'].map((c, i) => (
                    <span key={i} className={`h-[10px] w-[10px] rounded-sm ${c}`} />
                  ))}
                  <span>More</span>
                </div>
              </div>
            </div>

            <div className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">
                  Hands · {fmtDayLabel(selectedDay)}
                </div>
                {handsTotal > 0 && (
                  <div className="text-[10px] font-bold text-zinc-500">{handsTotal} total</div>
                )}
              </div>
              {handsLoading && <div className="text-xs font-bold text-zinc-500">Loading…</div>}
              {handsError && (
                <div className="text-xs font-bold text-red-300">{handsError}</div>
              )}
              {!handsLoading && hands.length === 0 && !handsError && (() => {
                // Pull the day's daily-activity row so the empty-state can
                // explain anon-only days (otherwise "no hands" reads as a
                // bug when the calendar dot clearly shows N hands played).
                const dayInfo = daysByKey.get(selectedDay)
                const anon = dayInfo?.anonHands ?? 0
                const pub = dayInfo?.handsPlayed ?? 0
                const isToday = selectedDay === ymd(new Date())
                if (anon > 0 && pub === 0) {
                  // Pre-archive anon plays only got the daily counter
                  // bump, never the JSONB row. New anon plays archive
                  // properly — we surface that distinction here.
                  return (
                    <div className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] font-bold text-zinc-500">
                      {anon} anonymous hand{anon === 1 ? '' : 's'} played
                      {isToday ? ' today' : ' this day'}.
                      <div className="mt-1 text-[10px] font-bold text-zinc-600">
                        Older anon hands aren't archived — newer ones will appear here.
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="rounded-md border border-dashed border-zinc-800 px-3 py-6 text-center text-[11px] font-bold text-zinc-500">
                    No hands {isToday ? 'today yet — play one to see it here.' : 'on this day.'}
                  </div>
                )
              })()}
              {hands.length > 0 && (
                <>
                  <ul className="max-h-[400px] divide-y divide-zinc-800/60 overflow-y-auto pr-1">
                    {hands.map(hand => <HandRow key={hand.id} hand={hand} />)}
                  </ul>
                  {hands.length < handsTotal && (
                    <button
                      type="button"
                      onClick={loadMoreHands}
                      disabled={handsLoadingMore}
                      className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                    >
                      {handsLoadingMore ? 'Loading…' : `Load ${Math.min(PAGE_SIZE, handsTotal - hands.length)} more`}
                    </button>
                  )}
                </>
              )}
            </div>

          {/* Edit disclosure — viewing is the common case, editing is
              behind a click. Avatar history loads only when this opens.
              The whole row is a button — wider click target than just the
              text, plus a hover state so it clearly signals "press me". */}
          <div className="border-t border-zinc-800/80 px-2 py-1">
            <button
              type="button"
              onClick={() => setEditOpen(o => !o)}
              className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-800/60"
              aria-expanded={editOpen}
            >
              <span className="flex items-center gap-2">
                <span className="text-[11px] font-black uppercase tracking-widest text-amber-200 group-hover:text-amber-100">
                  ✎ Edit profile
                </span>
                <span className="text-[11px] font-bold text-zinc-500">username · avatar · uploads</span>
              </span>
              <span className="text-[11px] font-black text-zinc-400 group-hover:text-white">
                {editOpen ? '▾' : '▸'}
              </span>
            </button>

            {editOpen && (
              <div className="space-y-3 px-3 pb-3">
                <label className="block">
                  <div className="mb-1 text-[9px] font-black uppercase tracking-widest text-zinc-500">Username</div>
                  <input
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    maxLength={32}
                    placeholder="What other players see at the table"
                    className="w-full rounded-md border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm font-bold text-white outline-none"
                  />
                </label>

                {/* Free-text bio. Showed up-top in read mode (clicking it
                    jumps here). Live character counter — turns rose when
                    near the cap so the user gets ahead of the validation
                    error rather than hitting it on save. */}
                <label className="block">
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Bio</div>
                    <div className={`text-[9px] font-bold ${description.length > DESCRIPTION_MAX - 20 ? 'text-rose-300' : 'text-zinc-500'}`}>
                      {description.length}/{DESCRIPTION_MAX}
                    </div>
                  </div>
                  <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
                    rows={3}
                    placeholder="A line or two about your poker style, your bots, anything"
                    className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950/50 px-3 py-2 text-sm font-bold text-white outline-none"
                  />
                </label>

                {/* Avatar block. Current preview on the left for reference,
                    three visually parallel input methods on the right
                    (drag/click upload, paste, URL). Saved row sits below
                    a thin divider. */}
                <div>
                  <div className="mb-2 text-[9px] font-black uppercase tracking-widest text-zinc-500">Avatar</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={onFileChosen}
                  />
                  <div className="flex items-stretch gap-3">
                    {/* Current preview — answers "what am I about to save?" */}
                    <div className="shrink-0 text-center">
                      <ProfileAvatar
                        avatarUrl={avatarUrl}
                        avatarId={null}
                        name={user.displayName}
                        nameKey={user.id || user.email}
                        size={72}
                        className="ring-2 ring-zinc-700"
                      />
                      <div className="mt-1 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Current</div>
                    </div>
                    <div className="flex-1 space-y-1.5">
                      {/* Upload — click or drag a file in. */}
                      <button
                        type="button"
                        onClick={pickFile}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={(e) => {
                          // Only reset when the pointer leaves THIS button
                          // entirely. Without the relatedTarget check the
                          // state flickers off every time the cursor
                          // crosses an inner span during the drag.
                          if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false)
                        }}
                        onDrop={onDrop}
                        disabled={uploading}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dragOver
                          ? 'border-amber-300 bg-amber-500/20'
                          : 'border-zinc-700 bg-zinc-950/40 hover:border-amber-400/60 hover:bg-amber-500/10'}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="text-base leading-none">⬆</span>
                          <span className="text-[11px] font-black uppercase tracking-widest text-amber-100">Upload</span>
                        </span>
                        <span className="text-[9px] font-bold text-zinc-500">click or drop a file</span>
                      </button>
                      {/* Paste — keyboard-only, but we surface it as a tile so
                          the keyboard hint isn't tucked into a sentence. */}
                      <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-zinc-700 bg-zinc-950/30 px-3 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className="text-base leading-none">📋</span>
                          <span className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Paste</span>
                        </span>
                        <span className="text-[9px] font-bold text-zinc-500">
                          press <kbd className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[9px] text-zinc-300">⌘V</kbd> here
                        </span>
                      </div>
                      {/* URL — input + Use button on one row, consistent
                          height with the other two tiles. */}
                      <div className="flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/40 px-2 py-1 focus-within:border-zinc-400">
                        <span className="shrink-0 text-base leading-none">🔗</span>
                        <input
                          type="url"
                          inputMode="url"
                          placeholder="paste an image URL…"
                          value={urlInput}
                          onChange={e => setUrlInput(e.target.value)}
                          disabled={urlBusy || uploading}
                          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-xs font-bold text-white outline-none placeholder:text-zinc-600"
                        />
                        <button
                          type="button"
                          onClick={submitUrl}
                          disabled={!urlInput.trim() || urlBusy || uploading}
                          className="cursor-pointer rounded-md border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-emerald-100 transition-colors hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
                        >{urlBusy ? '…' : 'Use'}</button>
                      </div>
                    </div>
                  </div>

                  {/* Saved roster — separated by a hair-line so it reads
                      as a list of alternatives, not part of the input UI. */}
                  {(pfpsLoading || pfps.length > 0) && (
                    <div className="mt-3 border-t border-zinc-800/80 pt-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                          Saved{pfps.length > 0 ? ` (${pfps.length})` : ''}
                        </div>
                        {pfps.length > 0 && (
                          <div className="text-[9px] font-bold text-zinc-600">click to pick · × to remove</div>
                        )}
                      </div>
                      {pfpsLoading && <div className="text-[10px] font-bold text-zinc-500">Loading…</div>}
                      {!pfpsLoading && pfps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {pfps.map(pfp => {
                            const isSelected = pfp.publicUrl === avatarUrl
                            return (
                              <div key={pfp.id} className="relative">
                                <button
                                  type="button"
                                  onClick={() => setAvatarUrl(pfp.publicUrl)}
                                  className={`block h-12 w-12 cursor-pointer overflow-hidden rounded-md transition-all ${isSelected ? 'ring-2 ring-amber-300' : 'ring-1 ring-zinc-700 hover:ring-amber-300/70'}`}
                                  aria-label={isSelected ? 'Current avatar' : 'Use this avatar'}
                                >
                                  <img src={pfp.publicUrl} alt="" className="block h-full w-full object-cover" loading="lazy" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deletePfp(pfp.id)}
                                  aria-label="Delete"
                                  className="absolute -right-1 -top-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-zinc-950 text-[10px] font-black text-red-300 ring-1 ring-red-400/40 transition-colors hover:bg-red-500/30 hover:text-red-100"
                                >×</button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {(uploadError || saveError) && (
                  <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] font-bold text-red-200">
                    {uploadError || saveError}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || uploading || !dirty}
                    className={`rounded-md px-3 py-1.5 text-xs font-black transition-all ${dirty
                      ? 'border border-emerald-400/60 bg-emerald-500 text-white hover:bg-emerald-400'
                      : 'border border-zinc-700 bg-zinc-900 text-zinc-500 cursor-not-allowed'}`}
                  >{saving ? 'Saving…' : saveOk ? 'Saved ✓' : dirty ? 'Save changes' : 'No changes'}</button>
                </div>
              </div>
            )}
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

      <FollowsListPopup
        direction={followsPopup}
        list={followsList}
        loading={followsLoading}
        onClose={() => setFollowsPopup(null)}
      />
    </>,
    document.body
  )
}

// Sub-popup for the followers / following lists. Rendered at the modal
// root via the same portal so it stacks above the main modal without
// fighting the parent's overflow-y-auto. Click-outside / ESC close.
function FollowsListPopup({ direction, list, loading, onClose }) {
  useEffect(() => {
    if (!direction) return
    function onKey(e) { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [direction, onClose])

  if (!direction) return null
  const title = direction === 'followers' ? 'Followers' : 'Following'
  const emptyMsg = direction === 'followers'
    ? 'No followers yet — play "as yourself" and others can find you.'
    : 'Not following anyone yet — click a seat at the table to follow people.'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="follows-popup-title"
      className="fixed inset-0 z-[310] flex items-center justify-center bg-black/55 p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900/98 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-4 py-2.5">
          <div id="follows-popup-title" className="text-[11px] font-black uppercase tracking-widest text-zinc-200">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-md px-2 py-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
          >✕</button>
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-2">
          {loading && (
            <div className="px-3 py-6 text-center text-[11px] font-bold text-zinc-500">Loading…</div>
          )}
          {!loading && list.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] font-bold text-zinc-500">{emptyMsg}</div>
          )}
          {!loading && list.length > 0 && (
            <ul className="space-y-1">
              {list.map(f => (
                <li
                  key={f.id}
                  className="flex items-center gap-2 rounded-md p-2 transition-colors hover:bg-zinc-800/60"
                >
                  <ProfileAvatar avatarUrl={f.avatarUrl} avatarId={null} name={f.displayName} nameKey={f.id} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-black text-white">{f.displayName}</div>
                    <div className="truncate text-[10px] font-bold text-zinc-500">ELO {f.elo} · {f.handsPlayed} hands</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// One-line collapsed view + expandable detail. The summary headline does
// the heavy lifting visually; chip outcome on the right tracks color.
function HandRow({ hand }) {
  const [open, setOpen] = useState(false)
  const d = hand.data || {}
  const hole = (d.hc || []).join(' ')
  const board = (d.bd || []).join(' ')
  const actions = d.a || []
  const time = new Date(hand.playedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const profitClass = hand.chipsDelta > 0 ? 'text-emerald-300' : hand.chipsDelta < 0 ? 'text-red-300' : 'text-zinc-400'
  const headlineClass = hand.won ? 'text-emerald-200' : hand.voluntarilyIn ? 'text-zinc-300' : 'text-zinc-500'
  const summary = hand.summary || (hand.won ? 'Won' : 'Hand')

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="group flex w-full cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-zinc-800/50"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[9px] text-zinc-700 transition-colors group-hover:text-zinc-400">
              {open ? '▾' : '▸'}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{time}</span>
            <span className={`truncate text-[11px] font-black ${headlineClass}`}>{summary}</span>
            {/* "Anon" pill — only the user themselves sees this row at all
                (the public-profile endpoint filters anon out). The badge
                makes it clear the hand isn't visible to anyone else. */}
            {hand.isAnonymous && (
              <span className="shrink-0 rounded bg-zinc-700/60 px-1 text-[8px] font-black uppercase tracking-wider text-zinc-300">
                Anon
              </span>
            )}
          </div>
        </div>
        <div className={`shrink-0 text-[11px] font-black ${profitClass}`}>{fmtChips(hand.chipsDelta)}</div>
      </button>
      {open && (
        <div className="mb-1 ml-1 rounded-md bg-zinc-950/40 p-2 font-mono text-[10px] text-zinc-400">
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <div>pos <b className="text-zinc-200">{d.pos || '—'}</b></div>
            <div>opp <b className="text-zinc-200">{d.o ?? '—'}</b></div>
            <div>bb <b className="text-zinc-200">{d.bb || '—'}</b></div>
            <div>pot <b className="text-zinc-200">{d.pot || '—'}</b></div>
            <div className="col-span-2">hole <b className="text-zinc-200">{hole || '—'}</b></div>
            <div className="col-span-2">board <b className="text-zinc-200">{board || '—'}</b></div>
            <div className="col-span-2">
              ELO <b className="text-zinc-200">{hand.eloBefore}</b> → <b className="text-zinc-200">{hand.eloAfter}</b>{' '}
              <span className={hand.eloDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                ({hand.eloDelta >= 0 ? '+' : ''}{hand.eloDelta})
              </span>
            </div>
          </div>
          {actions.length > 0 && (
            <div className="mt-1">
              <div className="text-zinc-600">actions</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {actions.map((a, i) => (
                  <div key={i}>
                    {expandPhase(a[0])} <span className="text-amber-200">{expandAction(a[1])}</span>{a[2] ? ` ${a[2].toLocaleString()}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function expandPhase(c) { return { p: 'preflop', f: 'flop', t: 'turn', r: 'river' }[c] || c }
function expandAction(c) { return { f: 'fold', c: 'call/check', r: 'raise', a: 'all-in', b: 'bet' }[c] || c }
