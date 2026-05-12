// Player-nameplate skins. The default (id 0) is the existing dark zinc
// look — players see it until they complete their first daily. Each
// subsequent slot unlocks at the count shown in unlocksAt. Slot 10 is
// the "customize it yourself" picker (see SkinSelector.jsx).
//
// `css` is a value that goes straight into `background:` on the nameplate
// — solid color or linear-gradient. Keep readable contrast against white
// text — these all do.

export const SKIN_PRESETS = [
  { id: 0,  unlocksAt: 0,
    label: 'Default',
    css: 'rgba(39, 39, 42, 0.95)' /* zinc-800/95 — matches the original */,
  },
  { id: 1,  unlocksAt: 1,
    label: 'Crimson',
    css: 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)',
  },
  { id: 2,  unlocksAt: 5,
    label: 'Ocean',
    css: 'linear-gradient(135deg, #0c4a6e 0%, #0369a1 100%)',
  },
  { id: 3,  unlocksAt: 10,
    label: 'Forest',
    css: 'linear-gradient(135deg, #14532d 0%, #166534 100%)',
  },
  { id: 4,  unlocksAt: 15,
    label: 'Royal',
    css: 'linear-gradient(135deg, #4c1d95 0%, #6d28d9 100%)',
  },
  { id: 5,  unlocksAt: 20,
    label: 'Sunset',
    css: 'linear-gradient(135deg, #9a3412 0%, #ea580c 100%)',
  },
  { id: 6,  unlocksAt: 25,
    label: 'Gold',
    css: 'linear-gradient(135deg, #78350f 0%, #b45309 100%)',
  },
  { id: 7,  unlocksAt: 30,
    label: 'Aurora',
    css: 'linear-gradient(135deg, #155e75 0%, #c026d3 100%)',
  },
  { id: 8,  unlocksAt: 35,
    label: 'Ash',
    css: 'linear-gradient(135deg, #1f2937 0%, #4b5563 100%)',
  },
  { id: 9,  unlocksAt: 40,
    label: 'Neon',
    css: 'linear-gradient(135deg, #be185d 0%, #4338ca 100%)',
  },
  { id: 10, unlocksAt: 50,
    label: 'Custom',
    css: null,   // resolved at render-time from the user's saved customSkin
  },
]

// Convert a {colors:[...], direction:'...'} payload into a CSS background.
// Defensive: always returns a usable string; on bad input falls back to
// the default skin so the nameplate never disappears.
export function customSkinCss(custom) {
  if (!custom || !Array.isArray(custom.colors) || custom.colors.length < 2) {
    return SKIN_PRESETS[0].css
  }
  const dir = typeof custom.direction === 'string' ? custom.direction : 'to right'
  const colors = custom.colors.slice(0, 3).join(', ')
  return `linear-gradient(${dir}, ${colors})`
}

export function resolveSkinCss(skinId, customSkin) {
  if (skinId === 10) return customSkinCss(customSkin)
  const preset = SKIN_PRESETS.find(s => s.id === skinId) || SKIN_PRESETS[0]
  return preset.css || SKIN_PRESETS[0].css
}

export function isUnlocked(skinId, lifetimeDailies) {
  const preset = SKIN_PRESETS.find(s => s.id === skinId)
  if (!preset) return false
  return (lifetimeDailies || 0) >= preset.unlocksAt
}
