import { randomInt } from 'node:crypto'
import { query } from '../db/pool.js'

// Time-to-live for a 6-digit code, in minutes. Long enough that a user
// who reopens the modal a minute later still has a working code; short
// enough that a leaked email never holds a live code.
export const EMAIL_CODE_TTL_MINUTES = 5

// Hard cap on wrong-code attempts per code. We don't lock the account,
// just the code itself — let the user request a fresh one.
const MAX_ATTEMPTS = 6

function generateCode() {
  // randomInt(0, 1_000_000) gives 0..999_999; pad to 6 digits.
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

// Issue a fresh code. We retire any prior un-consumed code for the same
// (user, purpose) so the user only has one valid code at a time — older
// codes still work until they expire, but the most-recent one is the
// "official" one we'd lookup if multiple are valid.
export async function issueCode(userId, purpose) {
  const code = generateCode()
  await query(
    `UPDATE email_verifications
        SET consumed_at = NOW()
      WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL`,
    [userId, purpose]
  )
  const { rows } = await query(
    `INSERT INTO email_verifications (user_id, purpose, code, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)
     RETURNING id, code, expires_at`,
    [userId, purpose, code, EMAIL_CODE_TTL_MINUTES]
  )
  return rows[0]
}

// Look up the most recent un-consumed, un-expired code for (user, purpose).
// Returns the row or null. Used by callers to validate input + tally
// attempts.
export async function findActiveCode(userId, purpose) {
  const { rows } = await query(
    `SELECT id, code, attempts, expires_at, created_at
       FROM email_verifications
      WHERE user_id = $1
        AND purpose = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, purpose]
  )
  return rows[0] || null
}

// Bump the wrong-attempt counter. Once it hits MAX_ATTEMPTS we burn the
// code so the next attempt yields "no active code" — pushes the user
// toward requesting a fresh one rather than brute-forcing.
export async function recordFailedAttempt(verificationId) {
  const { rows } = await query(
    `UPDATE email_verifications
        SET attempts = attempts + 1,
            consumed_at = CASE WHEN attempts + 1 >= $2 THEN NOW() ELSE consumed_at END
      WHERE id = $1
      RETURNING attempts, consumed_at`,
    [verificationId, MAX_ATTEMPTS]
  )
  return rows[0] || null
}

// Successful match — burn the code so it can't be reused. We don't
// delete it; the audit row stays for post-incident review.
export async function consumeCode(verificationId) {
  await query(
    `UPDATE email_verifications SET consumed_at = NOW() WHERE id = $1`,
    [verificationId]
  )
}

export { MAX_ATTEMPTS }
