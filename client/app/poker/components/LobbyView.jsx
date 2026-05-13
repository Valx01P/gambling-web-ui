'use client'

import Link from 'next/link'
import HomeBackLink from '../../components/HomeBackLink'
import RouteNavCluster from '../../components/RouteNavCluster'
// AccountMenu (profile + DMs + notifications) is mounted globally via
// AccountDock in the root layout, so the lobby's local nav only owns
// the back link and the Bots link. RouteNavCluster makes the right-
// offset auth-reactive so the cluster snugs up to the avatar when
// signed in (instead of leaving a ~50px dead gap).
import AuthGateModal from '../../components/AuthGateModal'
import ProfileSelector, { ProfileAvatar } from '../../components/ProfileSelector'

// Pre-game lobby. Renders three tabs (General / Private / Spectate) and the
// bot arena entry from inside the spectate panel. Owns no WS state — every
// network call is delegated to the parent via the `send` callback. Keeping
// it self-contained means PokerPage doesn't have to wade through ~160 lines
// of lobby chrome, and a future redesign of the lobby UI doesn't touch the
// in-game flow.
export default function LobbyView({
  connected,
  joinMode,
  setJoinMode,
  inputCode,
  setInputCode,
  username,
  persistUsername,
  selectedAvatarId,
  selectAvatar,
  tableList,
  authUser,
  authGateMessage,
  setAuthGateMessage,
  playMode = 'self',
  setPlayMode,
  send,
  joinPayload,
  // tryJoin commits any staged avatar blob to S3, then sends join_game.
  // Every join button must go through it (not send directly) so the
  // deferred-upload flow stays correct.
  tryJoin,
  joinBusy = false,
  joinError = null,
  // Receives (blob, localUrl) from ProfileSelector's cropper. Parent
  // stashes the blob; selectAvatar(localUrl) follows.
  onPendingAvatar,
  // Most-recent saved PFPs (up to 5, server-capped). Signed-in users in
  // anon mode see them as a one-tap re-pick strip inside the selector.
  recentPfps = [],
}) {
  // Signed-out users always join as anonymous — there's no "self" to play
  // as. Force the toggle accordingly to keep the rest of the UI simple.
  const effectivePlayMode = authUser ? playMode : 'anon'
  const playingAsSelf = effectivePlayMode === 'self'

  // Centralized button label. While we're uploading the staged avatar we
  // show "Uploading…" so the user understands the click registered and
  // they should wait, not retry.
  const findTableLabel = joinBusy ? 'Uploading…' : 'Find Table'
  return (
    // `justify-center` used to be applied here, but it pushed the
    // content's top edge above the viewport whenever the stacked content
    // (Connected pill + tabs + cards + ProfileSelector carousel + room
    // CTAs) was taller than the viewport — which is most laptops. The
    // result was the carousel and PLAY-AS-YOU cards bleeding through the
    // top nav. Switching to top-anchored layout with `pt-16 sm:pt-20`
    // for nav clearance + `my-auto` on the inner stack keeps the content
    // visually centered when there's headroom and lets the page scroll
    // when there isn't.
    <div className="min-h-[100dvh] flex flex-col items-center px-4 pt-16 pb-8 sm:pt-20">
      {/* Lobby-local nav. RouteNavCluster picks the right-offset
          based on dock state (wide chip vs narrow avatar). */}
      <RouteNavCluster>
        <HomeBackLink />
        <Link
          href="/poker/bots"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          Bots
        </Link>
      </RouteNavCluster>

      {/* `my-auto` centers the content stack within the available
          vertical space when the viewport has headroom, but yields
          gracefully (no negative margin) when the stack exceeds the
          viewport — the page just scrolls naturally then. `gap-5` is a
          touch tighter than the old `gap-6` to claw back vertical space
          on shorter screens. */}
      <div className="flex flex-col items-center gap-5 w-full max-w-[620px] my-auto">
        <div className={`text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
          {connected ? '● Connected' : '○ Connecting...'}
        </div>

        <div className="grid grid-cols-3 w-full bg-zinc-800/80 p-2 gap-2 rounded-xl border border-zinc-600/50 shadow-md">
          <button onClick={() => setJoinMode('general')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'general' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>General</button>
          <button onClick={() => setJoinMode('private')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Private</button>
          <button onClick={() => setJoinMode('spectate')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'spectate' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Spectate</button>
        </div>

        {/* Signed-in users get an explicit "self vs anonymous" choice.
            'Play as YOU' locks the username + avatar to their saved
            profile so other players see their real handle. 'Play
            anonymously' shows the free-text username + ProfileSelector
            (preset or custom upload) for a session-only identity. */}
        {authUser && joinMode !== 'spectate' && (
          <div className="grid grid-cols-2 gap-3 w-full">
            <button
              type="button"
              onClick={() => setPlayMode?.('self')}
              className={`rounded-xl border p-3 text-left transition-all ${
                playingAsSelf
                  ? 'border-emerald-400/70 bg-emerald-500/15 shadow-lg'
                  : 'border-zinc-600/50 bg-zinc-800/80 hover:bg-zinc-700/60'
              }`}
              aria-pressed={playingAsSelf}
            >
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  avatarUrl={authUser.avatarUrl}
                  name={authUser.displayName}
                  nameKey={authUser.id || authUser.email}
                  size={44}
                  className={playingAsSelf ? 'ring-2 ring-emerald-300' : ''}
                />
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-emerald-200">Play as YOU</div>
                  <div className="truncate text-sm font-black text-white">{authUser.displayName || 'You'}</div>
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setPlayMode?.('anon')}
              className={`rounded-xl border p-3 text-left transition-all ${
                !playingAsSelf
                  ? 'border-amber-400/70 bg-amber-500/10 shadow-lg'
                  : 'border-zinc-600/50 bg-zinc-800/80 hover:bg-zinc-700/60'
              }`}
              aria-pressed={!playingAsSelf}
            >
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-dashed border-amber-400/60 text-lg" aria-hidden="true">🎭</div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-200">Anonymous</div>
                  <div className="truncate text-sm font-black text-white">Pick a name + avatar</div>
                </div>
              </div>
            </button>
          </div>
        )}

        {/* ProfileSelector only renders for the anon path. Playing as
            yourself shows a tiny edit-profile hint instead — the avatar
            and username come from your saved profile, edited via the
            AccountMenu's Profile dialog. */}
        {(joinMode === 'general' || joinMode === 'private') && !playingAsSelf && (
          <ProfileSelector
            value={selectedAvatarId}
            onChange={selectAvatar}
            onPendingFile={onPendingAvatar}
            recentPfps={recentPfps}
          />
        )}

        {joinMode !== 'spectate' && !playingAsSelf && (
          // Card-wrapped input matching the visual treatment of the
          // "Have a code? Join one" / "Create a private room" cards
          // below — the bordered panel + heading make it read as a
          // labelled action instead of a stray text field.
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-4 shadow-lg">
            <div className="mb-2 text-sm font-black text-white">Your name</div>
            <input
              className="w-full bg-zinc-900/90 border border-zinc-500/50 rounded-lg px-4 py-3 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-sm"
              placeholder="Username (optional)"
              value={username}
              onChange={e => persistUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && connected && joinMode === 'general' && !joinBusy && tryJoin('general')}
            />
          </div>
        )}

        {joinMode !== 'spectate' && playingAsSelf && (
          <div className="w-full rounded-xl border border-zinc-700/70 bg-zinc-950/40 px-4 py-3 text-center text-[11px] font-bold text-zinc-400">
            You'll join as <span className="text-white">{authUser.displayName}</span>.
            Change your username or avatar from your <span className="text-emerald-200">avatar menu</span> in the top right.
          </div>
        )}

        {joinError && (
          <div className="w-full rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200">
            {joinError}
          </div>
        )}

        {joinMode === 'general' && (
          <button
            onClick={() => tryJoin('general')}
            disabled={!connected || joinBusy}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-4 rounded-xl text-base font-bold text-white transition-colors border border-zinc-500/50 shadow-lg"
          >
            {findTableLabel}
          </button>
        )}

        {joinMode === 'private' && (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-4 shadow-lg space-y-4">
            <div>
              <div className="mb-2 text-sm font-black text-white">Create a private room</div>
              <button
                type="button"
                onClick={() => tryJoin('create_private')}
                disabled={!connected || joinBusy}
                className="w-full rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3 text-sm font-black text-white border border-zinc-500/50"
              >
                {joinBusy ? 'Uploading…' : 'Create Private Room'}
              </button>
            </div>
            <div className="border-t border-zinc-700/70 pt-4">
              <div className="mb-2 text-sm font-black text-white">Have a code? Join one</div>
              <input
                className="w-full bg-zinc-900/90 border border-zinc-500/50 rounded-lg px-4 py-3 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center uppercase tracking-widest font-black"
                placeholder="5-LETTER CODE"
                maxLength={5}
                value={inputCode}
                onChange={e => setInputCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && connected && inputCode.length === 5 && !joinBusy && tryJoin('join_private', { code: inputCode })}
              />
              <button
                type="button"
                onClick={() => tryJoin('join_private', { code: inputCode })}
                disabled={!connected || inputCode.length !== 5 || joinBusy}
                className="mt-2 w-full rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3 text-sm font-black text-white border border-zinc-500/50"
              >
                {joinBusy ? 'Uploading…' : 'Join Private Room'}
              </button>
            </div>
          </div>
        )}

        {joinMode === 'spectate' && (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-black text-white">Live Tables & Arenas</div>
                <div className="text-xs font-bold text-zinc-500">Watch any open table or bot arena.</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!authUser) { setAuthGateMessage('Sign in to create a Bot Arena.'); return }
                    tryJoin('bot_arena')
                  }}
                  disabled={!connected || joinBusy}
                  className="rounded-md border border-emerald-500/50 bg-emerald-600/20 px-3 py-1.5 text-xs font-black text-emerald-100 transition-colors hover:bg-emerald-600/30 disabled:opacity-50"
                  title={authUser ? 'Create a fresh bot-vs-bot arena' : 'Sign in to create a Bot Arena'}
                >
                  + Bot Arena
                </button>
                <button
                  type="button"
                  onClick={() => send('list_tables')}
                  disabled={!connected}
                  className="rounded-md border border-zinc-500/50 bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-600 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {tableList.map((table) => (
                <div key={table.roomId} className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-white">
                        {table.isArena
                          ? `Arena ${table.roomId.replace('arena_', '#')}`
                          : `Table ${table.roomId.replace('poker_', '#')}`}
                      </div>
                      <div className="truncate text-[10px] font-bold text-zinc-500">
                        {table.isArena
                          ? `BOT ARENA · ${table.arenaRunning ? 'LIVE' : 'PAUSED'} · ${table.playerCount} bots · ${table.spectatorCount} watching`
                          : `${table.phase?.toUpperCase()} - ${table.playerCount}/${table.maxPlayers} seated - ${table.spectatorCount} watching`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => tryJoin('spectate', { roomId: table.roomId })}
                      disabled={!connected || joinBusy}
                      className={`shrink-0 rounded-md px-3 py-2 text-xs font-black transition-colors disabled:opacity-50 ${table.isArena ? 'border border-emerald-400/50 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25' : 'border border-amber-400/50 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25'}`}
                    >
                      Watch
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {table.players.slice(0, 5).map((player) => (
                      <span key={player.id} className="rounded-md bg-zinc-800 px-2 py-1 text-[10px] font-bold text-zinc-300">
                        {player.username}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {tableList.length === 0 && (
                <div className="rounded-lg border border-zinc-700/70 bg-zinc-950/35 px-3 py-6 text-center text-xs font-bold text-zinc-500">
                  No live tables or arenas yet.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <AuthGateModal
        open={!!authGateMessage}
        message={authGateMessage}
        onClose={() => setAuthGateMessage(null)}
      />
    </div>
  )
}
