// Follow-graph queries. Tiny surface area: create / drop a follow row,
// list followers / following, return follower counts + isFollowedByMe
// flag for a viewer/target pair.
//
// All queries are point-keyed on (follower_id, following_id) which is
// the PK on user_follows, so reads are single-index seeks.

import { query } from '../db/pool.js'

// Returns true if this was a NEW follow (DB row inserted), false if the
// user was already following (no-op). Callers use this to gate notif
// emission — re-following shouldn't spam the target with duplicates.
export async function followUser(followerId, followingId) {
  if (!followerId || !followingId) return false
  if (followerId === followingId) return false
  const { rowCount } = await query(
    `INSERT INTO user_follows (follower_id, following_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [followerId, followingId]
  )
  return rowCount > 0
}

export async function unfollowUser(followerId, followingId) {
  if (!followerId || !followingId) return false
  const { rowCount } = await query(
    `DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
    [followerId, followingId]
  )
  return rowCount > 0
}

// Single-row check used by the public-user route to compute
// isFollowedByMe. Returns boolean.
export async function isFollowing(followerId, followingId) {
  if (!followerId || !followingId || followerId === followingId) return false
  const { rows } = await query(
    `SELECT 1 FROM user_follows WHERE follower_id = $1 AND following_id = $2`,
    [followerId, followingId]
  )
  return rows.length > 0
}

// Two counts in one round-trip. Used by the profile summary + public-user
// endpoint. Filters NULL away so unfollowed accounts return zeros.
export async function countFollowsForUser(userId) {
  if (!userId) return { followers: 0, following: 0 }
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*) FROM user_follows WHERE following_id = $1)::int AS followers,
       (SELECT COUNT(*) FROM user_follows WHERE follower_id  = $1)::int AS following`,
    [userId]
  )
  return {
    followers: rows[0]?.followers ?? 0,
    following: rows[0]?.following ?? 0
  }
}

// List the user's followers OR who they follow, with denormalized
// display name + avatar so the UI doesn't need a second roundtrip per
// row. `direction` is 'followers' (people who follow me) or 'following'
// (people I follow). Capped to `limit` rows.
export async function listFollows(userId, { direction, limit = 50 } = {}) {
  if (!userId) return []
  const cappedLimit = Math.min(200, Math.max(1, limit))
  const joinSide = direction === 'followers' ? 'follower_id' : 'following_id'
  const filterSide = direction === 'followers' ? 'following_id' : 'follower_id'
  const { rows } = await query(
    `SELECT u.id, u.display_name, u.avatar_url, u.elo, u.hands_played, u.last_active_at,
            f.created_at AS follow_created_at
       FROM user_follows f
       JOIN users u ON u.id = f.${joinSide}
      WHERE f.${filterSide} = $1
      ORDER BY f.created_at DESC
      LIMIT $2`,
    [userId, cappedLimit]
  )
  return rows.map(r => ({
    id: r.id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    elo: r.elo,
    handsPlayed: r.hands_played,
    lastActiveAt: r.last_active_at,
    followedAt: r.follow_created_at
  }))
}
