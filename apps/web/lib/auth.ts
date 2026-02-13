/**
 * Client-side auth utilities
 * Stores session in cookie for API authentication
 */

import type { UserInfo } from './interface'

const SID_COOKIE_NAME = 'multica_sid'
const USER_COOKIE_NAME = 'multica_user'

// Cookie helpers
function setCookie(name: string, value: string, days = 30) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? decodeURIComponent(match[2]) : null
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
}

// Auth functions
export function saveSession(sid: string, user: UserInfo) {
  setCookie(SID_COOKIE_NAME, sid)
  setCookie(USER_COOKIE_NAME, JSON.stringify(user))
}

export function getSession(): { sid: string; user: UserInfo } | null {
  if (typeof window === 'undefined') return null

  const sid = getCookie(SID_COOKIE_NAME)
  const userJson = getCookie(USER_COOKIE_NAME)

  if (!sid || !userJson) return null

  try {
    const user = JSON.parse(userJson) as UserInfo
    return { sid, user }
  } catch {
    return null
  }
}

export function getSid(): string | null {
  if (typeof window === 'undefined') return null
  return getCookie(SID_COOKIE_NAME)
}

export function clearSession() {
  deleteCookie(SID_COOKIE_NAME)
  deleteCookie(USER_COOKIE_NAME)
}

export function isAuthenticated(): boolean {
  return !!getSid()
}
