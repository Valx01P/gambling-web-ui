export const BOT_COLOR_PRESETS = [
  { name: 'red',     hex: '#ef4444' },
  { name: 'orange',  hex: '#f97316' },
  { name: 'amber',   hex: '#f59e0b' },
  { name: 'yellow',  hex: '#eab308' },
  { name: 'lime',    hex: '#84cc16' },
  { name: 'green',   hex: '#22c55e' },
  { name: 'emerald', hex: '#10b981' },
  { name: 'teal',    hex: '#14b8a6' },
  { name: 'cyan',    hex: '#06b6d4' },
  { name: 'sky',     hex: '#0ea5e9' },
  { name: 'blue',    hex: '#3b82f6' },
  { name: 'indigo',  hex: '#6366f1' },
  { name: 'violet',  hex: '#8b5cf6' },
  { name: 'purple',  hex: '#a855f7' },
  { name: 'fuchsia', hex: '#d946ef' },
  { name: 'pink',    hex: '#ec4899' },
  { name: 'rose',    hex: '#f43f5e' },
  { name: 'slate',   hex: '#64748b' }
]

export function isValidHex(hex) {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)
}
