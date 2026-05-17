// Daily-challenge trophy ladder. Each tier unlocks at a `min` count of
// lifetime daily challenges completed. Used by:
//   • DailyChallengePanel — shows the current trophy + the next milestone
//   • PlayerProfilePopover — renders the trophy badge on a player's
//     public profile (so the upgrade is visible to everyone)
//
// The ladder matches the historical skin-unlock milestones
// (1/5/10/15/20/25/30/35/40/50) so people who'd been grinding before the
// trophy system existed land on the right tier the moment they next open
// the panel.
export const TROPHY_TIERS = [
  { min: 1,  name: 'Bronze',      emoji: '🥉', color: '#cd7f32', ring: 'ring-amber-700/70'  },
  { min: 5,  name: 'Silver',      emoji: '🥈', color: '#cbd5e1', ring: 'ring-slate-300/70'  },
  { min: 10, name: 'Gold',        emoji: '🥇', color: '#facc15', ring: 'ring-yellow-300/70' },
  { min: 15, name: 'Sapphire',    emoji: '🏆', color: '#60a5fa', ring: 'ring-blue-400/70'   },
  { min: 20, name: 'Emerald',     emoji: '🏆', color: '#34d399', ring: 'ring-emerald-400/70'},
  { min: 25, name: 'Ruby',        emoji: '🏆', color: '#f87171', ring: 'ring-red-400/70'    },
  { min: 30, name: 'Diamond',     emoji: '💎', color: '#67e8f9', ring: 'ring-cyan-300/70'   },
  { min: 35, name: 'Master',      emoji: '👑', color: '#c084fc', ring: 'ring-purple-400/70' },
  { min: 40, name: 'Grandmaster', emoji: '👑', color: '#fb923c', ring: 'ring-orange-400/70' },
  { min: 50, name: 'Legend',      emoji: '🌟', color: '#fde047', ring: 'ring-yellow-200/80' },
]

// Returns { current, next } given a lifetime daily-completion count.
//   current = highest tier reached so far (null if none)
//   next    = next tier to unlock (null if at the top)
export function getTrophyTier(dailiesCompleted) {
  const n = Number(dailiesCompleted) || 0
  let current = null
  let nextIdx = 0
  for (let i = 0; i < TROPHY_TIERS.length; i++) {
    if (n >= TROPHY_TIERS[i].min) {
      current = TROPHY_TIERS[i]
      nextIdx = i + 1
    }
  }
  const next = TROPHY_TIERS[nextIdx] || null
  return { current, next }
}
