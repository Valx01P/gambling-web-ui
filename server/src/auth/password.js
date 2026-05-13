// Password hashing + verification. bcryptjs (pure JS) not bcrypt (native)
// so the package builds on every host without a native toolchain — Render
// free tier and most CI environments fail on the C++ build of bcrypt.
//
// COST: 10 is the standard default; ~100ms on a modern x64 core. Bumping
// to 12 (~400ms) is a future-tightening move once we hit auth scale.
import bcrypt from 'bcryptjs'

const COST = 10

// Length cap before hashing — bcrypt internally truncates at 72 bytes,
// so accepting passwords longer than that is misleading (extra characters
// silently ignored). We cap at 128 chars and reject longer at validation
// time so the API surface and bcrypt agree on what counts.
export const MAX_PASSWORD_LENGTH = 128
export const MIN_PASSWORD_LENGTH = 8

export async function hashPassword(plain) {
  if (typeof plain !== 'string') throw new Error('password must be a string')
  if (plain.length < MIN_PASSWORD_LENGTH) throw new Error('password too short')
  if (plain.length > MAX_PASSWORD_LENGTH) throw new Error('password too long')
  return bcrypt.hash(plain, COST)
}

// Constant-time compare via bcrypt. Returns false (not throws) on a
// mismatch so login routes don't leak timing/error info.
export async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string' || !hash) return false
  try { return await bcrypt.compare(plain, hash) }
  catch { return false }
}
