'use client'

// Web Audio synthesized slot-reel sound. No asset file — we generate
// the whole thing at runtime so there's nothing to bundle, license,
// version, or fetch over the wire, and the schedule is perfectly
// matched to the visual reel deceleration.
//
// Sound design: three bell dings, one per reel landing. The bells
// ascend C5 → E5 → G5 (a major triad) across the three reels — every
// successive reel sounds higher, which is the universal casino
// anticipation cue (the player's brain hears "good news pending"
// even before parsing the symbols). Nothing else: no spin-start
// kick, no whir, no tick train, no sparkle. Just the three landings.
//
// Browser autoplay note: AudioContext starts in 'suspended' state in
// most browsers until a user gesture. Every call site here is gated
// by a button click (Spin / Auto), so the gesture is satisfied — we
// just need to call ctx.resume() once on first use. The module-level
// singleton keeps that one-time cost contained.

let _ctx = null
function getCtx() {
  if (typeof window === 'undefined') return null
  if (_ctx) return _ctx
  const C = window.AudioContext || window.webkitAudioContext
  if (!C) return null
  try { _ctx = new C() } catch { _ctx = null }
  return _ctx
}

// FM bell — carrier + modulator at a 3.5:1 ratio gives inharmonic
// partials that read as "bell" rather than "flute" (integer ratios
// produce pure tones; 3.5 is deliberately off-integer for the
// bell-like clang). Decay envelope tapers to near-silence over
// `decay` seconds; a 6ms linear attack gives the percussive front
// edge without a click.
function playBell(ctx, t, freq, gainVal, decay = 0.15) {
  const carrier = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modGain = ctx.createGain()
  const g = ctx.createGain()

  carrier.type = 'sine'
  carrier.frequency.setValueAtTime(freq, t)
  modulator.type = 'sine'
  modulator.frequency.setValueAtTime(freq * 3.5, t)
  // Modulation depth starts wide for the "clang" attack and decays to
  // near-zero by the end so the tail rings as a pure sine.
  modGain.gain.setValueAtTime(freq * 2.2, t)
  modGain.gain.exponentialRampToValueAtTime(0.01, t + decay)

  modulator.connect(modGain).connect(carrier.frequency)
  carrier.connect(g).connect(ctx.destination)

  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gainVal, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)

  modulator.start(t)
  modulator.stop(t + decay + 0.05)
  carrier.start(t)
  carrier.stop(t + decay + 0.05)
}

// Bright bell — same FM topology as playBell but pitched in the mid
// register (C5+) and with a slightly tighter modulation depth so the
// win chime cuts through the sub-bass landing bells without sounding
// muddy when both overlap.
function playBrightBell(ctx, t, freq, gainVal, decay = 0.45) {
  const carrier = ctx.createOscillator()
  const modulator = ctx.createOscillator()
  const modGain = ctx.createGain()
  const g = ctx.createGain()

  carrier.type = 'sine'
  carrier.frequency.setValueAtTime(freq, t)
  modulator.type = 'sine'
  modulator.frequency.setValueAtTime(freq * 2.8, t)
  modGain.gain.setValueAtTime(freq * 1.6, t)
  modGain.gain.exponentialRampToValueAtTime(0.01, t + decay)

  modulator.connect(modGain).connect(carrier.frequency)
  carrier.connect(g).connect(ctx.destination)

  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gainVal, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay)

  modulator.start(t)
  modulator.stop(t + decay + 0.05)
  carrier.start(t)
  carrier.stop(t + decay + 0.05)
}

// Win chime — fires ~150ms after the last reel bell so the celebratory
// arpeggio sits cleanly on top of the spin landing instead of stepping
// on it. The note set + length scale with the win tier so a 0.5x cherry
// consolation (which isn't profit and won't trigger this) wouldn't have
// played anyway, a 3x match plays a quick 3-note arpeggio, and a 4000x
// seven jackpot plays a fuller cascade with a sustained final note.
//
// Tiers map to the payout multiple (payout / bet):
//   ≥100x  — "huge": 4-note arpeggio C5-E5-G5-C6 + sustained C6
//   ≥10x   — "big":  3-note arpeggio C5-E5-G5
//   default — "small": 2 notes E5-G5 (still feels rewarding for a 3x)
function scheduleWinChime(ctx, startSec, multiple, masterVol) {
  const C5 = 700, E5 = 790, G5 = 920, C6 = 1300
  let notes
  let noteSpacing = 0.09
  let lastDecay = 0.45
  let lastSustainNote = null
  if (multiple >= 100) {
    notes = [C5, E5, G5, C6]
    noteSpacing = 0.08
    lastDecay = 0.7
    lastSustainNote = { freq: C6, time: 0.45, decay: 1.1, gain: masterVol * 0.45 }
  } else if (multiple >= 10) {
    notes = [C5, E5, G5]
  } else {
    notes = [E5, G5]
    noteSpacing = 0.1
  }
  notes.forEach((freq, i) => {
    const decay = i === notes.length - 1 ? lastDecay : 0.32
    playBrightBell(ctx, startSec + i * noteSpacing, freq, masterVol * 0.5, decay)
  })
  if (lastSustainNote) {
    playBrightBell(
      ctx,
      startSec + lastSustainNote.time,
      lastSustainNote.freq,
      lastSustainNote.gain,
      lastSustainNote.decay,
    )
  }
}

// Ascending major-triad bells for the three reel landings.
// C4 / E4 / G4 = ascending major triad in the warm middle register
// — the classic casino "anticipation rising" gesture without the
// tinkly high-end of the C5 octave it was at before. Order is
// fixed; the visual stagger (reelDelaysMs) determines WHEN each
// bell fires, not which pitch.
const REEL_BELL_FREQS = [50, 60, 70]

// Quick percussive click for rapid-fire spins. ~30ms sine pulse at
// 600Hz — short enough that even at 10 spins/sec it reads as discrete
// "tick … tick … tick" feedback rather than a continuous buzz. Used
// only in rapid mode; normal/turbo spins still get the full bell train.
function playRapidClick(ctx, t, gainVal) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(600, t)
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gainVal, t + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.04)
}

// Public entry — called once per spin from SlotsTab's spinId effect.
// `reelDelaysMs` and `baseDurationMs` mirror the values driving the
// visual transition so the audio and animation can never drift; each
// bell fires the moment its reel comes to rest. If `payout > bet`
// (net profit), a tiered celebratory chime fires ~150ms after the
// last reel bell.
//
// `rapid` mode is for spam-click / hold-Space play: the user is
// firing spins faster than a normal animation can settle. We skip
// the 3-bell ascending landing train (which would pile on top of
// itself at 10 spins/sec and turn into noise) in favor of a single
// short click — but we ALWAYS play the win chime if there's profit,
// because that's the whole point of letting the player spam (they
// want to find a win, even at the cost of audio fidelity).
export function playSlotSpin({
  baseDurationMs,
  reelDelaysMs,
  masterVol = 0.5,
  bet = 0,
  payout = 0,
  rapid = false,
}) {
  const ctx = getCtx()
  if (!ctx) return
  // Browsers suspend the context until a user gesture; the spin button
  // click that triggered this call is the gesture, but the resume
  // promise has to be requested explicitly the first time. Silently
  // swallowed because some embeddings (e.g. headless test environments)
  // reject — we don't want a console error every spin in those.
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  const now = ctx.currentTime
  if (rapid) {
    playRapidClick(ctx, now, masterVol * 0.45)
  } else {
    reelDelaysMs.forEach((delay, i) => {
      const bellTimeSec = now + (delay + baseDurationMs) / 1000
      const freq = REEL_BELL_FREQS[i] ?? REEL_BELL_FREQS[REEL_BELL_FREQS.length - 1]
      playBell(ctx, bellTimeSec, freq, masterVol * 0.6, 0.55)
    })
  }
  // Win chime — only on actual profit (payout > bet), not on the
  // 0.5x two-cherry consolation which the engine still calls a "win"
  // but nets out negative for the player. Tier by multiple in
  // scheduleWinChime. Fires after the last bell (or right after the
  // rapid click) so the celebratory arpeggio has clean air to sit in.
  if (bet > 0 && payout > bet) {
    const lastReelEndMs = rapid ? 60 : baseDurationMs + Math.max(...reelDelaysMs)
    const chimeStartSec = now + lastReelEndMs / 1000 + (rapid ? 0.05 : 0.15)
    scheduleWinChime(ctx, chimeStartSec, payout / bet, masterVol)
  }
}
