'use client'

import { ProfileAvatar } from '../../components/ProfileSelector'
import BotAvatar from '../../components/BotAvatar'
import { isMlpFamily, mlpArchLabel, nonMlpNeuralLabel } from '../lib/botCategories'

// Compact selectable pill — used by the training simulator picker,
// the Add Bots tool, and the bot-arena lineup picker. Same visual in
// all three so users learn one selection pattern.
//
// `selected` flips the color to the emerald "selected" palette. The
// pill stays click-to-toggle; the disabled state mutes it (lower
// opacity + cursor) for over-cap or unavailable rows.
export default function BotPill({
  bot,
  selected,
  disabled,
  onToggle,
  ownerLabel,
  avatarSize = 20,
  // useBotAvatar=true renders the BotAvatar (used inside the poker
  // table where bots have color+initials only). useBotAvatar=false
  // (default) renders ProfileAvatar (used in the training picker
  // which prefers uploaded avatar URLs).
  useBotAvatar = false,
}) {
  const mlp = isMlpFamily(bot)
  const Avatar = useBotAvatar ? (
    <BotAvatar name={bot.name} color={bot.color} textColor={bot.textColor} avatarUrl={bot.avatarUrl} size={avatarSize} />
  ) : (
    <ProfileAvatar
      avatarUrl={bot.avatarUrl}
      name={bot.name}
      nameKey={bot.id}
      size={avatarSize}
    />
  )
  return (
    <button
      type="button"
      onClick={() => onToggle?.(bot)}
      disabled={disabled}
      title={`${bot.name} · ELO ${bot.elo ?? '—'}${ownerLabel ? ` · ${ownerLabel}` : ''}`}
      className={`flex items-center gap-2 rounded-full border px-2 py-1 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/25'
          : 'border-zinc-600/60 bg-zinc-800/80 text-zinc-200 hover:bg-zinc-700/80'
      }`}
    >
      {Avatar}
      <span className="max-w-[14ch] truncate">{bot.name}</span>
      <span className="text-[10px] text-zinc-400">{bot.elo ?? '—'}</span>
      {mlp && (
        <span className="rounded bg-purple-500/25 px-1 text-[9px] font-black uppercase tracking-wider text-purple-100">
          {mlpArchLabel(bot.neuralKind)}
        </span>
      )}
      {bot.isNeural && !mlp && (
        <span className="rounded bg-cyan-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-cyan-200">
          {nonMlpNeuralLabel(bot.neuralKind)}
        </span>
      )}
      {bot.isClone && (
        <span className="rounded bg-fuchsia-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-fuchsia-200">Clone</span>
      )}
      {bot.isSuper && (
        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-black uppercase tracking-wider text-amber-200">Super</span>
      )}
      {bot.isOracle && (
        <span className="rounded bg-fuchsia-500/30 px-1 text-[9px] font-black uppercase tracking-wider text-fuchsia-100">★ Oracle</span>
      )}
    </button>
  )
}
