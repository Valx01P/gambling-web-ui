'use client'

import Link from 'next/link'
import HomeBackLink from '../../components/HomeBackLink'
import AccountMenu from '../../components/AccountMenu'
import AuthGateModal from '../../components/AuthGateModal'
import ProfileSelector from '../../components/ProfileSelector'

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
  send,
  joinPayload,
}) {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <HomeBackLink />
        <Link
          href="/poker/bots"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-500/50 bg-zinc-800/80 px-2.5 py-1.5 text-xs font-black text-white shadow-sm transition-colors hover:bg-zinc-700/90 active:scale-95 sm:px-3 sm:text-sm"
        >
          Bots
        </Link>
        <AccountMenu />
      </div>

      <div className="flex flex-col items-center gap-6 w-full max-w-[620px]">
        <div className={`text-sm sm:text-base px-6 py-2.5 rounded-full font-bold shadow-sm ${connected ? 'bg-emerald-800/80 text-emerald-100 border border-emerald-600/50' : 'bg-red-800/80 text-red-100 border border-red-600/50'}`}>
          {connected ? '● Connected' : '○ Connecting...'}
        </div>

        <div className="grid grid-cols-3 w-full bg-zinc-800/80 p-2 gap-2 rounded-xl border border-zinc-600/50 shadow-md">
          <button onClick={() => setJoinMode('general')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'general' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>General</button>
          <button onClick={() => setJoinMode('private')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'private' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Private</button>
          <button onClick={() => setJoinMode('spectate')} className={`min-h-12 px-3 py-3 rounded-lg text-sm font-bold leading-tight transition-all ${joinMode === 'spectate' ? 'bg-zinc-600 text-white shadow-sm' : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'}`}>Spectate</button>
        </div>

        {(joinMode === 'general' || joinMode === 'private') && (
          <ProfileSelector value={selectedAvatarId} onChange={selectAvatar} />
        )}

        {joinMode !== 'spectate' && (
          <input
            className="w-full bg-zinc-800/90 border border-zinc-500/50 rounded-xl px-5 py-4 text-base text-white placeholder-zinc-400 outline-none focus:border-zinc-300 text-center shadow-lg"
            placeholder="Username (optional)"
            value={username}
            onChange={e => persistUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && connected && joinMode === 'general' && send('join_game', joinPayload('general'))}
          />
        )}

        {joinMode === 'general' && (
          <button
            onClick={() => send('join_game', joinPayload('general'))}
            disabled={!connected}
            className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-4 rounded-xl text-base font-bold text-white transition-colors border border-zinc-500/50 shadow-lg"
          >
            Find Table
          </button>
        )}

        {joinMode === 'private' && (
          <div className="w-full rounded-xl border border-zinc-600/50 bg-zinc-800/90 p-4 shadow-lg space-y-4">
            <div>
              <div className="mb-2 text-sm font-black text-white">Create a private room</div>
              <button
                type="button"
                onClick={() => send('join_game', joinPayload('create_private'))}
                disabled={!connected}
                className="w-full rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3 text-sm font-black text-white border border-zinc-500/50"
              >
                Create Private Room
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
                onKeyDown={e => e.key === 'Enter' && connected && inputCode.length === 5 && send('join_game', joinPayload('join_private', { code: inputCode }))}
              />
              <button
                type="button"
                onClick={() => send('join_game', joinPayload('join_private', { code: inputCode }))}
                disabled={!connected || inputCode.length !== 5}
                className="mt-2 w-full rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 py-3 text-sm font-black text-white border border-zinc-500/50"
              >
                Join Private Room
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
                    send('join_game', joinPayload('bot_arena'))
                  }}
                  disabled={!connected}
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
                      onClick={() => send('join_game', joinPayload('spectate', { roomId: table.roomId }))}
                      disabled={!connected}
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
