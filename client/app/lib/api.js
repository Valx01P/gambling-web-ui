'use client'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
const TOKEN_KEY = 'gwu_session_token'
const USER_KEY = 'gwu_session_user'

export function getStoredToken() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function setSession({ token, user }) {
  if (typeof window === 'undefined') return
  if (token) window.localStorage.setItem(TOKEN_KEY, token)
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user))
  window.dispatchEvent(new Event('gwu:auth-changed'))
}

export function clearSession() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(TOKEN_KEY)
  window.localStorage.removeItem(USER_KEY)
  window.dispatchEvent(new Event('gwu:auth-changed'))
}

export async function apiFetch(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
  const opts = {
    method,
    headers: { 'Accept': 'application/json', ...headers }
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
    opts.headers['Content-Type'] = 'application/json'
  }
  if (auth) {
    const token = getStoredToken()
    if (token) opts.headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}${path}`, opts)
  if (res.status === 204) return null
  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    if (res.status === 401 && auth) clearSession()
    const error = new Error(data?.error || `HTTP ${res.status}`)
    error.status = res.status
    error.detail = data?.detail
    error.path = data?.path
    throw error
  }
  return data
}

export const api = {
  google: (credential) => apiFetch('/api/auth/google', { method: 'POST', body: { credential } }),
  me: () => apiFetch('/api/auth/me', { auth: true }),
  updateMe: (patch) => apiFetch('/api/auth/me', { method: 'PATCH', auth: true, body: patch }),

  listMyBots: () => apiFetch('/api/bots/mine', { auth: true }),
  listPublicBots: () => apiFetch('/api/bots/public'),
  getBot: (id) => apiFetch(`/api/bots/${id}`, { auth: true }),
  createBot: (data) => apiFetch('/api/bots', { method: 'POST', auth: true, body: data }),
  updateBot: (id, patch) => apiFetch(`/api/bots/${id}`, { method: 'PATCH', auth: true, body: patch }),
  deleteBot: (id) => apiFetch(`/api/bots/${id}`, { method: 'DELETE', auth: true }),
  // Player-clone bot — 5 tiers (12/25/50/75/100 hands). Preview returns
  // every tier's state; buildMyBot accepts a tier id; recalculate replaces
  // an existing tier's code in place.
  previewMyBot: () => apiFetch('/api/bots/from-me/preview', { auth: true }),
  buildMyBot: (tier = 1) => apiFetch('/api/bots/from-me', { method: 'POST', auth: true, body: { tier } }),
  recalculateClone: (id) => apiFetch(`/api/bots/${id}/recalculate-clone`, { method: 'POST', auth: true }),

  // Uploads. `presign` is auth-optional — anonymous users get tmp/ keys that
  // the bucket lifecycle reaps after 24h; signed-in users get persistent
  // users/<id>/ keys that they manage via the PFP endpoints below.
  presignUpload: ({ kind, contentType, size }) =>
    apiFetch('/api/uploads/presign', { method: 'POST', auth: true, body: { kind, contentType, size } }),
  savePfp: ({ key, publicUrl, contentType, byteSize }) =>
    apiFetch('/api/uploads/me/pfps', { method: 'POST', auth: true, body: { key, publicUrl, contentType, byteSize } }),
  listPfps: () => apiFetch('/api/uploads/me/pfps', { auth: true }),
  deletePfp: (id) => apiFetch(`/api/uploads/me/pfps/${id}`, { method: 'DELETE', auth: true }),
}
