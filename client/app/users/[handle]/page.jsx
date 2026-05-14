'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import HomeBackLink from '../../components/HomeBackLink'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout.
import { ProfileAvatar } from '../../components/ProfileSelector'
import PostCard, { FormattedBody } from '../../components/PostCard'
import BotAvatar from '../../components/BotAvatar'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/useAuth'

const STATUS_LABEL = { online: 'Online', recent: 'Active recently', offline: 'Offline' }
const STATUS_COLOR = { online: 'bg-emerald-400', recent: 'bg-amber-300', offline: 'bg-zinc-600' }

function fmtChips(n) {
  const v = Number(n) || 0
  const sign = v >= 0 ? '+' : '-'
  return `${sign}$${Math.abs(v).toLocaleString()}`
}

function StatTile({ label, value, accent = 'zinc' }) {
  const tone = {
    zinc: 'text-white',
    amber: 'text-amber-200',
    emerald: 'text-emerald-300',
    rose: 'text-rose-300'
  }[accent] || 'text-white'
  return (
    <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/40 px-3 py-2 text-center">
      <div className="text-[9px] font-black uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`text-sm font-black ${tone}`}>{value}</div>
    </div>
  )
}

// UTC-anchored YYYY-MM-DD — matches user_hand_archive.played_day, which is
// stored in UTC. A 23:00-local hand otherwise reads as the wrong calendar
// day in the API and renders blank.
function todayKey() {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function UserProfilePage({ params }) {
  const { handle } = use(params)
  const { user: viewer } = useAuth()
  const [profile, setProfile] = useState(null)
  const [bots, setBots] = useState([])
  const [posts, setPosts] = useState([])
  const [hands, setHands] = useState([])
  const [handsTotal, setHandsTotal] = useState(0)
  const [handsLoading, setHandsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [followBusy, setFollowBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { user } = await api.publicUser(handle)
      setProfile(user)
      // Public hands fetch joins the bots + posts batch — same fan-out
      // pattern used elsewhere on this page. Anonymous rows are filtered
      // server-side; what comes back here is safe to render verbatim.
      setHandsLoading(true)
      const [{ bots = [] } = {}, { posts = [] } = {}, { hands = [], total = 0 } = {}] = await Promise.all([
        api.publicBotsByUser(user.id).catch(() => ({ bots: [] })),
        api.listFeed({ authorId: user.id, limit: 20 }).catch(() => ({ posts: [] })),
        api.publicHandsByUser(user.id, { day: todayKey(), limit: 20 }).catch(() => ({ hands: [], total: 0 }))
      ])
      setBots(bots)
      setPosts(posts)
      setHands(hands)
      setHandsTotal(total)
      setHandsLoading(false)
    } catch (err) {
      setError(err.detail || err.message || 'Failed to load profile')
    } finally { setLoading(false) }
  }, [handle])

  useEffect(() => { load() }, [load])

  const isSelf = !!(viewer && profile && viewer.id === profile.id)
  const winRate = useMemo(() => {
    if (!profile?.handsPlayed) return null
    return Math.round(100 * profile.handsWon / profile.handsPlayed)
  }, [profile])

  const toggleFollow = useCallback(async () => {
    if (!profile || isSelf) return
    setFollowBusy(true)
    try {
      if (profile.isFollowedByMe) {
        await api.unfollowUser(profile.id)
        setProfile(p => p ? { ...p, isFollowedByMe: false, followersCount: Math.max(0, p.followersCount - 1) } : p)
      } else {
        await api.followUser(profile.id)
        setProfile(p => p ? { ...p, isFollowedByMe: true, followersCount: p.followersCount + 1 } : p)
      }
    } catch (err) {
      setError(err.detail || err.message || 'Action failed')
    } finally { setFollowBusy(false) }
  }, [profile, isSelf])

  const onPostDeleted = (id) => setPosts(prev => prev.filter(p => p.id !== id))

  return (
    <div className="min-h-screen px-4 pb-12 pt-14 text-white sm:pt-16">
      {/* Home pinned to viewport-left mirrors the AccountDock on the
          viewport-right — symmetric chrome. */}
      <div className="fixed left-3 top-3 z-20 sm:left-4 sm:top-4">
        <HomeBackLink />
      </div>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <header className="flex items-center justify-center gap-2">
          <div className="text-[11px] font-black uppercase tracking-widest text-zinc-300">Profile</div>
        </header>

        {loading && (
          <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-6 text-center text-sm font-bold text-zinc-400">
            Loading profile…
          </div>
        )}
        {error && !profile && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-bold text-rose-200">
            {error}
          </div>
        )}

        {profile && (
          <>
            {/* Identity card */}
            <section className="rounded-xl border border-zinc-700/70 bg-zinc-900/60 p-4">
              <div className="flex items-start gap-4">
                <div className="relative shrink-0">
                  <ProfileAvatar
                    avatarUrl={profile.avatarUrl}
                    name={profile.displayName || profile.username}
                    nameKey={profile.id}
                    size={64}
                  />
                  {profile.status && (
                    <span
                      className={`absolute -right-0.5 -bottom-0.5 inline-block h-3.5 w-3.5 rounded-full ring-2 ring-zinc-900 ${STATUS_COLOR[profile.status] || STATUS_COLOR.offline}`}
                      title={STATUS_LABEL[profile.status]}
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <div className="truncate text-lg font-black text-white">{profile.displayName || profile.username || 'Player'}</div>
                  </div>
                  {profile.username && (
                    <div className="text-[12px] font-bold text-zinc-400">@{profile.username}</div>
                  )}
                  {profile.status && (
                    <div className="mt-0.5 text-[11px] font-bold text-zinc-500">
                      {STATUS_LABEL[profile.status]}
                    </div>
                  )}
                </div>
                {!isSelf && (
                  <button
                    type="button"
                    onClick={toggleFollow}
                    disabled={followBusy || !viewer}
                    title={!viewer ? 'Sign in to follow' : ''}
                    className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-50 ${
                      profile.isFollowedByMe
                        ? 'border-zinc-500/50 bg-zinc-800 text-white hover:bg-zinc-700'
                        : 'border-amber-400/60 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'
                    }`}
                  >
                    {followBusy ? '…' : profile.isFollowedByMe ? 'Following ✓' : '+ Follow'}
                  </button>
                )}
              </div>

              {profile.description && (
                <div className="mt-3 whitespace-pre-wrap text-[13px] font-bold leading-snug text-zinc-200">
                  <FormattedBody text={profile.description} />
                </div>
              )}

              {/* Stats row */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="ELO" value={profile.elo} accent="amber" />
                <StatTile label="Hands" value={profile.handsPlayed?.toLocaleString() ?? 0} />
                <StatTile label="Win%" value={winRate == null ? '—' : `${winRate}%`} />
                <StatTile
                  label="Luck"
                  value={`${profile.luckScore ?? 5}/10`}
                  accent={(profile.luckScore ?? 5) >= 7 ? 'emerald' : (profile.luckScore ?? 5) <= 3 ? 'rose' : 'zinc'}
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatTile label="Followers" value={profile.followersCount ?? 0} />
                <StatTile label="Following" value={profile.followingCount ?? 0} />
                <StatTile label="Side bets won" value={profile.sideBetsWon ?? 0} />
                <StatTile
                  label="Side bets P/L"
                  value={fmtChips(profile.sideBetChipPl ?? 0)}
                  accent={(profile.sideBetChipPl ?? 0) >= 0 ? 'emerald' : 'rose'}
                />
              </div>
            </section>

            {/* Public bots */}
            {bots.length > 0 && (
              <section className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
                  Public bots · {bots.length}
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {bots.map(b => (
                    <Link
                      key={b.id}
                      href={`/poker/bots/${b.id}`}
                      className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-2 py-1.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900"
                    >
                      <BotAvatar
                        name={b.name}
                        color={b.color || '#3b82f6'}
                        textColor={b.textColor || 'auto'}
                        avatarUrl={b.avatarUrl}
                        size={28}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-black text-white">{b.name}</div>
                        <div className="truncate text-[9px] font-bold text-zinc-400">
                          ELO {b.elo} · {b.stats?.handsPlayed ?? 0} hands
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Hands today — public only. Anonymous plays are filtered out
                server-side, so the visitor sees nothing about hands the
                user opted to keep private. Self viewers should use the
                ProfileModal (account menu) for the full anon-aware view. */}
            {(hands.length > 0 || handsLoading) && (
              <section className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
                    Hands today · {hands.length}{handsTotal > hands.length ? ` of ${handsTotal}` : ''}
                  </div>
                  {isSelf && (
                    <div className="text-[9px] font-bold text-zinc-500">Public only · open profile for anon</div>
                  )}
                </div>
                {handsLoading && hands.length === 0 ? (
                  <div className="text-[11px] font-bold text-zinc-500">Loading…</div>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {hands.map(h => {
                      const time = new Date(h.playedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                      const cls = h.chipsDelta > 0 ? 'text-emerald-300' : h.chipsDelta < 0 ? 'text-red-300' : 'text-zinc-400'
                      return (
                        <li key={h.id} className="flex items-center justify-between gap-2 rounded px-1 py-1 hover:bg-zinc-800/40">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="shrink-0 font-mono text-[10px] text-zinc-600">{time}</span>
                            <span className={`truncate text-[11px] font-black ${h.won ? 'text-emerald-200' : h.voluntarilyIn ? 'text-zinc-300' : 'text-zinc-500'}`}>
                              {h.summary || (h.won ? 'Won' : 'Hand')}
                            </span>
                          </div>
                          <div className={`shrink-0 text-[11px] font-black ${cls}`}>
                            {h.chipsDelta > 0 ? '+' : h.chipsDelta < 0 ? '−' : ''}${Math.abs(h.chipsDelta || 0).toLocaleString()}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )}

            {/* Posts */}
            <section className="flex flex-col gap-3">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">
                Posts · {posts.length}{posts.length === 20 ? '+' : ''}
              </div>
              {posts.length === 0 ? (
                <div className="rounded-xl border border-zinc-700/70 bg-zinc-900/40 p-4 text-center text-[12px] font-bold text-zinc-500">
                  {isSelf ? 'You haven\'t posted yet.' : `${profile.displayName || profile.username || 'This user'} hasn\'t posted yet.`}
                </div>
              ) : posts.map(p => (
                <PostCard key={p.id} post={p} viewerId={viewer?.id} onDeleted={onPostDeleted} />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
